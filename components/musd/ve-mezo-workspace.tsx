'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useChainId, usePublicClient, useReadContract, useReadContracts, useWalletClient } from 'wagmi'
import { erc20Abi, formatUnits, isAddress, parseUnits, type Abi, type Address, type Hex } from 'viem'
import artifacts from '@/lib/deployment-artifacts.json'
import { MEZO_DEVELOPER_ADDRESS, MEZO_TESTNET_CHAIN_ID, mezoTestnet } from '@/lib/mezo'
import { MEZO_TOKEN_ADDRESS, VEMEZO_ADDRESS, VEMEZO_DISTRIBUTOR_ADDRESS, VEMEZO_YIELD_FACTORY_ADDRESS, veMezoAbi, veMezoRewardsDistributorAbi } from '@/lib/ve-mezo'

const factoryAbi = artifacts.VeMezoYieldFactory.abi as Abi
const factoryBytecode = artifacts.VeMezoYieldFactory.bytecode as Hex
const seriesAbi = artifacts.VeMezoYieldSeries.abi as Abi
const marketAbi = artifacts.VeMezoMarket.abi as Abi
const zeroAddress = '0x0000000000000000000000000000000000000000' as Address
const maxVisibleNfts = 20

type Lock = { amount: bigint; end: bigint; isPermanent: boolean }

function asAddress(value: unknown): Address | undefined {
  return typeof value === 'string' && isAddress(value) && value.toLowerCase() !== zeroAddress ? value : undefined
}

function displayAmount(value: unknown, precision = 5) {
  if (typeof value !== 'bigint') return '—'
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: precision })
}

function amountInput(value: string) {
  try {
    return value.trim() ? parseUnits(value, 18) : BigInt(0)
  } catch {
    return BigInt(0)
  }
}

function formatInputAmount(value: bigint) {
  const formatted = formatUnits(value, 18)
  return formatted.includes('.') ? formatted.replace(/0+$/, '').replace(/\.$/, '') : formatted
}

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'Transaction could not be completed.'
  const message = error.message.split('\n')[0]
  if (message.includes('User rejected')) return 'Transaction was rejected in the wallet.'
  if (message.includes('insufficient funds')) return 'Not enough MEZO Testnet BTC is available for gas.'
  return message.slice(0, 180)
}

export type VeMezoView = 'Markets' | 'Trade' | 'Liquidity' | 'Portfolio' | 'Developer'

export function VeMezoWorkspace({ view = 'Markets' }: { view?: VeMezoView }) {
  const [factoryAddress, setFactoryAddress] = useState<Address | undefined>(VEMEZO_YIELD_FACTORY_ADDRESS)
  const [factoryInput, setFactoryInput] = useState(VEMEZO_YIELD_FACTORY_ADDRESS ?? '')
  const [selectedNft, setSelectedNft] = useState('')
  const [tradeToken, setTradeToken] = useState<'PT' | 'YT'>('PT')
  const [tradeSide, setTradeSide] = useState<'MEZO' | 'TOKEN'>('MEZO')
  const [tradeAmount, setTradeAmount] = useState('')
  const [liquidityMezo, setLiquidityMezo] = useState('')
  const [liquidityToken, setLiquidityToken] = useState('')
  const [removeShares, setRemoveShares] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const walletClient = useWalletClient()
  const publicClient = usePublicClient({ chainId: MEZO_TESTNET_CHAIN_ID })
  const queryClient = useQueryClient()
  const targetReady = isConnected && chainId === MEZO_TESTNET_CHAIN_ID && Boolean(address)
  const isDeveloper = address?.toLowerCase() === MEZO_DEVELOPER_ADDRESS.toLowerCase()
  const account = address ?? zeroAddress

  const nftCountRead = useReadContract({
    address: VEMEZO_ADDRESS,
    abi: veMezoAbi,
    functionName: 'balanceOf',
    args: [account],
    query: { enabled: Boolean(address) },
  })
  const nftCount = typeof nftCountRead.data === 'bigint' ? Math.min(Number(nftCountRead.data), maxVisibleNfts) : 0
  const ownedNftReads = useReadContracts({
    contracts: Array.from({ length: nftCount }, (_, index) => ({
      address: VEMEZO_ADDRESS,
      abi: veMezoAbi,
      functionName: 'ownerToNFTokenIdList' as const,
      args: [account, BigInt(index)] as const,
    })),
    query: { enabled: Boolean(address && nftCount > 0) },
  })
  const ownedNftIds = useMemo(
    () => (ownedNftReads.data ?? []).flatMap((result) => result.status === 'success' && typeof result.result === 'bigint' ? [result.result] : []),
    [ownedNftReads.data],
  )
  const factorySeriesRead = useReadContract({
    address: factoryAddress ?? zeroAddress,
    abi: factoryAbi,
    functionName: 'seriesPage',
    args: [BigInt(0), BigInt(50)],
    query: { enabled: Boolean(address && factoryAddress) },
  })
  const seriesCatalog = useMemo(() => {
    const page = factorySeriesRead.data
    if (!Array.isArray(page) || !Array.isArray(page[0]) || !Array.isArray(page[2]) || !Array.isArray(page[4])) return []
    return page[0].flatMap((id, index) => {
      const tranche = asAddress(page[2][index])
      const creator = asAddress(page[4][index])
      return typeof id === 'bigint' && tranche && creator ? [{ id, tranche, creator }] : []
    })
  }, [factorySeriesRead.data])
  const ownedSeries = useMemo(
    () => address ? seriesCatalog.filter(({ creator }) => creator.toLowerCase() === address.toLowerCase()) : [],
    [address, seriesCatalog],
  )
  const createdPositionIds = useMemo(() => ownedSeries.map(({ id }) => id), [ownedSeries])
  const portfolioTokenReads = useReadContracts({
    contracts: seriesCatalog.flatMap(({ tranche }) => [
      { address: tranche, abi: seriesAbi, functionName: 'principalToken' as const },
      { address: tranche, abi: seriesAbi, functionName: 'yieldToken' as const },
      { address: tranche, abi: seriesAbi, functionName: 'principalDeposited' as const },
      { address: tranche, abi: seriesAbi, functionName: 'maturity' as const },
    ]),
    query: { enabled: Boolean(address && seriesCatalog.length > 0) },
  })
  const portfolioBalancesRead = useReadContracts({
    contracts: seriesCatalog.flatMap((_, index) => {
      const principalToken = asAddress(portfolioTokenReads.data?.[index * 4]?.result) ?? zeroAddress
      const yieldToken = asAddress(portfolioTokenReads.data?.[index * 4 + 1]?.result) ?? zeroAddress
      return [
        { address: principalToken, abi: erc20Abi, functionName: 'balanceOf' as const, args: [account] as const },
        { address: yieldToken, abi: erc20Abi, functionName: 'balanceOf' as const, args: [account] as const },
      ]
    }),
    query: { enabled: Boolean(address && seriesCatalog.length > 0 && portfolioTokenReads.data) },
  })
  const positionIds = useMemo(
    () => Array.from(new Set([...ownedNftIds, ...createdPositionIds].map((id) => id.toString()))).map(BigInt),
    [createdPositionIds, ownedNftIds],
  )
  const selectedId = selectedNft ? BigInt(selectedNft) : (positionIds[0] ?? BigInt(0))

  const lockedRead = useReadContract({
    address: VEMEZO_ADDRESS,
    abi: veMezoAbi,
    functionName: 'locked',
    args: [selectedId],
    query: { enabled: selectedId > BigInt(0) },
  })
  const lock = lockedRead.data as Lock | undefined
  const distributorCursorRead = useReadContract({
    address: VEMEZO_DISTRIBUTOR_ADDRESS,
    abi: veMezoRewardsDistributorAbi,
    functionName: 'lastTokenTime',
  })
  const distributorCursor = typeof distributorCursorRead.data === 'bigint' ? distributorCursorRead.data : BigInt(0)
  const escrowTypeRead = useReadContract({
    address: VEMEZO_ADDRESS,
    abi: veMezoAbi,
    functionName: 'escrowType',
    args: [selectedId],
    query: { enabled: selectedId > BigInt(0) },
  })

  const factoryVemezoRead = useReadContract({
    address: factoryAddress ?? zeroAddress,
    abi: factoryAbi,
    functionName: 'veMezo',
    query: { enabled: Boolean(factoryAddress) },
  })
  const factoryMezoRead = useReadContract({
    address: factoryAddress ?? zeroAddress,
    abi: factoryAbi,
    functionName: 'mezo',
    query: { enabled: Boolean(factoryAddress) },
  })
  const factoryVerified = asAddress(factoryVemezoRead.data)?.toLowerCase() === VEMEZO_ADDRESS.toLowerCase()
    && asAddress(factoryMezoRead.data)?.toLowerCase() === MEZO_TOKEN_ADDRESS.toLowerCase()

  const trancheRead = useReadContract({
    address: factoryAddress ?? zeroAddress,
    abi: factoryAbi,
    functionName: 'seriesForTokenId',
    args: [selectedId],
    query: { enabled: Boolean(factoryAddress && factoryVerified && selectedId > BigInt(0)) },
  })
  const marketRead = useReadContract({
    address: factoryAddress ?? zeroAddress,
    abi: factoryAbi,
    functionName: 'marketForTokenId',
    args: [selectedId],
    query: { enabled: Boolean(factoryAddress && factoryVerified && selectedId > BigInt(0)) },
  })
  const trancheAddress = asAddress(trancheRead.data)
  const marketAddress = asAddress(marketRead.data)
  const trancheRef = trancheAddress ?? zeroAddress
  const marketRef = marketAddress ?? zeroAddress

  const depositedRead = useReadContract({ address: trancheRef, abi: seriesAbi, functionName: 'deposited', query: { enabled: Boolean(trancheAddress) } })
  const settledRead = useReadContract({ address: trancheRef, abi: seriesAbi, functionName: 'settled', query: { enabled: Boolean(trancheAddress) } })
  const principalAmountRead = useReadContract({ address: trancheRef, abi: seriesAbi, functionName: 'principalDeposited', query: { enabled: Boolean(trancheAddress) } })
  const principalClaimRead = useReadContract({ address: trancheRef, abi: seriesAbi, functionName: 'principalClaim', query: { enabled: Boolean(trancheAddress) } })
  const yieldReserveRead = useReadContract({ address: trancheRef, abi: seriesAbi, functionName: 'yieldReserve', query: { enabled: Boolean(trancheAddress) } })
  const trancheMaturityRead = useReadContract({ address: trancheRef, abi: seriesAbi, functionName: 'maturity', query: { enabled: Boolean(trancheAddress) } })
  const ptRead = useReadContract({ address: trancheRef, abi: seriesAbi, functionName: 'principalToken', query: { enabled: Boolean(trancheAddress) } })
  const ytRead = useReadContract({ address: trancheRef, abi: seriesAbi, functionName: 'yieldToken', query: { enabled: Boolean(trancheAddress) } })
  const ptAddress = asAddress(ptRead.data)
  const ytAddress = asAddress(ytRead.data)
  const tokenAddress = tradeToken === 'PT' ? ptAddress : ytAddress
  const isDeposited = depositedRead.data === true
  const isSettled = settledRead.data === true
  const maturity = typeof trancheMaturityRead.data === 'bigint' ? trancheMaturityRead.data : lock?.end ?? BigInt(0)
  const now = BigInt(Math.floor(Date.now() / 1000))
  const settlementDelayPassed = maturity > BigInt(0) && now >= maturity + BigInt(7 * 24 * 60 * 60)
  const canSettle = settlementDelayPassed && distributorCursor >= maturity

  const mezoBalanceRead = useReadContract({ address: MEZO_TOKEN_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [account], query: { enabled: Boolean(address) } })
  const ptBalanceRead = useReadContract({ address: ptAddress ?? zeroAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account], query: { enabled: Boolean(ptAddress && address) } })
  const ytBalanceRead = useReadContract({ address: ytAddress ?? zeroAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account], query: { enabled: Boolean(ytAddress && address) } })
  const ytClaimableRead = useReadContract({
    address: ytAddress ?? zeroAddress,
    abi: artifacts.VeMezoYieldToken.abi as Abi,
    functionName: 'claimableYield',
    args: [account],
    query: { enabled: Boolean(ytAddress && address) },
  })
  const currentTokenBalance = tradeToken === 'PT' ? ptBalanceRead.data : ytBalanceRead.data
  const poolRead = useReadContract({
    address: marketRef,
    abi: marketAbi,
    functionName: 'pool',
    args: [tokenAddress ?? zeroAddress],
    query: { enabled: Boolean(marketAddress && tokenAddress) },
  })
  const poolParts = Array.isArray(poolRead.data) ? poolRead.data : []
  const reserveMezo = typeof poolParts[0] === 'bigint' ? poolParts[0] : BigInt(0)
  const reserveToken = typeof poolParts[1] === 'bigint' ? poolParts[1] : BigInt(0)
  const liquiditySupply = typeof poolParts[2] === 'bigint' ? poolParts[2] : BigInt(0)
  const lpBalanceRead = useReadContract({
    address: marketRef,
    abi: marketAbi,
    functionName: 'liquidityOf',
    args: [tokenAddress ?? zeroAddress, account],
    query: { enabled: Boolean(marketAddress && tokenAddress && address) },
  })
  const parsedTradeAmount = amountInput(tradeAmount)
  const tradeInputAddress = tradeSide === 'MEZO' ? MEZO_TOKEN_ADDRESS : tokenAddress
  const quoteRead = useReadContract({
    address: marketRef,
    abi: marketAbi,
    functionName: 'quote',
    args: [tokenAddress ?? zeroAddress, tradeInputAddress ?? zeroAddress, parsedTradeAmount],
    query: { enabled: Boolean(marketAddress && tokenAddress && tradeInputAddress && parsedTradeAmount > BigInt(0)) },
  })
  const tradeAllowanceRead = useReadContract({
    address: tradeInputAddress ?? zeroAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account, marketRef],
    query: { enabled: Boolean(address && marketAddress && tradeInputAddress) },
  })
  const mezoAllowanceRead = useReadContract({
    address: MEZO_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account, marketRef],
    query: { enabled: Boolean(address && marketAddress) },
  })
  const liquidityTokenAllowanceRead = useReadContract({
    address: tokenAddress ?? zeroAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account, marketRef],
    query: { enabled: Boolean(address && marketAddress && tokenAddress) },
  })

  const waitForTransaction = async (hash: Hex, label: string) => {
    if (!publicClient) throw new Error('Mezo Testnet RPC is unavailable.')
    setStatus(`${label} submitted. Waiting for Mezo Testnet confirmation…`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${label} reverted on chain.`)
    await queryClient.invalidateQueries()
    return receipt
  }

  const ensureWallet = () => {
    if (!address || !walletClient.data || !publicClient) throw new Error('Connect a wallet to continue.')
    if (chainId !== MEZO_TESTNET_CHAIN_ID) throw new Error('Switch your wallet to Mezo Testnet first.')
    return { account: address, client: walletClient.data }
  }

  const runAction = async (label: string, action: (account: Address) => Promise<Hex>) => {
    setBusy(true)
    setStatus('')
    try {
      const { account } = ensureWallet()
      const hash = await action(account)
      await waitForTransaction(hash, label)
      setStatus(`${label} confirmed.`)
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const deployFactory = async () => {
    setBusy(true)
    setStatus('')
    try {
      const { account, client } = ensureWallet()
      if (!isDeveloper) throw new Error('Only the configured developer wallet can deploy protocol contracts.')
      const hash = await client.deployContract({
        account,
        chain: mezoTestnet,
        abi: factoryAbi,
        bytecode: factoryBytecode,
        args: [VEMEZO_ADDRESS, VEMEZO_DISTRIBUTOR_ADDRESS, MEZO_TOKEN_ADDRESS],
      })
      const receipt = await waitForTransaction(hash, 'veMEZO factory deployment')
      if (!receipt.contractAddress) throw new Error('Factory deployment did not return a contract address.')
      setFactoryAddress(receipt.contractAddress)
      setFactoryInput(receipt.contractAddress)
      setStatus(`Factory deployed at ${receipt.contractAddress}. Copy this address into the project environment to share it with other users.`)
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const useFactoryAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAddress(factoryInput)) return setStatus('Enter a valid factory address.')
    setFactoryAddress(factoryInput)
    setStatus('Checking that factory against the live veMEZO and MEZO contracts…')
  }

  const createSeries = async () => {
    if (!factoryAddress || selectedId === BigInt(0)) return
    await runAction('veMEZO PT/YT market creation', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: factoryAddress,
        abi: factoryAbi,
        functionName: 'createSeries',
        args: [selectedId],
      } as never)
    })
  }

  const depositNft = async () => {
    if (!trancheAddress || selectedId === BigInt(0)) return
    await runAction('veMEZO NFT deposit and PT/YT mint', async (account) => {
      const { client } = ensureWallet()
      const approved = await publicClient!.readContract({
        address: VEMEZO_ADDRESS,
        abi: veMezoAbi,
        functionName: 'getApproved',
        args: [selectedId],
      })
      if ((approved as string).toLowerCase() !== trancheAddress.toLowerCase()) {
        const approval = await client.writeContract({
          account,
          chain: mezoTestnet,
          address: VEMEZO_ADDRESS,
          abi: veMezoAbi,
          functionName: 'approve',
          args: [trancheAddress, selectedId],
        } as never)
        await waitForTransaction(approval, 'veMEZO NFT approval')
      }
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: trancheAddress,
        abi: seriesAbi,
        functionName: 'deposit',
        args: [account],
      } as never)
    })
  }

  const checkpoint = async () => {
    if (!trancheAddress) return
    await runAction('Rebase checkpoint', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({ account, chain: mezoTestnet, address: trancheAddress, abi: seriesAbi, functionName: 'checkpointRebase' } as never)
    })
  }

  const settle = async () => {
    if (!trancheAddress) return
    await runAction('Maturity settlement', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({ account, chain: mezoTestnet, address: trancheAddress, abi: seriesAbi, functionName: 'settle' } as never)
    })
  }

  const redeemPrincipal = async () => {
    if (!trancheAddress || typeof ptBalanceRead.data !== 'bigint' || ptBalanceRead.data === BigInt(0)) return
    await runAction('PT principal redemption', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({ account, chain: mezoTestnet, address: trancheAddress, abi: seriesAbi, functionName: 'redeemPrincipal', args: [ptBalanceRead.data as bigint] } as never)
    })
  }

  const claimYield = async () => {
    if (!ytAddress) return
    await runAction('YT rebase redemption', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({ account, chain: mezoTestnet, address: ytAddress, abi: artifacts.VeMezoYieldToken.abi as Abi, functionName: 'claimYield' } as never)
    })
  }

  const ensureAllowance = async (account: Address, token: Address, amount: bigint) => {
    const { client } = ensureWallet()
    const allowance = await publicClient!.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account, marketRef] })
    if (allowance >= amount) return
    const approval = await client.writeContract({ account, chain: mezoTestnet, address: token, abi: erc20Abi, functionName: 'approve', args: [marketRef, amount] })
    await waitForTransaction(approval, 'Token approval')
  }

  const trade = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!marketAddress || !tokenAddress || !tradeInputAddress || parsedTradeAmount === BigInt(0)) {
      return setStatus('Choose a market token and enter an amount greater than zero.')
    }
    const quote = typeof quoteRead.data === 'bigint' ? quoteRead.data : BigInt(0)
    if (quote === BigInt(0)) return setStatus('This MEZO pair has no liquidity. Add liquidity before swapping.')
    const minOut = (quote * BigInt(9_900)) / BigInt(10_000)
    await runAction(`${tradeSide === 'MEZO' ? 'Buy' : 'Sell'} ${tradeToken}-veMEZO`, async (account) => {
      const { client } = ensureWallet()
      await ensureAllowance(account, tradeInputAddress, parsedTradeAmount)
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: marketAddress,
        abi: marketAbi,
        functionName: 'swapExactIn',
        args: [tokenAddress, tradeInputAddress, parsedTradeAmount, minOut, account],
      } as never)
    })
  }

  const updateLiquidityMezo = (value: string) => {
    setLiquidityMezo(value)
    if (!value.trim()) return setLiquidityToken('')
    try {
      const mezoAmount = parseUnits(value, 18)
      setLiquidityToken(reserveMezo > BigInt(0) && reserveToken > BigInt(0) ? formatInputAmount((mezoAmount * reserveToken) / reserveMezo) : '')
    } catch {
      setLiquidityToken('')
    }
  }

  const updateLiquidityToken = (value: string) => {
    setLiquidityToken(value)
    if (!value.trim()) return setLiquidityMezo('')
    try {
      const tokenAmount = parseUnits(value, 18)
      setLiquidityMezo(reserveMezo > BigInt(0) && reserveToken > BigInt(0) ? formatInputAmount((tokenAmount * reserveMezo) / reserveToken) : '')
    } catch {
      setLiquidityMezo('')
    }
  }

  const addLiquidity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!marketAddress || !tokenAddress) return setStatus('Create a tranche before adding market liquidity.')
    const mezoAmount = amountInput(liquidityMezo)
    const tokenAmount = amountInput(liquidityToken)
    if (mezoAmount === BigInt(0) || tokenAmount === BigInt(0)) return setStatus('Enter positive MEZO and PT/YT liquidity amounts.')
    await runAction('Add MEZO liquidity', async (account) => {
      const { client } = ensureWallet()
      await ensureAllowance(account, MEZO_TOKEN_ADDRESS, mezoAmount)
      await ensureAllowance(account, tokenAddress, tokenAmount)
      return client.writeContract({ account, chain: mezoTestnet, address: marketAddress, abi: marketAbi, functionName: 'addLiquidity', args: [tokenAddress, mezoAmount, tokenAmount, BigInt(1)] } as never)
    })
  }

  const removeLiquidity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!marketAddress || !tokenAddress) return
    const shares = amountInput(removeShares)
    const lp = typeof lpBalanceRead.data === 'bigint' ? lpBalanceRead.data : BigInt(0)
    if (shares === BigInt(0) || shares > lp) return setStatus('Enter a valid amount of your LP shares.')
    const minMezo = liquiditySupply > BigInt(0) ? (shares * reserveMezo / liquiditySupply * BigInt(9_900)) / BigInt(10_000) : BigInt(0)
    const minToken = liquiditySupply > BigInt(0) ? (shares * reserveToken / liquiditySupply * BigInt(9_900)) / BigInt(10_000) : BigInt(0)
    await runAction('Remove MEZO liquidity', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({ account, chain: mezoTestnet, address: marketAddress, abi: marketAbi, functionName: 'removeLiquidity', args: [tokenAddress, shares, minMezo, minToken] } as never)
    })
  }

  const nftEligible = Boolean(lock && lock.amount > BigInt(0) && !lock.isPermanent && lock.end > now && escrowTypeRead.data === 0)
  const seriesExists = Boolean(trancheAddress)

  const portfolioPtTotal = (portfolioBalancesRead.data ?? []).reduce((sum, result, index) => index % 2 === 0 && result.status === 'success' && typeof result.result === 'bigint' ? sum + result.result : sum, BigInt(0))
  const portfolioYtTotal = (portfolioBalancesRead.data ?? []).reduce((sum, result, index) => index % 2 === 1 && result.status === 'success' && typeof result.result === 'bigint' ? sum + result.result : sum, BigInt(0))
  return (
    <section className="workspace-panel" aria-live="polite">
      {status && <p className="transaction-status" role="status">{status}</p>}
      <div className="workspace-content ve-mezo-content">
        {view === 'Markets' && <div className="form-card position-setup-card">
          <div className="section-heading"><div><span className="eyebrow">NFT-BACKED MARKETS</span><h3>Choose a veMEZO lock</h3></div><span className="source-live"><i />Mezo Testnet</span></div>
          {!isConnected ? <p className="field-hint">Connect your wallet to view eligible locks and existing positions.</p> : positionIds.length === 0 ? <p className="field-hint">No eligible veMEZO locks found. Your deposited PT/YT positions remain available in Portfolio.</p> : <div className="protocol-form">
            <label htmlFor="ve-mezo-token-id">veMEZO lock or position</label>
            <select id="ve-mezo-token-id" value={selectedId.toString()} onChange={(event) => setSelectedNft(event.target.value)}>
              {positionIds.map((id) => <option key={id.toString()} value={id.toString()}>{createdPositionIds.includes(id) ? `Token #${id.toString()} · PT/YT position` : `Token #${id.toString()}`}</option>)}
            </select>
            {lock && !isDeposited && <div className="market-stats"><div><span>Locked amount</span><strong>{displayAmount(BigInt(lock.amount < 0 ? -lock.amount : lock.amount))} MEZO</strong></div><div><span>Expiry</span><strong>{new Date(Number(lock.end) * 1000).toLocaleDateString()}</strong></div><div><span>Eligibility</span><strong>{nftEligible ? 'Eligible' : 'Not eligible'}</strong></div></div>}
            {!factoryVerified && <p className="field-hint">The shared veMEZO market factory is unavailable right now.</p>}
            {factoryVerified && !seriesExists && <button type="button" className="primary-action" onClick={createSeries} disabled={busy || !targetReady || !nftEligible}>{busy ? 'Waiting for wallet…' : 'Create market'}</button>}
            {factoryVerified && seriesExists && !isDeposited && <button type="button" className="primary-action" onClick={depositNft} disabled={busy || !targetReady || !nftEligible}>{busy ? 'Waiting for wallet…' : 'Deposit lock and mint PT + YT'}</button>}
            {isDeposited && <p className="field-hint">This lock is escrowed. Your PT/YT tokens and claims are in Portfolio.</p>}
          </div>}
        </div>}

        {view === 'Trade' && <div className="form-card trade-card">
          <div className="section-heading"><div><span className="eyebrow">MEZO SPOT MARKET</span><h3>Swap PT or YT</h3></div><span className="status-pill status-open">0.30% fee</span></div>
          {positionIds.length > 1 && <div className="protocol-form"><label htmlFor="ve-trade-position">Market position</label><select id="ve-trade-position" value={selectedId.toString()} onChange={(event) => setSelectedNft(event.target.value)}>{positionIds.map((id) => <option key={id.toString()} value={id.toString()}>Token #{id.toString()}</option>)}</select></div>}
          {!seriesExists || !isDeposited ? <p className="field-hint">Create and deposit a veMEZO lock in Markets to open its PT/YT pair.</p> : <>
            <div className="segmented-control"><button type="button" className={tradeToken === 'PT' ? 'segment-active' : ''} onClick={() => { setTradeToken('PT'); setTradeAmount('') }}>PT-veMEZO</button><button type="button" className={tradeToken === 'YT' ? 'segment-active' : ''} onClick={() => { setTradeToken('YT'); setTradeAmount('') }}>YT-veMEZO</button></div>
            <div className="market-stats"><div><span>MEZO reserve</span><strong>{displayAmount(reserveMezo)} MEZO</strong></div><div><span>{tradeToken} reserve</span><strong>{displayAmount(reserveToken)} {tradeToken}</strong></div><div><span>Your balance</span><strong>{displayAmount(currentTokenBalance)} {tradeToken}</strong></div></div>
            <form className="protocol-form" onSubmit={trade}>
              <label htmlFor="ve-trade-side">Pay with</label><select id="ve-trade-side" value={tradeSide} onChange={(event) => setTradeSide(event.target.value as 'MEZO' | 'TOKEN')}><option value="MEZO">MEZO</option><option value="TOKEN">{tradeToken}-veMEZO</option></select>
              <label htmlFor="ve-trade-amount">Amount</label><div className="amount-input"><input id="ve-trade-amount" inputMode="decimal" value={tradeAmount} onChange={(event) => setTradeAmount(event.target.value)} placeholder="0.00" /><span>{tradeSide === 'MEZO' ? 'MEZO' : `${tradeToken}-veMEZO`}</span></div>
              <div className="balance-line"><span>Estimated receive</span><strong>{displayAmount(quoteRead.data)} {tradeSide === 'MEZO' ? `${tradeToken}-veMEZO` : 'MEZO'}</strong></div>
              <button className="primary-action" disabled={busy || !targetReady || !marketAddress || !quoteRead.data}>{busy ? 'Waiting for wallet…' : 'Review swap'}</button>
            </form>
          </>}
        </div>}

        {view === 'Liquidity' && <div className="form-card liquidity-card">
          <div className="section-heading"><div><span className="eyebrow">LIQUIDITY</span><h3>Manage your pool position</h3></div></div>
          {positionIds.length > 1 && <div className="protocol-form"><label htmlFor="ve-liquidity-position">Market position</label><select id="ve-liquidity-position" value={selectedId.toString()} onChange={(event) => { setSelectedNft(event.target.value); setLiquidityMezo(''); setLiquidityToken('') }}>{positionIds.map((id) => <option key={id.toString()} value={id.toString()}>Token #{id.toString()}</option>)}</select></div>}
          {!seriesExists || !isDeposited || !marketAddress || !tokenAddress ? <p className="field-hint">A deposited PT/YT market is required before adding liquidity.</p> : <>
            <div className="segmented-control"><button type="button" className={tradeToken === 'PT' ? 'segment-active' : ''} onClick={() => { setTradeToken('PT'); setLiquidityMezo(''); setLiquidityToken('') }}>PT pool</button><button type="button" className={tradeToken === 'YT' ? 'segment-active' : ''} onClick={() => { setTradeToken('YT'); setLiquidityMezo(''); setLiquidityToken('') }}>YT pool</button></div>
            <div className="market-stats"><div><span>Your LP shares</span><strong>{displayAmount(lpBalanceRead.data)}</strong></div><div><span>Pool shares</span><strong>{displayAmount(liquiditySupply)}</strong></div></div>
            <div className="two-column-workspace">
              <form className="protocol-form" onSubmit={addLiquidity}><label htmlFor="ve-lp-mezo">MEZO amount</label><input id="ve-lp-mezo" inputMode="decimal" value={liquidityMezo} onChange={(event) => updateLiquidityMezo(event.target.value)} placeholder="0.00" /><label htmlFor="ve-lp-token">{tradeToken}-veMEZO amount</label><input id="ve-lp-token" inputMode="decimal" value={liquidityToken} onChange={(event) => updateLiquidityToken(event.target.value)} placeholder="0.00" /><p className="field-hint">The paired amount follows the selected pool&apos;s live reserve ratio. For an empty pool, enter both amounts manually.</p><button className="primary-action" disabled={busy || !targetReady}>{busy ? 'Waiting for wallet…' : 'Add liquidity'}</button></form>
              <form className="protocol-form" onSubmit={removeLiquidity}><label htmlFor="ve-lp-shares">LP shares to remove</label><input id="ve-lp-shares" inputMode="decimal" value={removeShares} onChange={(event) => setRemoveShares(event.target.value)} placeholder="0.00" /><div className="balance-line"><span>Available</span><strong>{displayAmount(lpBalanceRead.data)} shares</strong></div><button className="secondary-action" disabled={busy || !targetReady}>{busy ? 'Waiting for wallet…' : 'Remove liquidity'}</button></form>
            </div>
          </>}
        </div>}

        {view === 'Portfolio' && <div className="portfolio-content">
          <div className="portfolio-grid"><div className="balance-card"><span>MEZO</span><strong>{displayAmount(mezoBalanceRead.data)}</strong><small>Wallet balance</small></div><div className="balance-card"><span>PT-veMEZO</span><strong>{displayAmount(portfolioPtTotal)}</strong><small>Across listed markets</small></div><div className="balance-card"><span>YT-veMEZO</span><strong>{displayAmount(portfolioYtTotal)}</strong><small>Across listed markets</small></div></div>
          <div className="portfolio-position-list">
            {seriesCatalog.map((series, index) => {
              const ptResult = portfolioBalancesRead.data?.[index * 2]
              const ytResult = portfolioBalancesRead.data?.[index * 2 + 1]
              const pt = ptResult?.status === 'success' && typeof ptResult.result === 'bigint' ? ptResult.result : BigInt(0)
              const yt = ytResult?.status === 'success' && typeof ytResult.result === 'bigint' ? ytResult.result : BigInt(0)
              if (pt === BigInt(0) && yt === BigInt(0) && series.creator.toLowerCase() !== address?.toLowerCase()) return null
              const maturity = portfolioTokenReads.data?.[index * 4 + 3]?.result
              return <button type="button" key={series.id.toString()} className="portfolio-position" onClick={() => setSelectedNft(series.id.toString())}>
                <span><strong>veMEZO market #{series.id.toString()}</strong><small>{typeof maturity === 'bigint' ? `Matures ${new Date(Number(maturity) * 1000).toLocaleDateString()}` : 'Loading maturity'}</small></span>
                <span><strong>{displayAmount(pt)} PT</strong><small>{displayAmount(yt)} YT</small></span>
              </button>
            })}
          </div>
          {portfolioPtTotal === BigInt(0) && portfolioYtTotal === BigInt(0) && <p className="field-hint">{isConnected ? 'No PT/YT positions found across these markets yet.' : 'Connect your wallet to see your veMEZO positions.'}</p>}
          {seriesExists && isDeposited && <div className="position-actions-card">
            <div className="section-heading"><div><span className="eyebrow">SELECTED POSITION #{selectedId.toString()}</span><h3>{isSettled ? 'Claims available' : canSettle ? 'Ready to settle' : 'Active position'}</h3></div><span className={`status-pill ${isSettled ? 'status-settled' : 'status-open'}`}>{isSettled ? 'Settled' : 'Active'}</span></div>
            <div className="market-stats"><div><span>Claimable rewards</span><strong>{displayAmount(ytClaimableRead.data)} MEZO</strong></div><div><span>PT balance</span><strong>{displayAmount(ptBalanceRead.data)} PT</strong></div><div><span>YT balance</span><strong>{displayAmount(ytBalanceRead.data)} YT</strong></div></div>
            <div className="action-row">{!isSettled && <button type="button" className="secondary-action" onClick={checkpoint} disabled={busy || !targetReady}>Claim latest rebase</button>}{!isSettled && <button type="button" className="primary-action" onClick={settle} disabled={busy || !targetReady || !canSettle}>Settle after expiry</button>}{isSettled && typeof ptBalanceRead.data === 'bigint' && ptBalanceRead.data > BigInt(0) && <button type="button" className="primary-action" onClick={redeemPrincipal} disabled={busy || !targetReady}>Redeem PT</button>}{isSettled && typeof ytClaimableRead.data === 'bigint' && ytClaimableRead.data > BigInt(0) && <button type="button" className="secondary-action" onClick={claimYield} disabled={busy || !targetReady}>Claim MEZO rewards</button>}</div>
            {!canSettle && !isSettled && <p className="field-hint">Settlement unlocks seven days after expiry, once the rewards distributor has checkpointed through the lock end.</p>}
          </div>}
        </div>}

        {view === 'Developer' && <div className="two-column-workspace developer-tools">
          {!isDeveloper ? <div className="form-card"><h3>Developer access required</h3><p className="field-hint">Connect the configured developer wallet to manage protocol contracts.</p></div> : <>
            <div className="form-card"><span className="eyebrow">VE MEZO ADMIN</span><h3>Shared factory</h3><p className="field-hint">Deployment controls are only shown for the configured developer wallet.</p>
              <form className="protocol-form ve-factory-form" onSubmit={useFactoryAddress}><label htmlFor="ve-factory-address">Factory address</label><input id="ve-factory-address" value={factoryInput} onChange={(event) => setFactoryInput(event.target.value)} placeholder="0x…" /><button className="secondary-action" type="submit">Verify factory</button></form>
              <div className="balance-line"><span>Factory status</span><strong>{factoryVerified ? 'Verified' : 'Not verified'}</strong></div>
              <button type="button" className="primary-action" onClick={deployFactory} disabled={busy || !targetReady}>{busy ? 'Waiting for wallet…' : 'Deploy veMEZO factory'}</button>
            </div>
            <div className="info-card"><span className="eyebrow">CONTRACT REFERENCES</span><h3>Mezo Testnet</h3><div className="address-row"><span>veMEZO</span><code>{VEMEZO_ADDRESS}</code></div><div className="address-row"><span>Rewards distributor</span><code>{VEMEZO_DISTRIBUTOR_ADDRESS}</code></div><div className="address-row"><span>MEZO token</span><code>{MEZO_TOKEN_ADDRESS}</code></div>{factoryAddress && <div className="address-row"><span>Factory</span><code>{factoryAddress}</code></div>}</div>
          </>}
        </div>}
      </div>
    </section>
  )
}
