import { ExchangeShell } from '@/components/musd/exchange-shell'
import { WalletProvider } from '@/components/musd/wallet-provider'

export default function ExchangePage() {
  return <WalletProvider><ExchangeShell /></WalletProvider>
}
