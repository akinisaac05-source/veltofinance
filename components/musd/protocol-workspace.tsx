'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useChainId, usePublicClient, useReadContract, useWalletClient } from 'wagmi'
import {
  erc20Abi,
  formatUnits,
  isAddress,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import artifacts from '@/lib/deployment-artifacts.json'
import { MEZO_TESTNET_CHAIN_ID, MUSD_ADDRESS, SMUSD_VAULT_ADDRESS, YIELD_SERIES_FACTORY_ADDRESS, mezoTestnet } from '@/lib/mezo'

export type WorkspaceView = 'Markets' | 'Trade' | 'Mint' | 'Portfolio' | 'Redeem' | 'Create'

const exchangeAbi = artifacts.YieldExchange.abi as Abi
const marketAbi = artifacts.YieldMarket.abi as Abi
const factoryAbi = artifacts.YieldSeriesFactory.abi as Abi
const factoryBytecode = artifacts.YieldSeriesFactory.bytecode as Hex
const yieldTokenAbi = [
  ...erc20Abi,
  { type: 'function', name: 'claimYield', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: 'amount', type: 'uint256' }] },
  { type: 'function', name: 'claimableYield', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'amount', type: 'uint256' }] },
] as Abi
const zeroAddress = '0x0000000000000000000000000000000000000000' as Address
const factoryPageSize = 25

function asAddress(value: unknown): Address | undefined {
  return typeof value === 'string' && isAddress(value) && value.toLowerCase() !== zeroAddress ? value : undefined
}

function amount(value: unknown) {
  if (typeof value !== 'bigint') return '—'
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function inputAmount(value: bigint) {
  const formatted = formatUnits(value, 18)
  const trimmed = formatted.includes('.') ? formatted.replace(/0+$/, '').replace(/\.$/, '') : formatted
  return trimmed || '0'
}

function integerSqrt(value: bigint) {
  if (value < BigInt(2)) return value
  let current = value
  let next = (current + BigInt(1)) / BigInt(2)
  while (next < current) {
    current = next
    next = (current + value / current) / BigInt(2)
  }
  return current
}

function AddressText({ label, value }: { label: string; value?: Address }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <div className="address-row">
      <span>{label}</span>
      <code title={value}>{`${value.slice(0, 8)}…${value.slice(-6)}`}</code>
      <button
        type="button"
        className="text-button"
        aria-label={`Copy ${label} address`}
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1_500)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function ProtocolWorkspace({
  view,
  onNavigate,
}: {
  view: WorkspaceView
  onNavigate: (view: WorkspaceView) => void
}) {
  const [factoryAddress, setFactoryAddress] = useState<Address | undefined>(YIELD_SERIES_FACTORY_ADDRESS)
  const [selectedSeriesIndex, setSelectedSeriesIndex] = useState(-1)
  const [maturityInput, setMaturityInput] = useState('')
  const [mintAmount, setMintAmount] = useState('')
  const [tradeAmount, setTradeAmount] = useState('')
  const [tradePercent, setTradePercent] = useState(0)
  const [assetLiquidity, setAssetLiquidity] = useState('')
  const [tokenLiquidity, setTokenLiquidity] = useState('')
  const [removeLiquidityAmount, setRemoveLiquidityAmount] = useState('')
  const [addLiquidityPercent, setAddLiquidityPercent] = useState(0)
  const [removeLiquidityPercent, setRemoveLiquidityPercent] = useState(0)
  const [tradeToken, setTradeToken] = useState<'PT' | 'YT'>('PT')
  const [tradeDirection, setTradeDirection] = useState<'MUSD' | 'TOKEN'>('MUSD')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const walletClient = useWalletClient()
  const publicClient = usePublicClient({ chainId: MEZO_TESTNET_CHAIN_ID })
  const queryClient = useQueryClient()
  const isTargetChain = chainId === MEZO_TESTNET_CHAIN_ID
  const accountRef = address ?? zeroAddress

  const factorySeriesCountRead = useReadContract({
    address: factoryAddress ?? zeroAddress,
    abi: factoryAbi,
    functionName: 'seriesCount',
    query: { enabled: Boolean(factoryAddress) },
  })
  const totalSeriesCount = typeof factorySeriesCountRead.data === 'bigint' ? Number(factorySeriesCountRead.data) : 0
  const activeSeriesIndex = selectedSeriesIndex >= 0
    ? Math.min(selectedSeriesIndex, Math.max(totalSeriesCount - 1, 0))
    : Math.max(totalSeriesCount - 1, 0)
  const seriesPageStart = Math.floor(activeSeriesIndex / factoryPageSize) * factoryPageSize
  const factorySeriesRead = useReadContract({
    address: factoryAddress ?? zeroAddress,
    abi: factoryAbi,
    functionName: 'seriesPage',
    args: [BigInt(seriesPageStart), BigInt(factoryPageSize)],
    query: { enabled: Boolean(factoryAddress) },
  })
  const seriesListings = useMemo(() => {
    const result = factorySeriesRead.data
    if (!Array.isArray(result)) return []
    const [exchanges, markets, maturities, creators] = result
    if (!Array.isArray(exchanges) || !Array.isArray(markets) || !Array.isArray(maturities) || !Array.isArray(creators)) return []

    return exchanges.flatMap((exchange, index) => {
      const exchangeAddress = asAddress(exchange)
      const marketAddress = asAddress(markets[index])
      const maturity = maturities[index]
      const creator = asAddress(creators[index])
      if (!exchangeAddress || !marketAddress || typeof maturity !== 'bigint') return []
      return [{ index: seriesPageStart + index, exchange: exchangeAddress, market: marketAddress, maturity, creator }]
    })
  }, [factorySeriesRead.data, seriesPageStart])
  const activeSeries = seriesListings.find((series) => series.index === activeSeriesIndex)
  const exchangeAddress = activeSeries?.exchange
  const marketAddress = activeSeries?.market
  const exchangeRef = exchangeAddress ?? zeroAddress
  const marketRef = marketAddress ?? zeroAddress

  const vaultName = useReadContract({
    address: SMUSD_VAULT_ADDRESS,
    abi: erc20Abi,
    functionName: 'name',
  })
  const vaultSymbol = useReadContract({
    address: SMUSD_VAULT_ADDRESS,
    abi: erc20Abi,
    functionName: 'symbol',
  })
  const vaultSupply = useReadContract({
    address: SMUSD_VAULT_ADDRESS,
    abi: erc20Abi,
    functionName: 'totalSupply',
  })
  const musdBalance = useReadContract({
    address: MUSD_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [accountRef],
    query: { enabled: Boolean(address) },
  })
  const ptAddressRead = useReadContract({
    address: exchangeRef,
    abi: exchangeAbi,
    functionName: 'principalToken',
    query: { enabled: Boolean(exchangeAddress) },
  })
  const ytAddressRead = useReadContract({
    address: exchangeRef,
    abi: exchangeAbi,
    functionName: 'yieldToken',
    query: { enabled: Boolean(exchangeAddress) },
  })
  const maturityRead = useReadContract({
    address: exchangeRef,
    abi: exchangeAbi,
    functionName: 'maturity',
    query: { enabled: Boolean(exchangeAddress) },
  })
  const principalDepositedRead = useReadContract({
    address: exchangeRef,
    abi: exchangeAbi,
    functionName: 'principalDeposited',
    query: { enabled: Boolean(exchangeAddress) },
  })
  const principalClaimRead = useReadContract({
    address: exchangeRef,
    abi: exchangeAbi,
    functionName: 'principalClaim',
    query: { enabled: Boolean(exchangeAddress) },
  })
  const unclaimedPrincipalRead = useReadContract({
    address: exchangeRef,
    abi: exchangeAbi,
    functionName: 'unclaimedPrincipal',
    query: { enabled: Boolean(exchangeAddress) },
  })
  const yieldReserveRead = useReadContract({
    address: exchangeRef,
    abi: exchangeAbi,
    functionName: 'yieldReserve',
    query: { enabled: Boolean(exchangeAddress) },
  })
  const settledRead = useReadContract({
    address: exchangeRef,
    abi: exchangeAbi,
    functionName: 'settled',
    query: { enabled: Boolean(exchangeAddress) },
  })

  const principalAddress = asAddress(ptAddressRead.data)
  const yieldAddress = asAddress(ytAddressRead.data)
  const tokenAddress = tradeToken === 'PT' ? principalAddress : yieldAddress
  const inputAddress = tradeDirection === 'MUSD' ? MUSD_ADDRESS : tokenAddress
  const parsedTradeAmount = useMemo(() => {
    try {
      return tradeAmount && Number(tradeAmount) > 0 ? parseUnits(tradeAmount, 18) : BigInt(0)
    } catch {
      return BigInt(0)
    }
  }, [tradeAmount])
  const marketQuote = useReadContract({
    address: marketRef,
    abi: marketAbi,
    functionName: 'quote',
    args: [tokenAddress ?? zeroAddress, inputAddress ?? zeroAddress, parsedTradeAmount],
    query: { enabled: Boolean(marketAddress && tokenAddress && parsedTradeAmount > BigInt(0)) },
  })
  const ptPool = useReadContract({
    address: marketRef,
    abi: marketAbi,
    functionName: 'pool',
    args: [principalAddress ?? zeroAddress],
    query: { enabled: Boolean(marketAddress && principalAddress) },
  })
  const ytPool = useReadContract({
    address: marketRef,
    abi: marketAbi,
    functionName: 'pool',
    args: [yieldAddress ?? zeroAddress],
    query: { enabled: Boolean(marketAddress && yieldAddress) },
  })
  const userPtBalance = useReadContract({
    address: principalAddress ?? zeroAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [accountRef],
    query: { enabled: Boolean(principalAddress && address) },
  })
  const userYtBalance = useReadContract({
    address: yieldAddress ?? zeroAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [accountRef],
    query: { enabled: Boolean(yieldAddress && address) },
  })
  const userYtClaimable = useReadContract({
    address: yieldAddress ?? zeroAddress,
    abi: yieldTokenAbi,
    functionName: 'claimableYield',
    args: [accountRef],
    query: { enabled: Boolean(yieldAddress && address) },
  })
  const ptAllowance = useReadContract({
    address: MUSD_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [accountRef, exchangeRef],
    query: { enabled: Boolean(address && exchangeAddress) },
  })
  const tokenAllowance = useReadContract({
    address: inputAddress ?? zeroAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [accountRef, marketRef],
    query: { enabled: Boolean(address && marketAddress && inputAddress) },
  })
  const assetPoolAllowance = useReadContract({
    address: MUSD_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [accountRef, marketRef],
    query: { enabled: Boolean(address && marketAddress) },
  })
  const liquidityTokenAllowance = useReadContract({
    address: tokenAddress ?? zeroAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [accountRef, marketRef],
    query: { enabled: Boolean(address && marketAddress && tokenAddress) },
  })
  const tokenLiquidityBalance = useReadContract({
    address: marketRef,
    abi: marketAbi,
    functionName: 'liquidityOf',
    args: [tokenAddress ?? zeroAddress, accountRef],
    query: { enabled: Boolean(address && marketAddress && tokenAddress) },
  })
  const ytLiquidityYieldClaimable = useReadContract({
    address: marketRef,
    abi: marketAbi,
    functionName: 'claimableLiquidityYield',
    args: [yieldAddress ?? zeroAddress, accountRef],
    query: { enabled: Boolean(address && marketAddress && yieldAddress) },
  })
  const sourceYieldRead = useReadContract({
    address: SMUSD_VAULT_ADDRESS,
    abi: [{ type: 'function', name: 'claimableYield', stateMutability: 'view', inputs: [{ name: 'holder', type: 'address' }], outputs: [{ name: 'amount', type: 'uint256' }] }],
    functionName: 'claimableYield',
    args: [exchangeRef],
    query: { enabled: Boolean(exchangeAddress) },
  })

  const maturitySeconds = typeof maturityRead.data === 'bigint' ? maturityRead.data : BigInt(0)
  const isMature = maturitySeconds > BigInt(0) && Math.floor(Date.now() / 1000) >= Number(maturitySeconds)
  const isSettled = settledRead.data === true
  const targetReady = isConnected && isTargetChain && Boolean(address)
  const sourceVerified = vaultName.data === 'MUSD Savings Rate' && vaultSymbol.data === 'sMUSD' && typeof vaultSupply.data === 'bigint'
  const canCreateSeries = targetReady && sourceVerified && Boolean(factoryAddress)
  const selectedPool = tradeToken === 'PT' ? ptPool.data : ytPool.data
  const selectedPoolParts = Array.isArray(selectedPool) ? selectedPool : []
  const reserveAsset = typeof selectedPoolParts[0] === 'bigint' ? selectedPoolParts[0] : BigInt(0)
  const reserveToken = typeof selectedPoolParts[1] === 'bigint' ? selectedPoolParts[1] : BigInt(0)
  const liquiditySupply = typeof selectedPoolParts[2] === 'bigint' ? selectedPoolParts[2] : BigInt(0)
  const selectedWalletTokenBalance = tradeToken === 'PT' ? userPtBalance.data : userYtBalance.data
  const walletAssetBalance = typeof musdBalance.data === 'bigint' ? musdBalance.data : BigInt(0)
  const walletTokenBalance = typeof selectedWalletTokenBalance === 'bigint' ? selectedWalletTokenBalance : BigInt(0)
  const walletLiquidityShares = typeof tokenLiquidityBalance.data === 'bigint' ? tokenLiquidityBalance.data : BigInt(0)
  const tradeInputBalanceRead = tradeDirection === 'MUSD' ? musdBalance.data : selectedWalletTokenBalance
  const tradeInputBalance = typeof tradeInputBalanceRead === 'bigint' ? tradeInputBalanceRead : BigInt(0)
  const tradeInputSymbol = tradeDirection === 'MUSD' ? 'MUSD' : `${tradeToken}-MUSD`
  const tradeOutputSymbol = tradeDirection === 'MUSD' ? `${tradeToken}-MUSD` : 'MUSD'

  const invalidateChainData = async () => {
    await queryClient.invalidateQueries()
  }

  const waitForTransaction = async (hash: Hex, label: string) => {
    if (!publicClient) throw new Error('Mezo Testnet RPC is unavailable.')
    setStatus(`${label} submitted. Waiting for Mezo Testnet confirmation…`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${label} reverted on chain.`)
    await invalidateChainData()
    return receipt
  }

  const ensureWallet = () => {
    if (!address || !walletClient.data || !publicClient) throw new Error('Connect a wallet to continue.')
    if (!isTargetChain) throw new Error('Switch your wallet to Mezo Testnet first.')
    return { account: address, client: walletClient.data }
  }

  const runWrite = async (label: string, action: (account: Address) => Promise<Hex>) => {
    setBusy(true)
    setStatus('')
    try {
      const { account } = ensureWallet()
      const hash = await action(account)
      await waitForTransaction(hash, label)
      setStatus(`${label} confirmed.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Transaction could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const deployFactory = async () => {
    setBusy(true)
    setStatus('')
    try {
      const { account, client } = ensureWallet()
      if (!sourceVerified) throw new Error('The configured sMUSD vault has not passed its live on-chain identity checks.')
      const hash = await client.deployContract({
        account,
        chain: mezoTestnet,
        abi: factoryAbi,
        bytecode: factoryBytecode,
        args: [MUSD_ADDRESS, SMUSD_VAULT_ADDRESS],
      })
      const receipt = await waitForTransaction(hash, 'Shared factory deployment')
      if (!receipt.contractAddress) throw new Error('The factory deployment receipt did not include a contract address.')
      setFactoryAddress(receipt.contractAddress)
      setStatus('Shared factory deployed. Copy its address below, then set NEXT_PUBLIC_YIELD_SERIES_FACTORY_ADDRESS to make the same factory available to every visitor.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Factory deployment could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const createSeries = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setStatus('')
    try {
      const { account, client } = ensureWallet()
      if (!factoryAddress) throw new Error('The shared series factory is not configured for this app.')
      if (!sourceVerified) throw new Error('The configured sMUSD vault has not passed its live on-chain identity checks.')
      const maturityTimestamp = Math.floor(new Date(maturityInput).getTime() / 1000)
      if (!Number.isFinite(maturityTimestamp) || maturityTimestamp <= Math.floor(Date.now() / 1000)) {
        throw new Error('Choose a future maturity date and time.')
      }

      const hash = await client.writeContract({
        account,
        chain: mezoTestnet,
        address: factoryAddress,
        abi: factoryAbi,
        functionName: 'createSeries',
        args: [BigInt(maturityTimestamp)],
      })
      await waitForTransaction(hash, 'Shared PT/YT market creation')
      setSelectedSeriesIndex(-1)
      setMaturityInput('')
      setStatus('Shared maturity created and registered. Every app user can now select this market.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Market creation could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const mint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!exchangeAddress) return setStatus('Select a registered PT/YT market first.')
    let parsed: bigint
    try {
      parsed = parseUnits(mintAmount, 18)
      if (parsed <= BigInt(0)) return setStatus('Enter an amount greater than zero.')
    } catch {
      return setStatus('Enter a valid MUSD amount.')
    }
    await runWrite('Mint PT/YT', async (account) => {
      const { client } = ensureWallet()
      const allowance = typeof ptAllowance.data === 'bigint' ? ptAllowance.data : BigInt(0)
      if (allowance < parsed) {
        const approval = await client.writeContract({
          account,
          chain: mezoTestnet,
          address: MUSD_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [exchangeAddress, parsed],
        })
        await waitForTransaction(approval, 'MUSD approval')
      }
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: exchangeAddress,
        abi: exchangeAbi,
        functionName: 'deposit',
        args: [parsed, account],
      } as never)
    })
  }

  const performTrade = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!marketAddress || !tokenAddress || !inputAddress || !parsedTradeAmount) return setStatus('Enter a valid trade amount.')
    const quote = typeof marketQuote.data === 'bigint' ? marketQuote.data : BigInt(0)
    if (quote === BigInt(0)) return setStatus('This pool has no live quote yet. Add liquidity first.')
    const minOut = (quote * BigInt(9_900)) / BigInt(10_000)
    await runWrite(`${tradeDirection === 'MUSD' ? 'Buy' : 'Sell'} ${tradeToken}`, async (account) => {
      const { client } = ensureWallet()
      const allowance = typeof tokenAllowance.data === 'bigint' ? tokenAllowance.data : BigInt(0)
      if (allowance < parsedTradeAmount) {
        const approval = await client.writeContract({
          account,
          chain: mezoTestnet,
          address: inputAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [marketAddress, parsedTradeAmount],
        })
        await waitForTransaction(approval, `${tradeDirection === 'MUSD' ? tradeToken : 'MUSD'} approval`)
      }
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: marketAddress,
        abi: marketAbi,
        functionName: 'swapExactIn',
        args: [tokenAddress, inputAddress, parsedTradeAmount, minOut, account],
      } as never)
    })
  }

  const selectTradeToken = (token: 'PT' | 'YT') => {
    if (tradeToken === token) return
    setTradeToken(token)
    setTradeAmount('')
    setTradePercent(0)
    setAssetLiquidity('')
    setTokenLiquidity('')
    setAddLiquidityPercent(0)
    setRemoveLiquidityAmount('')
    setRemoveLiquidityPercent(0)
  }

  const selectTradeDirection = (direction: 'MUSD' | 'TOKEN') => {
    if (tradeDirection === direction) return
    setTradeDirection(direction)
    setTradeAmount('')
    setTradePercent(0)
  }

  const applyTradePercent = (value: number) => {
    const percent = Math.min(100, Math.max(0, value))
    setTradePercent(percent)
    setTradeAmount(inputAmount((tradeInputBalance * BigInt(percent)) / BigInt(100)))
  }

  const applyAddLiquidityPercent = (value: number) => {
    const percent = Math.min(100, Math.max(0, value))
    const percentage = BigInt(percent)
    let assetAmount = (walletAssetBalance * percentage) / BigInt(100)
    let tokenAmount = (walletTokenBalance * percentage) / BigInt(100)

    if (liquiditySupply > BigInt(0) && reserveAsset > BigInt(0) && reserveToken > BigInt(0)) {
      const assetLimitFromToken = (walletTokenBalance * reserveAsset) / reserveToken
      const maxBalancedAsset = walletAssetBalance < assetLimitFromToken ? walletAssetBalance : assetLimitFromToken
      assetAmount = (maxBalancedAsset * percentage) / BigInt(100)
      tokenAmount = (assetAmount * reserveToken) / reserveAsset
    }

    setAddLiquidityPercent(percent)
    setAssetLiquidity(inputAmount(assetAmount))
    setTokenLiquidity(inputAmount(tokenAmount))
  }

  const applyRemoveLiquidityPercent = (value: number) => {
    const percent = Math.min(100, Math.max(0, value))
    setRemoveLiquidityPercent(percent)
    setRemoveLiquidityAmount(inputAmount((walletLiquidityShares * BigInt(percent)) / BigInt(100)))
  }

  const addLiquidity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!marketAddress || !tokenAddress) return setStatus('Select a registered PT/YT market first.')
    let assetAmount: bigint
    let tokenAmount: bigint
    try {
      assetAmount = parseUnits(assetLiquidity, 18)
      tokenAmount = parseUnits(tokenLiquidity, 18)
      if (assetAmount <= BigInt(0) || tokenAmount <= BigInt(0)) return setStatus('Enter positive liquidity amounts.')
    } catch {
      return setStatus('Enter valid liquidity amounts.')
    }
    await runWrite('Add liquidity', async (account) => {
      const { client } = ensureWallet()
      const assetAllowance = typeof assetPoolAllowance.data === 'bigint' ? assetPoolAllowance.data : BigInt(0)
      if (assetAllowance < assetAmount) {
        const approval = await client.writeContract({
          account,
          chain: mezoTestnet,
          address: MUSD_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [marketAddress, assetAmount],
        })
        await waitForTransaction(approval, 'MUSD approval')
      }
      const sideAllowance = typeof liquidityTokenAllowance.data === 'bigint' ? liquidityTokenAllowance.data : BigInt(0)
      let expectedShares: bigint
      if (liquiditySupply === BigInt(0)) {
        const root = integerSqrt(assetAmount * tokenAmount)
        if (root <= BigInt(1_000)) throw new Error('Initial liquidity must exceed the locked minimum.')
        expectedShares = root - BigInt(1_000)
      } else {
        if (reserveAsset === BigInt(0) || reserveToken === BigInt(0)) throw new Error('This pool is not available for liquidity yet.')
        const sharesByAsset = (assetAmount * liquiditySupply) / reserveAsset
        const sharesByToken = (tokenAmount * liquiditySupply) / reserveToken
        expectedShares = sharesByAsset < sharesByToken ? sharesByAsset : sharesByToken
      }
      if (expectedShares === BigInt(0)) throw new Error('The proposed amounts produce no liquidity shares.')
      const minShares = (expectedShares * BigInt(9_900)) / BigInt(10_000)
      if (sideAllowance < tokenAmount) {
        const approval = await client.writeContract({
          account,
          chain: mezoTestnet,
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [marketAddress, tokenAmount],
        })
        await waitForTransaction(approval, `${tradeToken} approval`)
      }
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: marketAddress,
        abi: marketAbi,
        functionName: 'addLiquidity',
        args: [tokenAddress, assetAmount, tokenAmount, minShares || BigInt(1)],
      } as never)
    })
  }

  const removeLiquidity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!marketAddress || !tokenAddress) return
    let shares: bigint
    try {
      shares = parseUnits(removeLiquidityAmount, 18)
      if (shares <= BigInt(0)) return setStatus('Enter a positive LP share amount.')
    } catch {
      return setStatus('Enter a valid LP share amount.')
    }
    if (liquiditySupply === BigInt(0) || shares > (typeof tokenLiquidityBalance.data === 'bigint' ? tokenLiquidityBalance.data : BigInt(0))) {
      return setStatus('Pool shares are unavailable or exceed your position.')
    }
    const expectedAssetOut = (shares * reserveAsset) / liquiditySupply
    const expectedTokenOut = (shares * reserveToken) / liquiditySupply
    const minAssetOut = (expectedAssetOut * BigInt(9_900)) / BigInt(10_000)
    const minTokenOut = (expectedTokenOut * BigInt(9_900)) / BigInt(10_000)
    await runWrite('Remove liquidity', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: marketAddress,
        abi: marketAbi,
        functionName: 'removeLiquidity',
        args: [tokenAddress, shares, minAssetOut, minTokenOut],
      } as never)
    })
  }

  const harvest = async () => {
    if (!exchangeAddress) return
    await runWrite('Harvest realized sMUSD yield', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: exchangeAddress,
        abi: exchangeAbi,
        functionName: 'harvestYield',
      } as never)
    })
  }

  const settle = async () => {
    if (!exchangeAddress) return
    await runWrite('Settle series', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: exchangeAddress,
        abi: exchangeAbi,
        functionName: 'settle',
      } as never)
    })
  }

  const redeem = async () => {
    if (!exchangeAddress || typeof userPtBalance.data !== 'bigint' || userPtBalance.data === BigInt(0)) return
    await runWrite('Redeem PT principal', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: exchangeAddress,
        abi: exchangeAbi,
        functionName: 'redeemPrincipal',
        args: [userPtBalance.data],
      } as never)
    })
  }

  const claimYield = async () => {
    if (!yieldAddress) return
    await runWrite('Claim realized yield', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: yieldAddress,
        abi: yieldTokenAbi,
        functionName: 'claimYield',
      } as never)
    })
  }

  const claimLiquidityYield = async () => {
    if (!marketAddress || !yieldAddress) return
    await runWrite('Claim YT-pool LP yield', async (account) => {
      const { client } = ensureWallet()
      return client.writeContract({
        account,
        chain: mezoTestnet,
        address: marketAddress,
        abi: marketAbi,
        functionName: 'claimLiquidityYield',
        args: [yieldAddress],
      } as never)
    })
  }

  return (
    <section className="workspace-panel" aria-live="polite">
      <div className="workspace-toolbar">
        <div>
          <span className="eyebrow">LIVE MEZO TESTNET</span>
          <h2>{view === 'Create' ? 'Create a shared maturity' : view}</h2>
        </div>
        <div className={`chain-status ${isTargetChain ? 'chain-ok' : 'chain-warn'}`}>
          <span className="network-indicator" />{isConnected ? (isTargetChain ? 'Wallet on Mezo Testnet' : 'Switch to Mezo Testnet') : 'Wallet not connected'}
        </div>
      </div>

      {status && <p className="transaction-status" role="status">{status}</p>}

      {view === 'Markets' && (
        <div className="workspace-content">
          <div className="live-source-card">
            <div className="source-heading"><span className="source-icon">s</span><div><span className="eyebrow">LIVE ON-CHAIN SOURCE</span><h3>{vaultName.isLoading ? 'Reading live source…' : String(vaultName.data ?? 'MUSD Savings Rate')}</h3></div><span className={`source-live ${sourceVerified ? '' : 'source-checking'}`}><i />{vaultName.isError ? 'Unavailable' : sourceVerified ? 'Matched' : 'Checking'}</span></div>
            <div className="source-metrics">
              <div><span>Receipt token</span><strong>{String(vaultSymbol.data ?? 'sMUSD')}</strong></div>
              <div><span>On-chain supply</span><strong>{amount(vaultSupply.data)} sMUSD</strong></div>
              <div><span>Underlying</span><strong>MUSD · 18 decimals</strong></div>
              <div><span>Chain ID</span><strong>{MEZO_TESTNET_CHAIN_ID}</strong></div>
            </div>
            <AddressText label="sMUSD vault" value={SMUSD_VAULT_ADDRESS} />
            <AddressText label="MUSD token" value={MUSD_ADDRESS} />
          </div>

          {seriesListings.length > 0 && (
            <div className="series-directory" aria-label="Available maturity markets">
              {seriesListings.map((series) => (
                <button
                  key={series.exchange}
                  type="button"
                  className={`series-option ${activeSeriesIndex === series.index ? 'series-option-active' : ''}`}
                  aria-pressed={activeSeriesIndex === series.index}
                  onClick={() => setSelectedSeriesIndex(series.index)}
                >
                  <span className="eyebrow">MATURITY {series.index + 1}</span>
                  <strong>{new Date(Number(series.maturity) * 1000).toLocaleDateString()}</strong>
                  <small>PT-MUSD / YT-MUSD</small>
                </button>
              ))}
            </div>
          )}
          {totalSeriesCount > factoryPageSize && (
            <div className="series-pagination" aria-label="Market pages">
              <span>Showing {seriesPageStart + 1}–{Math.min(seriesPageStart + seriesListings.length, totalSeriesCount)} of {totalSeriesCount}</span>
              <div>
                <button type="button" className="secondary-action" onClick={() => setSelectedSeriesIndex(Math.min(totalSeriesCount - 1, seriesPageStart + factoryPageSize))} disabled={seriesPageStart + factoryPageSize >= totalSeriesCount}>Newer</button>
                <button type="button" className="secondary-action" onClick={() => setSelectedSeriesIndex(Math.max(0, seriesPageStart - factoryPageSize))} disabled={seriesPageStart === 0}>Older</button>
              </div>
            </div>
          )}

          {exchangeAddress ? (
            <div className="series-card">
              <div className="section-heading"><div><span className="eyebrow">SHARED MATURITY MARKET</span><h3>PT-MUSD / YT-MUSD</h3></div><span className={`status-pill ${isSettled ? 'status-settled' : 'status-open'}`}>{isSettled ? 'Settled' : isMature ? 'Maturity reached' : 'Open'}</span></div>
              <div className="source-metrics">
                <div><span>Maturity</span><strong>{maturitySeconds ? new Date(Number(maturitySeconds) * 1000).toLocaleString() : 'Loading…'}</strong></div>
                <div><span>Deposited principal</span><strong>{amount(principalDepositedRead.data)} MUSD</strong></div>
                <div><span>Recovered PT claim</span><strong>{isSettled ? `${amount(principalClaimRead.data)} MUSD` : 'Settles at maturity'}</strong></div>
                <div><span>Unclaimed yield reserve</span><strong>{amount(yieldReserveRead.data)} MUSD</strong></div>
              </div>
              <AddressText label="Exchange" value={exchangeAddress} />
              <AddressText label="Market" value={marketAddress} />
              <div className="pool-grid">
                <PoolSummary title="PT / MUSD pool" pool={ptPool.data} />
                <PoolSummary title="YT / MUSD pool" pool={ytPool.data} />
              </div>
              <div className="action-row">
                <button className="primary-action" onClick={() => onNavigate('Mint')}>Mint PT + YT</button>
                <button className="secondary-action" onClick={() => onNavigate('Trade')}>Trade</button>
                {exchangeAddress && !isSettled && <button className="secondary-action" onClick={harvest} disabled={busy || !targetReady || !sourceYieldRead.data || sourceYieldRead.data === BigInt(0)}>Harvest sMUSD yield</button>}
              </div>
            </div>
          ) : (
            <div className="empty-live-card">
              <div className="empty-live-mark">+</div>
              <span className="eyebrow">{factoryAddress ? 'SHARED FACTORY' : 'FACTORY NOT CONFIGURED'}</span>
              <h3>{factoryAddress ? 'No maturity markets yet' : 'Market directory is not connected'}</h3>
              <p>{factoryAddress ? 'Markets created through the shared factory appear here for every trader. Creating a market is a separate permissionless action; trading and minting never deploy contracts.' : 'The protocol operator must deploy and configure one shared factory. Traders use its registered markets; individual users do not deploy contracts to trade.'}</p>
              {factoryAddress && <button className="primary-action" onClick={() => onNavigate('Create')}>Create a maturity market</button>}
            </div>
          )}
          <RiskNote />
        </div>
      )}

      {view === 'Create' && (
        <div className="workspace-content two-column-workspace">
          <div className="form-card">
            <span className="eyebrow">PERMISSIONLESS MARKET FACTORY</span>
            <h3>Create a shared PT/YT maturity</h3>
            <p>Anyone can create a market through the configured factory. It deploys the PT/YT series and market once, records both addresses on-chain, and makes the same market available to every app user. Traders do not deploy contracts when they mint or swap.</p>
            {!factoryAddress ? (
              <div className="protocol-form">
                <p className="field-hint">Deploy the shared factory once with the protocol operator wallet, then copy its address below and set NEXT_PUBLIC_YIELD_SERIES_FACTORY_ADDRESS in project Vars. This makes every visitor use the same factory.</p>
                <button type="button" className="primary-action" onClick={deployFactory} disabled={busy || !targetReady || !sourceVerified}>{busy ? 'Waiting for wallet…' : 'Deploy shared factory once'}</button>
              </div>
            ) : (
              <form onSubmit={createSeries} className="protocol-form">
                <label htmlFor="maturity">Maturity date and time</label>
                <input id="maturity" type="datetime-local" value={maturityInput} onChange={(event) => setMaturityInput(event.target.value)} required />
                <button className="primary-action" disabled={busy || !canCreateSeries || !maturityInput}>{busy ? 'Waiting for wallet…' : 'Create shared market'}</button>
              </form>
            )}
            {factoryAddress && (
              <div className="protocol-form">
                <p className="field-hint">Deploying a new factory does not change existing markets. After confirmation, set its address as NEXT_PUBLIC_YIELD_SERIES_FACTORY_ADDRESS in project Vars and redeploy the app so everyone uses it.</p>
                <button type="button" className="secondary-action" onClick={deployFactory} disabled={busy || !targetReady || !sourceVerified}>{busy ? 'Waiting for wallet…' : 'Deploy updated factory'}</button>
              </div>
            )}
            {!isConnected && <p className="field-hint">Connect a wallet to create a market. The creator pays deployment gas; no private key is requested or stored by the app.</p>}
            {isConnected && !isTargetChain && <p className="field-hint">Switch your wallet network to Mezo Testnet (chain ID 31611).</p>}
            {isConnected && isTargetChain && !sourceVerified && <p className="field-hint">Waiting for the app to verify the live sMUSD vault before enabling creation.</p>}
          </div>
          <div className="info-card">
            <span className="eyebrow">SHARED MARKET LIFECYCLE</span>
            <h3>One market, many traders</h3>
            <div className="token-explainer"><b>1</b><span>A creator submits one maturity to the factory and pays the deployment gas once.</span></div>
            <div className="token-explainer"><b>2</b><span>The factory registers the exchange and market addresses on-chain.</span></div>
            <div className="token-explainer"><b>3</b><span>Everyone selects that same registered market to mint, trade, provide liquidity, and redeem.</span></div>
            {factoryAddress && <AddressText label="Shared factory" value={factoryAddress} />}
          </div>
          <RiskNote />
        </div>
      )}

      {view === 'Mint' && (
        <div className="workspace-content two-column-workspace">
          <div className="form-card">
            <span className="eyebrow">MINT COMPLEMENTARY CLAIMS</span>
            <h3>Deposit MUSD</h3>
            <p>Deposits MUSD into the live sMUSD vault and mints equal PT and YT units for the selected maturity.</p>
            <div className="balance-line"><span>Wallet MUSD</span><strong>{amount(musdBalance.data)} MUSD</strong></div>
            <form onSubmit={mint} className="protocol-form">
              <label htmlFor="mint-amount">Deposit amount</label>
              <div className="amount-input"><input id="mint-amount" inputMode="decimal" value={mintAmount} onChange={(event) => setMintAmount(event.target.value)} placeholder="0.00" /><span>MUSD</span></div>
              <button className="primary-action" disabled={busy || !targetReady || !exchangeAddress}>{busy ? 'Waiting for wallet…' : 'Approve and mint PT + YT'}</button>
            </form>
            {!exchangeAddress && <p className="field-hint">Select a registered maturity market before minting.</p>}
            {exchangeAddress && isMature && <p className="field-hint">This series has reached maturity; new deposits are closed.</p>}
          </div>
          <div className="info-card">
            <span className="eyebrow">WHAT YOU RECEIVE</span>
            <h3>Two transferable tokens</h3>
            <div className="token-explainer"><b>PT</b><span>Claim on initial MUSD principal at maturity. Any source loss reduces PT redemption, capped at the MUSD recovered.</span></div>
            <div className="token-explainer"><b>YT</b><span>Claim only on realized MUSD yield above the initial principal. Source yield is checkpointed before YT transfers.</span></div>
            <AddressText label="MUSD token" value={MUSD_ADDRESS} />
            {exchangeAddress && <AddressText label="Exchange" value={exchangeAddress} />}
          </div>
          <RiskNote />
        </div>
      )}

      {view === 'Portfolio' && (
        <div className="workspace-content">
          <div className="portfolio-grid">
            <BalanceCard label="MUSD" value={amount(musdBalance.data)} suffix="MUSD" />
            <BalanceCard label="Principal token" value={amount(userPtBalance.data)} suffix="PT-MUSD" />
            <BalanceCard label="Yield token" value={amount(userYtBalance.data)} suffix="YT-MUSD" />
            <BalanceCard label="Claimable yield" value={amount(userYtClaimable.data)} suffix="MUSD" />
          </div>
          <div className="series-card">
            <div className="section-heading"><div><span className="eyebrow">YOUR SERIES</span><h3>PT-MUSD / YT-MUSD</h3></div><span className={`status-pill ${isSettled ? 'status-settled' : 'status-open'}`}>{isSettled ? 'Settled' : exchangeAddress ? 'Active' : 'No market selected'}</span></div>
            <p className="muted-copy">{exchangeAddress ? 'Balances and contract state are read from Mezo Testnet. Your address is never sent to an application server.' : 'Select a market listed in the shared factory to see your on-chain balances here.'}</p>
            <AddressText label="Wallet" value={address} />
            <AddressText label="Exchange" value={exchangeAddress} />
            <div className="action-row">
              {exchangeAddress && <button className="secondary-action" onClick={harvest} disabled={busy || !targetReady || !sourceYieldRead.data || sourceYieldRead.data === BigInt(0)}>Harvest realized source yield</button>}
              <button className="secondary-action" onClick={() => onNavigate('Redeem')}>Settlement and claims</button>
            </div>
          </div>
          <RiskNote />
        </div>
      )}

      {view === 'Redeem' && (
        <div className="workspace-content two-column-workspace">
          <div className="form-card">
            <span className="eyebrow">MATURITY SETTLEMENT</span>
            <h3>{!exchangeAddress ? 'No market selected' : isSettled ? 'Claims are available' : isMature ? 'Settle this series' : 'Not yet at maturity'}</h3>
            <p>Anyone can finalize the series after maturity. PT redemption is limited to actual MUSD recovered from the source; YT can claim only its recorded share of realized yield.</p>
            <div className="balance-line"><span>Maturity</span><strong>{maturitySeconds ? new Date(Number(maturitySeconds) * 1000).toLocaleString() : 'No market selected'}</strong></div>
            <div className="balance-line"><span>Recovered principal</span><strong>{isSettled ? `${amount(principalClaimRead.data)} MUSD` : 'Pending settlement'}</strong></div>
            <form onSubmit={(event) => { event.preventDefault(); void settle() }} className="protocol-form">
              <button className="primary-action" disabled={busy || !targetReady || !exchangeAddress || !isMature || isSettled}>{busy ? 'Waiting for wallet…' : isSettled ? 'Series settled' : 'Settle maturity'}</button>
            </form>
          </div>
          <div className="form-card">
            <span className="eyebrow">CLAIM YOUR TOKENS</span>
            <h3>Redeem PT and claim YT</h3>
            <div className="balance-line"><span>Your PT</span><strong>{amount(userPtBalance.data)} PT-MUSD</strong></div>
            <div className="balance-line"><span>Unclaimed principal reserve</span><strong>{amount(unclaimedPrincipalRead.data)} MUSD</strong></div>
            <div className="balance-line"><span>YT reserve</span><strong>{amount(yieldReserveRead.data)} MUSD</strong></div>
            <div className="action-row action-stack">
              <button className="primary-action" onClick={redeem} disabled={busy || !targetReady || !isSettled || !userPtBalance.data || userPtBalance.data === BigInt(0)}>Redeem all PT</button>
              <button className="secondary-action" onClick={claimYield} disabled={busy || !targetReady || !yieldAddress || !userYtClaimable.data || userYtClaimable.data === BigInt(0)}>Claim realized YT yield</button>
            </div>
          </div>
          <RiskNote />
        </div>
      )}

      {view === 'Trade' && (
        <div className="workspace-content trade-grid">
          <div className="form-card">
            <span className="eyebrow">LIVE CONSTANT-PRODUCT MARKET</span>
            <h3>Swap PT or YT</h3>
            <p>Choose a pair, then choose whether to buy the token with MUSD or sell it for MUSD. Each swap pays a 0.30% pool fee.</p>
            <div className="swap-choice-group">
              <span className="eyebrow">1. Choose pair</span>
              <div className="segmented-control" role="group" aria-label="Choose market pair">
                <button type="button" className={tradeToken === 'PT' ? 'segment-active' : ''} onClick={() => selectTradeToken('PT')}>PT / MUSD</button>
                <button type="button" className={tradeToken === 'YT' ? 'segment-active' : ''} onClick={() => selectTradeToken('YT')}>YT / MUSD</button>
              </div>
            </div>
            <div className="swap-choice-group">
              <span className="eyebrow">2. Choose direction</span>
              <div className="segmented-control swap-direction-control" role="group" aria-label="Choose swap direction">
                <button type="button" className={tradeDirection === 'MUSD' ? 'segment-active' : ''} onClick={() => selectTradeDirection('MUSD')}>Buy {tradeToken} with MUSD</button>
                <button type="button" className={tradeDirection === 'TOKEN' ? 'segment-active' : ''} onClick={() => selectTradeDirection('TOKEN')}>Sell {tradeToken} for MUSD</button>
              </div>
            </div>
            <div className="liquidity-balance-grid swap-balance-grid" aria-label="Wallet balances for selected pair">
              <div className="liquidity-balance"><span>Wallet balance</span><strong>{amount(musdBalance.data)} MUSD</strong></div>
              <div className="liquidity-balance"><span>Wallet balance</span><strong>{amount(selectedWalletTokenBalance)} {tradeToken}-MUSD</strong></div>
            </div>
            <div className="liquidity-slider">
              <div className="liquidity-slider-heading"><label htmlFor="swap-percent">Use {tradeInputSymbol} balance</label><strong>{tradePercent}%</strong></div>
              <input id="swap-percent" type="range" min="0" max="100" step="1" value={tradePercent} onChange={(event) => applyTradePercent(Number(event.currentTarget.value))} disabled={!address || tradeInputBalance === BigInt(0)} />
              <div className="liquidity-range-labels"><span>0%</span><span>50%</span><span>100%</span></div>
            </div>
            {!marketAddress && <p className="field-hint" role="status">Select a registered market before swapping. No markets are registered in the current factory yet.</p>}
            <form onSubmit={performTrade} className="protocol-form">
              <div className="liquidity-input-label"><label htmlFor="trade-amount">You pay in {tradeInputSymbol}</label><span>Available: {amount(tradeInputBalanceRead)} {tradeInputSymbol}</span></div>
              <div className="amount-input"><input id="trade-amount" inputMode="decimal" value={tradeAmount} onChange={(event) => { setTradeAmount(event.target.value); setTradePercent(0) }} placeholder="0.00" /><span>{tradeInputSymbol}</span></div>
              <div className="quote-row"><span>You receive (estimated)</span><strong>{amount(marketQuote.data)} {tradeOutputSymbol}</strong></div>
              <div className="quote-row"><span>Maximum slippage</span><strong>1.00%</strong></div>
              <button className="primary-action" disabled={busy || !targetReady || !marketAddress || !marketQuote.data || marketQuote.data === BigInt(0)}>{busy ? 'Waiting for wallet…' : 'Approve and swap'}</button>
            </form>
          </div>
          <div className="form-card liquidity-card">
            <span className="eyebrow">PERMISSIONLESS LIQUIDITY</span>
            <h3>Manage pool liquidity</h3>
            <p>Add MUSD and {tradeToken}-MUSD to the selected pool, or withdraw your existing pool shares.</p>
            <div className="segmented-control" role="group" aria-label="Choose liquidity pool">
              <button type="button" className={tradeToken === 'PT' ? 'segment-active' : ''} onClick={() => selectTradeToken('PT')}>PT pool</button>
              <button type="button" className={tradeToken === 'YT' ? 'segment-active' : ''} onClick={() => selectTradeToken('YT')}>YT pool</button>
            </div>

            <section className="liquidity-section" aria-labelledby="add-liquidity-title">
              <div className="liquidity-section-heading">
                <div>
                  <span className="eyebrow">ADD TO POOL</span>
                  <h4 id="add-liquidity-title">Add liquidity</h4>
                </div>
              </div>
              <div className="liquidity-balance-grid" aria-label="Wallet token balances">
                <div className="liquidity-balance"><span>Wallet balance</span><strong>{amount(musdBalance.data)} MUSD</strong></div>
                <div className="liquidity-balance"><span>Wallet balance</span><strong>{amount(selectedWalletTokenBalance)} {tradeToken}-MUSD</strong></div>
              </div>
              <div className="liquidity-slider">
                <div className="liquidity-slider-heading"><label htmlFor="add-liquidity-percent">Use wallet balances</label><strong>{addLiquidityPercent}%</strong></div>
                <input id="add-liquidity-percent" type="range" min="0" max="100" step="1" value={addLiquidityPercent} onChange={(event) => applyAddLiquidityPercent(Number(event.currentTarget.value))} disabled={!address || walletAssetBalance === BigInt(0) || walletTokenBalance === BigInt(0)} />
                <div className="liquidity-range-labels"><span>0%</span><span>50%</span><span>100%</span></div>
                <p className="field-hint">For an existing pool, the slider keeps your deposit aligned to its current reserve ratio.</p>
              </div>
              <form onSubmit={addLiquidity} className="protocol-form">
                <div className="liquidity-input-label"><label htmlFor="liquidity-musd">MUSD deposit</label><span>Available: {amount(musdBalance.data)} MUSD</span></div>
                <div className="amount-input"><input id="liquidity-musd" inputMode="decimal" value={assetLiquidity} onChange={(event) => { setAssetLiquidity(event.target.value); setAddLiquidityPercent(0) }} placeholder="0.00" /><span>MUSD</span></div>
                <div className="liquidity-input-label"><label htmlFor="liquidity-token">{tradeToken}-MUSD deposit</label><span>Available: {amount(selectedWalletTokenBalance)} {tradeToken}-MUSD</span></div>
                <div className="amount-input"><input id="liquidity-token" inputMode="decimal" value={tokenLiquidity} onChange={(event) => { setTokenLiquidity(event.target.value); setAddLiquidityPercent(0) }} placeholder="0.00" /><span>{tradeToken}-MUSD</span></div>
                <button className="primary-action" disabled={busy || !targetReady || !marketAddress || !tokenAddress}>Approve and add liquidity</button>
              </form>
            </section>

            <section className="liquidity-section" aria-labelledby="liquidity-yield-title">
              <div className="liquidity-section-heading">
                <div>
                  <span className="eyebrow">PROTOCOL YIELD</span>
                  <h4 id="liquidity-yield-title">{tradeToken === 'YT' ? 'YT pool LP yield' : 'PT pool rewards'}</h4>
                </div>
                {tradeToken === 'YT' && (
                  <strong className="position-balance">
                    {ytLiquidityYieldClaimable.isError
                      ? 'Unavailable'
                      : `${amount(ytLiquidityYieldClaimable.data)} MUSD`}
                  </strong>
                )}
              </div>
              {tradeToken === 'YT' ? (
                <>
                  <p className="field-hint">
                    Yield earned by YT held in this pool is allocated to LP shares. Claiming harvests available yield and pays your accrued share in MUSD.
                    {ytLiquidityYieldClaimable.isError && ' This market may need the updated contract deployment.'}
                  </p>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={claimLiquidityYield}
                    disabled={busy || !targetReady || !marketAddress || !yieldAddress || ytLiquidityYieldClaimable.isError || typeof ytLiquidityYieldClaimable.data !== 'bigint' || ytLiquidityYieldClaimable.data === BigInt(0)}
                  >
                    Claim YT-pool yield
                  </button>
                </>
              ) : (
                <p className="field-hint">
                  PT liquidity earns swap fees only. Protocol yield is distributed through YT balances, not PT pool shares.
                </p>
              )}
            </section>

            <section className="liquidity-section remove-liquidity-section" aria-labelledby="remove-liquidity-title">
              <div className="liquidity-section-heading">
                <div>
                  <span className="eyebrow">WITHDRAW FROM POOL</span>
                  <h4 id="remove-liquidity-title">Remove liquidity</h4>
                </div>
                <strong className="position-balance">{amount(tokenLiquidityBalance.data)} shares</strong>
              </div>
              <div className="liquidity-slider">
                <div className="liquidity-slider-heading"><label htmlFor="remove-liquidity-percent">Withdraw position</label><strong>{removeLiquidityPercent}%</strong></div>
                <input id="remove-liquidity-percent" type="range" min="0" max="100" step="1" value={removeLiquidityPercent} onChange={(event) => applyRemoveLiquidityPercent(Number(event.currentTarget.value))} disabled={!address || walletLiquidityShares === BigInt(0)} />
                <div className="liquidity-range-labels"><span>0%</span><span>50%</span><span>100%</span></div>
              </div>
              <form onSubmit={removeLiquidity} className="protocol-form remove-liquidity-form">
                <div className="liquidity-input-label"><label htmlFor="remove-shares">Pool shares to withdraw</label><span>Available: {amount(tokenLiquidityBalance.data)}</span></div>
                <div className="amount-input"><input id="remove-shares" inputMode="decimal" value={removeLiquidityAmount} onChange={(event) => { setRemoveLiquidityAmount(event.target.value); setRemoveLiquidityPercent(0) }} placeholder="0.00" /><span>Shares</span></div>
                <button className="secondary-action" disabled={busy || !targetReady || !marketAddress || walletLiquidityShares === BigInt(0)}>Remove liquidity</button>
              </form>
            </section>
          </div>
          <RiskNote />
        </div>
      )}

    </section>
  )
}

function PoolSummary({ title, pool }: { title: string; pool: unknown }) {
  const values = Array.isArray(pool) ? pool : []
  const reserveAsset = typeof values[0] === 'bigint' ? values[0] : BigInt(0)
  return (
    <div className="pool-summary">
      <span>{title}</span>
      <strong>{amount(reserveAsset)} MUSD</strong>
      <small>{reserveAsset > BigInt(0) ? 'Live on-chain reserve' : 'No liquidity yet'}</small>
    </div>
  )
}

function BalanceCard({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return <div className="balance-card"><span>{label}</span><strong>{value}</strong><small>{suffix}</small></div>
}

function RiskNote() {
  return (
    <div className="risk-note" role="note">
      <strong>Testnet only · unaudited</strong>
      <span>These contracts are experimental and have not been independently audited. The source sMUSD vault is an upgradeable Mezo contract. Use testnet assets only; this interface does not represent a production launch.</span>
    </div>
  )
}
