import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Velto Finance — Yield Markets on Mezo',
  description: 'Velto Finance lets you explore MUSD savings and veMEZO lock-yield markets, compare maturities, trade principal and yield tokens, and manage positions on Mezo Testnet.',
  generator: 'v0.app',
  icons: {
    icon: 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/velto_finance_v_favicon-2bBcmm4VM62GAh221nP7bQLjpeBPLo.png',
    apple: 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/velto_finance_v_favicon-2bBcmm4VM62GAh221nP7bQLjpeBPLo.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f5f4f1',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
