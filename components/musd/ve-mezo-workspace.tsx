'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useChainId, usePublicClient, useReadContract, useReadContracts, useWalletClient } from 'wagmi'
import { erc20Abi, formatUnits, isAddress, parseUnits, type Abi, type Address, type Hex } from 'viem'
import artifacts from '@/lib/deployment-artifacts.json'
import { MEZO_TESTNET_CHAIN_ID, mezoTestnet } from '@/lib/mezo'
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

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'Transaction could not be completed.'
  const message = error.message.split('\n')[0]
  if (message.includes('User rejected')) return 'Transaction was rejected in the wallet.'
  if (message.includes('insufficient funds')) return 'Not enough MEZO Testnet BTC is available for gas.'
  return message.slice(0, 180)
}

export function VeMezoWorkspace() {
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
  const selectedId = selectedNft ? BigInt(selectedNft) : (ownedNftIds[0] ?? BigInt(0))

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
  const selectedNftOption = selectedId > BigInt(0)

  return (
    <section className="workspace-panel" aria-live="polite">
      <div className="workspace-toolbar">
        <div><span className="eyebrow">NFT-BACKED · MEZO TESTNET</span><h2>veMEZO Rebase Markets</h2></div>
        <div className={`chain-status ${chainId === MEZO_TESTNET_CHAIN_ID ? 'chain-ok' : 'chain-warn'}`}><span className="network-indicator" />{isConnected ? chainId === MEZO_TESTNET_CHAIN_ID ? 'Wallet on Mezo Testnet' : 'Switch to Mezo Testnet' : 'Wallet not connected'}</div>
      </div>

      {status && <p className="transaction-status" role="status">{status}</p>}

      <div className="workspace-content ve-mezo-content">
        <div className="live-source-card">
          <div className="source-heading"><span className="source-icon">v</span><div><span className="eyebrow">LIVE TESTNET CONTRACTS</span><h3>veMEZO escrow and rebase distributor</h3></div><span className="source-live"><i />Chain {MEZO_TESTNET_CHAIN_ID}</span></div>
          <div className="source-metrics">
            <div><span>Underlying</span><strong>MEZO · 18 decimals</strong></div>
            <div><span>Your veMEZO NFTs</span><strong>{nftCountRead.isLoading ? 'Reading…' : String(nftCountRead.data ?? 0)}</strong></div>
            <div><span>Rebase source</span><strong>Weekly RewardsDistributor</strong></div>
            <div><span>Settlement delay</span><strong>7 days + epoch checkpoint</strong></div>
          </div>
          <div className="address-row"><span>veMEZO</span><code>{VEMEZO_ADDRESS}</code><a href={`https://explorer.mezo.org/address/${VEMEZO_ADDRESS}`} target="_blank" rel="noreferrer">Explorer</a></div>
          <div className="address-row"><span>Rewards distributor</span><code>{VEMEZO_DISTRIBUTOR_ADDRESS}</code><a href={`https://explorer.mezo.org/address/${VEMEZO_DISTRIBUTOR_ADDRESS}`} target="_blank" rel="noreferrer">Explorer</a></div>
          <div className="address-row"><span>MEZO token</span><code>{MEZO_TOKEN_ADDRESS}</code><a href={`https://explorer.mezo.org/address/${MEZO_TOKEN_ADDRESS}`} target="_blank" rel="noreferrer">Explorer</a></div>
        </div>

        <div className="two-column-workspace">
          <div className="form-card">
            <span className="eyebrow">POSITION SETUP</span><h3>Select your eligible veMEZO NFT</h3>
            {!isConnected ? <p className="field-hint">Connect a wallet on Mezo Testnet to read veMEZO positions.</p> : nftCount === 0 ? (
              <p className="field-hint">No veMEZO NFTs were found in this wallet. Create a normal MEZO lock on Mezo Testnet first; permanent and managed NFTs are not eligible in this test build.</p>
            ) : (
              <div className="protocol-form">
                <label htmlFor="ve-mezo-token-id">veMEZO NFT</label>
                <select id="ve-mezo-token-id" value={selectedId.toString()} onChange={(event) => setSelectedNft(event.target.value)}>
                  {ownedNftIds.map((id) => <option key={id.toString()} value={id.toString()}>Token #{id.toString()}</option>)}
                </select>
                {lock && <div className="source-metrics ve-position-metrics">
                  <div><span>Locked principal</span><strong>{displayAmount(BigInt(lock.amount < 0 ? -lock.amount : lock.amount))} MEZO</strong></div>
                  <div><span>Lock expiry</span><strong>{new Date(Number(lock.end) * 1000).toLocaleString()}</strong></div>
                  <div><span>Position type</span><strong>{escrowTypeRead.data === 0 ? 'Normal veNFT' : 'Managed / locked'}</strong></div>
                  <div><span>Eligibility</span><strong>{nftEligible ? 'Eligible' : 'Not eligible'}</strong></div>
                </div>}
                {factoryAddress && !factoryVerified && <p className="field-hint field-warning">This factory address does not match the live veMEZO and MEZO contracts. Verify the address or deploy a new testnet factory.</p>}
                {factoryVerified && seriesExists && <div className="address-row"><span>Tranche</span><code>{trancheAddress}</code><a href={`https://explorer.mezo.org/address/${trancheAddress}`} target="_blank" rel="noreferrer">Explorer</a></div>}
                {factoryVerified && seriesExists && <div className="address-row"><span>PT/YT market</span><code>{marketAddress}</code><a href={`https://explorer.mezo.org/address/${marketAddress}`} target="_blank" rel="noreferrer">Explorer</a></div>}
                {factoryVerified && !seriesExists && <button type="button" className="primary-action" onClick={createSeries} disabled={busy || !targetReady || !nftEligible}>{busy ? 'Waiting for wallet…' : 'Create this NFT’s PT/YT market'}</button>}
                {factoryVerified && seriesExists && !isDeposited && <button type="button" className="primary-action" onClick={depositNft} disabled={busy || !targetReady || !nftEligible}>{busy ? 'Waiting for wallet…' : 'Approve NFT and mint PT + YT'}</button>}
                {isDeposited && <div className="balance-line"><span>Escrowed principal</span><strong>{displayAmount(principalAmountRead.data)} MEZO</strong></div>}
              </div>
            )}
            {!factoryAddress ? <div className="protocol-form"><p className="field-hint">Deploy one shared veMEZO factory on testnet. This uses the live veMEZO, distributor, and MEZO addresses above.</p><button type="button" className="primary-action" onClick={deployFactory} disabled={busy || !targetReady}>{busy ? 'Waiting for wallet…' : 'Deploy veMEZO factory'}</button></div> : (
              <form className="protocol-form ve-factory-form" onSubmit={useFactoryAddress}>
                <label htmlFor="ve-factory-address">Shared factory address</label><input id="ve-factory-address" value={factoryInput} onChange={(event) => setFactoryInput(event.target.value)} placeholder="0x…" />
                <button className="secondary-action" type="submit">Use factory address</button>
                {!factoryVerified && <button type="button" className="secondary-action" onClick={deployFactory} disabled={busy || !targetReady}>{busy ? 'Waiting for wallet…' : 'Deploy a new factory'}</button>}
              </form>
            )}
          </div>

          <div className="info-card">
            <span className="eyebrow">TESTNET MODEL · SINGLE NFT TRANCHE</span><h3>How this prototype settles</h3>
            <div className="token-explainer"><b>PT</b><span>Redeems the MEZO amount locked when the NFT was deposited. That principal is fixed before new YT rewards start.</span></div>
            <div className="token-explainer"><b>YT</b><span>Accrues only rebases claimed after deposit. Transfers checkpoint rewards so the previous holder keeps accrued amounts.</span></div>
            <div className="token-explainer"><b>1</b><span>One series is created per NFT because each lock has its own expiry; only normal, non-permanent positions are accepted.</span></div>
            <div className="token-explainer"><b>2</b><span>At maturity, the NFT is withdrawn and burned by Mezo’s escrow; PT and YT holders redeem MEZO, not the original NFT.</span></div>
            <p className="field-hint">Rebase claims require the Mezo distributor’s epoch to be updated. Settlement waits seven days after expiry and verifies the distributor cursor reached maturity before burning the NFT.</p>
          </div>
        </div>

        {seriesExists && isDeposited && (
          <div className="two-column-workspace">
            <div className="series-card">
              <div className="section-heading"><div><span className="eyebrow">ESCROWED VE MEZO POSITION</span><h3>PT-veMEZO / YT-veMEZO</h3></div><span className={`status-pill ${isSettled ? 'status-settled' : 'status-open'}`}>{isSettled ? 'Settled' : canSettle ? 'Ready to settle' : 'Active'}</span></div>
              <div className="source-metrics">
                <div><span>Maturity</span><strong>{maturity ? new Date(Number(maturity) * 1000).toLocaleString() : '—'}</strong></div>
                <div><span>Your PT</span><strong>{displayAmount(ptBalanceRead.data)} PT-veMEZO</strong></div>
                <div><span>Your YT</span><strong>{displayAmount(ytBalanceRead.data)} YT-veMEZO</strong></div>
                <div><span>Claimable YT rewards</span><strong>{displayAmount(ytClaimableRead.data)} MEZO</strong></div>
                {isSettled && <>
                  <div><span>PT redemption rate</span><strong>{displayAmount(principalClaimRead.data)} MEZO total</strong></div>
                  <div><span>Remaining YT reserve</span><strong>{displayAmount(yieldReserveRead.data)} MEZO</strong></div>
                </>}
              </div>
              <div className="action-row">
                {!isSettled && <button type="button" className="secondary-action" onClick={checkpoint} disabled={busy || !targetReady}>Checkpoint rebase</button>}
                {isDeposited && !isSettled && <button type="button" className="primary-action" onClick={settle} disabled={busy || !targetReady || !canSettle}>Settle after expiry</button>}
                {isSettled && typeof ptBalanceRead.data === 'bigint' && ptBalanceRead.data > BigInt(0) && <button type="button" className="primary-action" onClick={redeemPrincipal} disabled={busy || !targetReady}>Redeem all PT</button>}
                {isSettled && typeof ytClaimableRead.data === 'bigint' && ytClaimableRead.data > BigInt(0) && <button type="button" className="secondary-action" onClick={claimYield} disabled={busy || !targetReady}>Claim YT MEZO</button>}
              </div>
              {!canSettle && !isSettled && <p className="field-hint">{settlementDelayPassed && distributorCursor < maturity ? 'Waiting for the rewards distributor to checkpoint through this NFT’s expiry; the contract will not burn the NFT before then.' : 'Settlement unlocks seven days after the NFT lock expiry so the last weekly rebase can be accounted for.'}</p>}
            </div>

            <div className="form-card">
              <span className="eyebrow">MEZO SPOT MARKET · 0.30% FEE</span><h3>Trade PT or YT against MEZO</h3>
              <div className="segmented-control"><button type="button" className={tradeToken === 'PT' ? 'segment-active' : ''} onClick={() => { setTradeToken('PT'); setTradeAmount('') }}>PT-veMEZO</button><button type="button" className={tradeToken === 'YT' ? 'segment-active' : ''} onClick={() => { setTradeToken('YT'); setTradeAmount('') }}>YT-veMEZO</button></div>
              <div className="source-metrics">
                <div><span>MEZO reserve</span><strong>{displayAmount(reserveMezo)} MEZO</strong></div>
                <div><span>{tradeToken} reserve</span><strong>{displayAmount(reserveToken)} {tradeToken}-veMEZO</strong></div>
                <div><span>Your MEZO</span><strong>{displayAmount(mezoBalanceRead.data)} MEZO</strong></div>
                <div><span>Your {tradeToken}</span><strong>{displayAmount(currentTokenBalance)} {tradeToken}-veMEZO</strong></div>
              </div>
              <form className="protocol-form" onSubmit={trade}>
                <label htmlFor="ve-trade-side">You pay</label><select id="ve-trade-side" value={tradeSide} onChange={(event) => setTradeSide(event.target.value as 'MEZO' | 'TOKEN')}><option value="MEZO">MEZO</option><option value="TOKEN">{tradeToken}-veMEZO</option></select>
                <label htmlFor="ve-trade-amount">Amount</label><div className="amount-input"><input id="ve-trade-amount" inputMode="decimal" value={tradeAmount} onChange={(event) => setTradeAmount(event.target.value)} placeholder="0.00" /><span>{tradeSide === 'MEZO' ? 'MEZO' : `${tradeToken}-veMEZO`}</span></div>
                <div className="balance-line"><span>Estimated receive</span><strong>{displayAmount(quoteRead.data)} {tradeSide === 'MEZO' ? `${tradeToken}-veMEZO` : 'MEZO'}</strong></div>
                <button className="primary-action" disabled={busy || !targetReady || !marketAddress}>{busy ? 'Waiting for wallet…' : `Swap ${tradeSide === 'MEZO' ? 'MEZO' : `${tradeToken}-veMEZO`}`}</button>
              </form>
            </div>
          </div>
        )}

        {seriesExists && isDeposited && marketAddress && tokenAddress && (
          <div className="two-column-workspace">
            <div className="form-card">
              <span className="eyebrow">PERMISSIONLESS LIQUIDITY</span><h3>Add MEZO + {tradeToken}-veMEZO</h3>
              <div className="source-metrics"><div><span>Your LP shares</span><strong>{displayAmount(lpBalanceRead.data)}</strong></div><div><span>Total pool shares</span><strong>{displayAmount(liquiditySupply)}</strong></div></div>
              <form className="protocol-form" onSubmit={addLiquidity}>
                <label htmlFor="ve-lp-mezo">MEZO amount</label><input id="ve-lp-mezo" inputMode="decimal" value={liquidityMezo} onChange={(event) => setLiquidityMezo(event.target.value)} placeholder="0.00" />
                <label htmlFor="ve-lp-token">{tradeToken}-veMEZO amount</label><input id="ve-lp-token" inputMode="decimal" value={liquidityToken} onChange={(event) => setLiquidityToken(event.target.value)} placeholder="0.00" />
                <button className="primary-action" disabled={busy || !targetReady}>{busy ? 'Waiting for wallet…' : 'Approve and add liquidity'}</button>
              </form>
            </div>
            <div className="form-card">
              <span className="eyebrow">LP POSITION</span><h3>Remove liquidity</h3>
              <form className="protocol-form" onSubmit={removeLiquidity}>
                <label htmlFor="ve-lp-shares">LP shares to remove</label><input id="ve-lp-shares" inputMode="decimal" value={removeShares} onChange={(event) => setRemoveShares(event.target.value)} placeholder="0.00" />
                <p className="field-hint">Your MEZO and {tradeToken} amounts are returned pro rata. YT-pool rebase proceeds are reflected in the MEZO reserve after settlement.</p>
                <button className="secondary-action" disabled={busy || !targetReady}>{busy ? 'Waiting for wallet…' : 'Remove liquidity'}</button>
              </form>
            </div>
          </div>
        )}

        <div className="risk-note"><strong>Testnet prototype; unaudited.</strong><span>Only deposit testnet veMEZO NFTs you are willing to consume. On settlement, Mezo burns the expired NFT and returns its MEZO to the PT/YT series. Verify the contract address, lock expiry, and gas estimate in your wallet before confirming.</span></div>
      </div>
    </section>
  )
}
