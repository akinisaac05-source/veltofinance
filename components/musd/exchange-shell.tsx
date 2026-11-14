'use client'

import { useState } from 'react'
import { ArrowDownUp, ArrowUpRight, BarChart3, ChevronDown, CircleHelp, Coins, ExternalLink, LayoutDashboard, Menu, Wallet, X } from 'lucide-react'
import { WalletButton } from './wallet-provider'

const navigation = [
  { label: 'Markets', icon: BarChart3 },
  { label: 'Trade', icon: ArrowDownUp },
  { label: 'Mint', icon: Coins },
  { label: 'Portfolio', icon: LayoutDashboard },
  { label: 'Redeem', icon: Wallet },
]

export function ExchangeShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  return <div className="app-frame">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#markets" aria-label="MUSD home"><span className="brand-mark">m</span><span>MUSD<span className="brand-light">.finance</span></span></a>
      <div className="nav-caption">PROTOCOL</div>
      <nav aria-label="Main navigation">
        {navigation.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${label === 'Markets' ? 'nav-active' : ''}`} disabled={label !== 'Markets'} aria-current={label === 'Markets' ? 'page' : undefined} onClick={() => setMobileOpen(false)}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{label === 'Markets' ? <span className="nav-dot" /> : <span className="nav-soon">Soon</span>}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="note-icon"><CircleHelp size={16} /></span><span><strong>New to yield tokens?</strong><small>Explore how the protocol works</small></span><ArrowUpRight size={14} /></div><div className="sidebar-foot">A yield layer for Mezo<br /><span>Independent protocol · Testnet</span></div></div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
    <main className="main-area">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? 'Close menu' : 'Open menu'}>{mobileOpen ? <X /> : <Menu />}</button><div className="breadcrumbs"><span>Protocol</span><span className="crumb-slash">/</span><strong>Markets</strong></div><div className="top-actions"><a className="docs-link" href="https://docs.mezo.org" target="_blank" rel="noreferrer">Docs <ExternalLink size={13} /></a><div className="network-pill"><span className="network-indicator" />Mezo Testnet<ChevronDown size={13} /></div><WalletButton /></div></header>
      <section className="page-content" aria-label="Markets overview">
        <div className="eyebrow"><span className="live-indicator" />MEZO ECOSYSTEM <span className="eyebrow-divider">/</span> YIELD MARKETS</div>
        <div className="heading-row"><div><h1>Markets</h1><p className="page-subtitle">Discover and manage tokenized yield on Mezo.</p></div><div className="maturity-chip"><span className="chip-glyph">◷</span><span><small>MARKET STATUS</small><strong>Testnet preview</strong></span></div></div>
        <div className="market-toolbar"><div className="toolbar-title">Available markets <span className="count-pill">0</span></div><div className="toolbar-controls"><button className="filter-button" disabled>All assets <ChevronDown size={14} /></button><span className="toolbar-divider" /><span className="sort-label">Sorted by</span><button className="filter-button" disabled>Liquidity <ChevronDown size={14} /></button></div></div>
        <div className="empty-market"><div className="empty-graphic"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="empty-token">m</div><span className="spark spark-one" /><span className="spark spark-two" /><span className="spark spark-three" /></div><span className="empty-kicker">MARKETS ARE BEING PREPARED</span><h2>No active markets yet</h2><p>Yield markets will appear here once the protocol is deployed and connected to a verified yield source.</p><div className="empty-separator"><span /><i>FIRST MARKET</i><span /></div><div className="planned-market"><span className="asset-pair"><span className="pair-icon">m</span><span className="pair-icon pair-icon-back">s</span></span><span className="planned-name"><strong>PT-sMUSD / YT-sMUSD</strong><small>Mezo Savings · Single maturity</small></span><span className="planned-status"><span />Planned</span></div><div className="disclaimer"><CircleHelp size={14} /><span>No APY or market figures are shown because live yield data has not been verified.</span></div></div>
        <footer className="content-footer"><span>Built for Mezo <span className="footer-sep">·</span> Testnet only</span><a href="https://mezo.org" target="_blank" rel="noreferrer">Mezo network <ExternalLink size={12} /></a></footer>
      </section>
    </main>
  </div>
}
