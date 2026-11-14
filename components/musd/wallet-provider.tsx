'use client'

import { useState, type ReactNode } from 'react'
import { createConfig, http, WagmiProvider, useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mezoTestnet } from '@/lib/mezo'

const config = createConfig({
  chains: [mezoTestnet],
  connectors: [injected()],
  transports: { [mezoTestnet.id]: http() },
  ssr: true,
})

export function WalletProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return <WagmiProvider config={config}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></WagmiProvider>
}

export function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  if (isConnected && address) return <button className="wallet-button connected" onClick={() => disconnect()} aria-label="Disconnect wallet">{address.slice(0, 6)}…{address.slice(-4)}</button>
  return <button className="wallet-button" onClick={() => connect({ connector: connectors[0] })} disabled={isPending}>{isPending ? 'Connecting…' : 'Connect wallet'}</button>
}

export function NetworkStatus() {
  const chainId = useChainId()
  const { isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const connectedToTarget = isConnected && chainId === mezoTestnet.id
  const needsSwitch = isConnected && chainId !== mezoTestnet.id

  return (
    <button
      type="button"
      className={`network-pill ${needsSwitch ? 'network-pill-warn' : ''}`}
      onClick={() => needsSwitch && switchChain({ chainId: mezoTestnet.id })}
      aria-label={needsSwitch ? 'Switch wallet to Mezo Testnet' : 'Target network Mezo Testnet'}
      disabled={!isConnected || isPending}
    >
      <span className="network-indicator" />
      {isPending ? 'Switching…' : connectedToTarget || !isConnected ? 'Mezo Testnet' : 'Switch network'}
    </button>
  )
}
