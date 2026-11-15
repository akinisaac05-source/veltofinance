'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useChainId, usePublicClient, useReadContract, useReadContracts, useWalletClient } from 'wagmi'
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
import { MEZO_DEVELOPER_ADDRESS, MEZO_TESTNET_CHAIN_ID, MUSD_ADDRESS, SMUSD_VAULT_ADDRESS, YIELD_SERIES_FACTORY_ADDRESS, mezoTestnet } from '@/lib/mezo'

export type WorkspaceView = 'Markets' | 'Trade' | 'Liquidity' | 'Mint' | 'Portfolio' | 'Redeem' | 'Create' | 'Developer'

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
  if (value !== BigInt(0) && value < BigInt(100_000_000_000_000)) return '<0.0001'
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

function getPoolOverview(pool: unknown) {
  const parts = Array.isArray(pool) ? pool : []
  const reserveAsset = typeof parts[0] === 'bigint' ? parts[0] : BigInt(0)
  const reserveToken = typeof parts[1] === 'bigint' ? parts[1] : BigInt(0)
  if (reserveAsset === BigInt(0) || reserveToken === BigInt(0)) {
    return { hasReserves: false, hasPracticalDepth: false, liquidity: 'No liquidity', spot: '—', impact: '—' }
  }

  const oneMusd = BigInt(10) ** BigInt(18)
  const amountOut = (oneMusd * BigInt(9_970) * reserveToken) / (reserveAsset * BigInt(10_000) + oneMusd * BigInt(9_970))
  const midPriceOut = (oneMusd * reserveToken) / reserveAsset
  const impactBps = midPriceOut > amountOut ? ((midPriceOut - amountOut) * BigInt(10_000)) / midPriceOut : BigInt(0)
  const spotPrice = Number(formatUnits(reserveAsset, 18)) / Number(formatUnits(reserveToken, 18))

  return {
    hasReserves: true,
    hasPracticalDepth: impactBps < BigInt(5_000),
    liquidity: `${amount(reserveAsset)} MUSD + ${amount(reserveToken)} tokens`,
    spot: Number.isFinite(spotPrice) ? `${spotPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })} MUSD per token` : '—',
    impact: `${(Number(impactBps) / 100).toFixed(2)}% on a 1 MUSD buy`,
  }
}

function formatSharePercent(shares: unknown, totalShares: unknown) {
  if (typeof shares !== 'bigint' || typeof totalShares !== 'bigint' || totalShares === BigInt(0)) return '—'
  const basisPoints = (shares * BigInt(1_000_000)) / totalShares
  return `${(Number(basisPoints) / 10_000).toFixed(2)}%`
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
  const isDeveloper = address?.toLowerCase() === MEZO_DEVELOPER_ADDRESS.toLowerCase()
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
  const portfolioTokenReads = useReadContracts({
    contracts: seriesListings.flatMap(({ exchange }) => [
      { address: exchange, abi: exchangeAbi, functionName: 'principalToken' as const },
      { address: exchange, abi: exchangeAbi, functionName: 'yieldToken' as const },
      { address: exchange, abi: exchangeAbi, functionName: 'maturity' as const },
    ]),
    query: { enabled: Boolean(address && seriesListings.length > 0) },
  })
  const portfolioBalanceReads = useReadContracts({
    contracts: seriesListings.flatMap((_, index) => {
      const principalToken = asAddress(portfolioTokenReads.data?.[index * 3]?.result) ?? zeroAddress
      const yieldToken = asAddress(portfolioTokenReads.data?.[index * 3 + 1]?.result) ?? zeroAddress
      return [
        { address: principalToken, abi: erc20Abi, functionName: 'balanceOf' as const, args: [accountRef] as const },
        { address: yieldToken, abi: erc20Abi, functionName: 'balanceOf' as const, args: [accountRef] as const },
      ]
    }),
    query: { enabled: Boolean(address && seriesListings.length > 0 && portfolioTokenReads.data) },
  })
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
  const ptOverview = getPoolOverview(ptPool.data)
  const ytOverview = getPoolOverview(ytPool.data)
  const selectedPoolOverview = getPoolOverview(selectedPool)
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
  const portfolioPtTotal = (portfolioBalanceReads.data ?? []).reduce((sum, result, index) => index % 2 === 0 && result.status === 'success' && typeof result.result === 'bigint' ? sum + result.result : sum, BigInt(0))
  const portfolioYtTotal = (portfolioBalanceReads.data ?? []).reduce((sum, result, index) => index % 2 === 1 && result.status === 'success' && typeof result.result === 'bigint' ? sum + result.result : sum, BigInt(0))

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
      if (!isDeveloper) throw new Error('Only the configured developer wallet can deploy protocol contracts.')
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

  const updateLiquidityAsset = (value: string) => {
    setAssetLiquidity(value)
    setAddLiquidityPercent(0)
    try {
      const assetAmount = parseUnits(value, 18)
      setTokenLiquidity(reserveAsset > BigInt(0) && reserveToken > BigInt(0) ? inputAmount((assetAmount * reserveToken) / reserveAsset) : '')
    } catch {
      setTokenLiquidity('')
    }
  }

  const updateLiquidityToken = (value: string) => {
    setTokenLiquidity(value)
    setAddLiquidityPercent(0)
    try {
      const tokenAmount = parseUnits(value, 18)
      setAssetLiquidity(reserveAsset > BigInt(0) && reserveToken > BigInt(0) ? inputAmount((tokenAmount * reserveAsset) / reserveToken) : '')
    } catch {
      setAssetLiquidity('')
    }
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
      {status && <p className="transaction-status" role="status">{status}</p>}

      {view === 'Markets' && (
        <div className="workspace-content">
          <div className="market-overview">
            <div><span className="eyebrow">MUSD SAVINGS YIELD · MEZO TESTNET</span><strong>{totalSeriesCount}{' '}{totalSeriesCount === 1 ? 'market' : 'markets'}</strong></div>
            <button type="button" className="primary-action" onClick={() => onNavigate('Create')} disabled={!factoryAddress}>Create market</button>
          </div>
          {!isConnected ? (
            <p className="field-warning" role="status">To get started, connect an injected EVM wallet from the top right and switch it to Mezo Testnet. Use testnet assets only; transactions may require wallet approval and network fees.</p>
          ) : !isTargetChain ? (
            <p className="field-warning" role="status">Your wallet is connected to another network. Switch to Mezo Testnet from the network control before trading.</p>
          ) : null}
          <div className="demo-flow" aria-label="Suggested demo flow">
            <span className="eyebrow">SUGGESTED DEMO FLOW</span>
            <p><strong>Choose a maturity</strong><span aria-hidden="true">→</span><strong>Mint PT + YT</strong><span aria-hidden="true">→</span><strong>Trade when reserves support a quote</strong><span aria-hidden="true">→</span><strong>Review your portfolio</strong></p>
          </div>

          {seriesListings.length > 1 && (
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
              <div className="section-heading"><div><span className="eyebrow">MUSD MARKET</span><h3>PT-MUSD / YT-MUSD</h3></div><span className={`status-pill ${isSettled ? 'status-settled' : 'status-open'}`}>{isSettled ? 'Settled' : isMature ? 'Maturity reached' : 'Open'}</span></div>
              <div className="market-stats">
                <div><span>Maturity</span><strong>{maturitySeconds ? new Date(Number(maturitySeconds) * 1000).toLocaleDateString() : 'Loading…'}</strong></div>
                <div className="market-pair-metric"><span>PT / MUSD pool</span><strong>{ptOverview.liquidity}</strong><small>{ptOverview.hasPracticalDepth ? 'Reserves available' : ptOverview.hasReserves ? 'Very shallow for a 1 MUSD trade' : 'No executable quote'}</small><small>Spot: {ptOverview.spot}</small><small>{ptOverview.hasReserves ? ptOverview.impact : 'Add liquidity to enable swaps.'}</small></div>
                <div className="market-pair-metric"><span>YT / MUSD pool</span><strong>{ytOverview.liquidity}</strong><small>{ytOverview.hasPracticalDepth ? 'Reserves available' : ytOverview.hasReserves ? 'Very shallow for a 1 MUSD trade' : 'No executable quote'}</small><small>Spot: {ytOverview.spot}</small><small>{ytOverview.hasReserves ? ytOverview.impact : 'Add liquidity to enable swaps.'}</small></div>
                <div className="market-pair-metric"><span>Implied fixed yield</span><strong>Not shown</strong><small>No trusted MUSD peg/oracle; testnet pool prices are not a yield oracle.</small></div>
              </div>
              <p className="testnet-notice"><strong>Mezo Testnet data.</strong> Spot quotes and 1 MUSD trade-impact estimates are derived from current pool reserves; impact includes the 0.30% swap fee. Pools are labelled very shallow when the estimated impact reaches 50%. Quotes are not executable guarantees.</p>
              <div className="action-row">
                <button className="primary-action" onClick={() => onNavigate('Trade')}>Trade</button>
                <button className="secondary-action" onClick={() => onNavigate('Mint')}>Mint PT + YT</button>
                <button className="secondary-action" onClick={() => onNavigate('Liquidity')}>Manage liquidity</button>
              </div>
            </div>
          ) : (
            <div className="empty-live-card">
              <div className="empty-live-mark">+</div>
              <span className="eyebrow">MUSD YIELD</span>
              <h3>{factoryAddress ? 'No maturity markets yet' : 'Markets unavailable'}</h3>
              <p>{factoryAddress ? 'Create a maturity market to enable PT-MUSD and YT-MUSD trading.' : 'Markets are being prepared. Please check back soon.'}</p>
              {factoryAddress && <button className="primary-action" onClick={() => onNavigate('Create')}>Create a maturity market</button>}
            </div>
          )}
        </div>
      )}

      {view === 'Create' && (
        <div className="workspace-content two-column-workspace">
          <div className="form-card">
            <span className="eyebrow">CREATE MARKET</span>
            <h3>Choose a maturity</h3>
            <p>Set a future expiry to create a shared PT/YT market for everyone to use.</p>
            {!factoryAddress ? (
              <p className="field-hint">Market creation is temporarily unavailable while the protocol factory is being configured.</p>
            ) : (
              <form onSubmit={createSeries} className="protocol-form">
                <label htmlFor="maturity">Maturity date and time</label>
                <input id="maturity" type="datetime-local" value={maturityInput} onChange={(event) => setMaturityInput(event.target.value)} required />
                <button className="primary-action" disabled={busy || !canCreateSeries || !maturityInput}>{busy ? 'Waiting for wallet…' : 'Create shared market'}</button>
              </form>
            )}
            {!isConnected && <p className="field-hint">Connect your wallet to create a market. Review the transaction fee before confirming.</p>}
            {isConnected && !isTargetChain && <p className="field-hint">Switch your wallet to Mezo Testnet.</p>}
            {isConnected && isTargetChain && !sourceVerified && <p className="field-hint">Market creation is temporarily paused while the source is checked.</p>}

          </div>
          <div className="info-card">
            <span className="eyebrow">SHARED MARKET LIFECYCLE</span>
            <h3>One market, many traders</h3>
            <div className="token-explainer"><b>1</b><span>Choose an expiry and create the market once.</span></div>
            <div className="token-explainer"><b>2</b><span>Mint PT and YT against the same maturity.</span></div>
            <div className="token-explainer"><b>3</b><span>Trade, add liquidity, and manage claims from their own pages.</span></div>
          </div>
        </div>
      )}

      {view === 'Mint' && (
        <div className="workspace-content two-column-workspace">
          <div className="form-card">
            <span className="eyebrow">MINT COMPLEMENTARY CLAIMS</span>
            <h3>Deposit MUSD</h3>
            <p>Deposits MUSD into the live sMUSD vault and mints equal PT and YT units for the selected maturity. This is an experimental testnet flow, not a guaranteed yield product.</p>
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
        </div>
      )}

      {view === 'Portfolio' && (
        <div className="workspace-content">
          <div className="portfolio-grid">
            <BalanceCard label="MUSD" value={amount(musdBalance.data)} suffix="Wallet balance" />
            <BalanceCard label="PT-MUSD" value={amount(portfolioPtTotal)} suffix="Across listed maturities" />
            <BalanceCard label="YT-MUSD" value={amount(portfolioYtTotal)} suffix="Across listed maturities" />
          </div>
          <div className="section-heading portfolio-heading"><div><span className="eyebrow">YOUR POSITIONS</span><h3>All MUSD maturities</h3></div><span className="count-pill">{totalSeriesCount}</span></div>
          {portfolioPtTotal > BigInt(0) || portfolioYtTotal > BigInt(0) ? <div className="portfolio-position-list">
            {seriesListings.map((series, index) => {
              const pt = portfolioBalanceReads.data?.[index * 2]
              const yt = portfolioBalanceReads.data?.[index * 2 + 1]
              const ptAmount = pt?.status === 'success' && typeof pt.result === 'bigint' ? pt.result : BigInt(0)
              const ytAmount = yt?.status === 'success' && typeof yt.result === 'bigint' ? yt.result : BigInt(0)
              if (ptAmount === BigInt(0) && ytAmount === BigInt(0)) return null
              return <button type="button" key={series.exchange} className="portfolio-position" onClick={() => setSelectedSeriesIndex(series.index)}>
                <span><strong>PT-MUSD / YT-MUSD</strong><small>Maturity {new Date(Number(series.maturity) * 1000).toLocaleDateString()}</small></span>
                <span><strong>{amount(ptAmount)} PT</strong><small>{amount(ytAmount)} YT</small></span>
              </button>
            })}
          </div> : <p className="field-hint">{isConnected ? 'No PT/YT positions found across these markets yet.' : 'Connect your wallet to see positions across all registered maturities.'}</p>}
          {totalSeriesCount > factoryPageSize && <div className="series-pagination"><span>Showing {seriesPageStart + 1}–{Math.min(seriesPageStart + seriesListings.length, totalSeriesCount)} of {totalSeriesCount}</span><div><button type="button" className="secondary-action" onClick={() => setSelectedSeriesIndex(Math.min(totalSeriesCount - 1, seriesPageStart + factoryPageSize))} disabled={seriesPageStart + factoryPageSize >= totalSeriesCount}>Newer</button><button type="button" className="secondary-action" onClick={() => setSelectedSeriesIndex(Math.max(0, seriesPageStart - factoryPageSize))} disabled={seriesPageStart === 0}>Older</button></div></div>}
          {exchangeAddress && isConnected && <div className="action-row"><button className="secondary-action" onClick={harvest} disabled={busy || !targetReady || !sourceYieldRead.data || sourceYieldRead.data === BigInt(0)}>Harvest realized yield</button><button className="secondary-action" onClick={() => onNavigate('Redeem')}>Settlement and claims</button></div>}
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
        </div>
      )}

      {(view === 'Trade' || view === 'Liquidity') && (
        <div className="workspace-content trade-grid">
          {view === 'Trade' && <div className="form-card">
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
              {parsedTradeAmount > BigInt(0) && marketQuote.isLoading && <p className="field-hint" role="status">Fetching a live quote from the selected pool…</p>}
              {parsedTradeAmount > BigInt(0) && marketQuote.isError && <p className="field-warning" role="alert">The live quote could not be loaded. Check the selected maturity and try again.</p>}
              {parsedTradeAmount > BigInt(0) && marketQuote.data === BigInt(0) && <div className="quote-unavailable" role="status"><p className="field-warning">No executable quote for this amount and direction. The selected pool may have no reserves or insufficient depth.</p><button type="button" className="secondary-action" onClick={() => onNavigate('Liquidity')}>View pool liquidity</button></div>}
              {parsedTradeAmount > BigInt(0) && typeof marketQuote.data === 'bigint' && marketQuote.data > BigInt(0) && selectedPoolOverview.hasReserves && !selectedPoolOverview.hasPracticalDepth && <p className="field-warning" role="status">This pool is very shallow: a 1 MUSD buy is estimated to have at least 50% price impact. The current quote is not a recommendation to trade.</p>}
              <p className="field-warning trade-risk-note">Experimental Mezo Testnet contracts only. Quotes can change before confirmation; review the wallet transaction and slippage before approving. Never use mainnet funds.</p>
              <button className="primary-action" disabled={busy || !targetReady || !marketAddress || !marketQuote.data || marketQuote.data === BigInt(0)}>{busy ? 'Confirm in wallet…' : 'Approve and swap'}</button>
            </form>
          </div>}
          {view === 'Liquidity' && <div className="form-card liquidity-card">
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
                <div className="amount-input"><input id="liquidity-musd" inputMode="decimal" value={assetLiquidity} onChange={(event) => updateLiquidityAsset(event.target.value)} placeholder="0.00" /><span>MUSD</span></div>
                <div className="liquidity-input-label"><label htmlFor="liquidity-token">{tradeToken}-MUSD deposit</label><span>Available: {amount(selectedWalletTokenBalance)} {tradeToken}-MUSD</span></div>
                <div className="amount-input"><input id="liquidity-token" inputMode="decimal" value={tokenLiquidity} onChange={(event) => updateLiquidityToken(event.target.value)} placeholder="0.00" /><span>{tradeToken}-MUSD</span></div>
                <p className="field-hint">The paired amount follows the selected pool&apos;s live reserve ratio. For an empty pool, enter both amounts manually.</p>
                <button className="primary-action" disabled={busy || !targetReady || !marketAddress || !tokenAddress}>Approve and add liquidity</button>
              </form>
            </section>

            <section className="liquidity-section" aria-labelledby="liquidity-yield-title">
              <div className="liquidity-section-heading">
                <div>
                  <span className="eyebrow">LP ECONOMICS</span>
                  <h4 id="liquidity-yield-title">Earnings and incentives</h4>
                </div>
              </div>
              <div className="lp-economics-list">
                <div className="balance-line"><span>LP share of {tradeToken} pool</span><strong>{formatSharePercent(tokenLiquidityBalance.data, liquiditySupply)}</strong></div>
                <div className="balance-line"><span>Realized swap fees</span><strong>Not tracked per LP</strong></div>
                <div className="balance-line"><span>Realized YT-pool yield</span><strong>{tradeToken === 'YT' ? ytLiquidityYieldClaimable.isError ? 'Unavailable' : `${amount(ytLiquidityYieldClaimable.data)} MUSD claimable` : 'Not applicable to PT pool'}</strong></div>
                <div className="balance-line"><span>Incentives</span><strong>None configured</strong></div>
              </div>
              {tradeToken === 'YT' ? (
                <>
                  <p className="field-hint">
                    YT held in this pool can realize source-vault yield; the amount above is your currently claimable share, not a projection.
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
                  PT-pool shares receive no source-vault yield: PT liquidity earns from swaps only. Swap fees are retained in pool reserves and this contract does not separately account realized fees by LP, so no fee-earnings amount or APR is shown.
                </p>
              )}
              <p className="field-warning lp-risk-note">Pool and asset risk: reserve prices can move and liquidity withdrawals may return a different token mix than deposited. YT-pool yield depends on realized sMUSD vault yield; source-vault, smart-contract, market, and testnet risks remain. These unaudited testnet contracts are not for mainnet funds.</p>
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
          </div>}
        </div>
      )}

      {view === 'Developer' && (
        <div className="workspace-content two-column-workspace">
          <div className="form-card">
            <span className="eyebrow">PROTOCOL ADMIN</span>
            <h3>Shared MUSD factory</h3>
            <p>Deployment controls are restricted in the interface to the configured developer wallet.</p>
            <div className="balance-line"><span>Factory</span><strong>{factoryAddress ?? 'Not configured'}</strong></div>
            <div className="balance-line"><span>Vault verification</span><strong>{sourceVerified ? 'Verified' : 'Not verified'}</strong></div>
            {isDeveloper && <button type="button" className="primary-action" onClick={deployFactory} disabled={busy || !targetReady || !sourceVerified}>{busy ? 'Waiting for wallet…' : factoryAddress ? 'Deploy replacement factory' : 'Deploy shared factory'}</button>}
            {!isDeveloper && <p className="field-hint">Connect the configured developer wallet to access deployment tools.</p>}
          </div>
          <div className="info-card">
            <span className="eyebrow">CONFIGURATION</span><h3>Protocol addresses</h3>
            <AddressText label="MUSD" value={MUSD_ADDRESS} />
            <AddressText label="sMUSD vault" value={SMUSD_VAULT_ADDRESS} />
            {factoryAddress && <AddressText label="Yield factory" value={factoryAddress} />}
            <p className="field-hint">After deploying a replacement, update NEXT_PUBLIC_YIELD_SERIES_FACTORY_ADDRESS in the project environment before directing users to the new factory.</p>
          </div>
        </div>
      )}

    </section>
  )
}

function BalanceCard({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return <div className="balance-card"><span>{label}</span><strong>{value}</strong><small>{suffix}</small></div>
}
