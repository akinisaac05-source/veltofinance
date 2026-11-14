import { ExchangeShell } from '@/components/musd/exchange-shell'
import { WalletProvider } from '@/components/musd/wallet-provider'

export default function Page() {
  return <WalletProvider><ExchangeShell /></WalletProvider>
}
