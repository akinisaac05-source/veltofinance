'use client'

import { useEffect, useState } from 'react'
import {
  ArrowDownUp,
  ArrowUpRight,
  BarChart3,
  CircleHelp,
  Coins,
  ExternalLink,
  LayoutDashboard,
  Menu,
  Rocket,
  Wallet,
  X,
} from 'lucide-react'
import { NetworkStatus, WalletButton } from './wallet-provider'
import { ProtocolWorkspace, type WorkspaceView } from './protocol-workspace'

const navigation: { label: string; view: WorkspaceView; icon: typeof BarChart3 }[] = [
  { label: 'Markets', view: 'Markets', icon: BarChart3 },
  { label: 'Trade', view: 'Trade', icon: ArrowDownUp },
  { label: 'Mint', view: 'Mint', icon: Coins },
  { label: 'Portfolio', view: 'Portfolio', icon: LayoutDashboard },
  { label: 'Redeem', view: 'Redeem', icon: Wallet },
  { label: 'Create market', view: 'Create', icon: Rocket },
]

export function ExchangeShell() {
  const [activeView, setActiveView] = useState<WorkspaceView>('Markets')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 620px)')
    const updateViewport = () => {
      setIsMobile(mediaQuery.matches)
      if (!mediaQuery.matches) setMobileOpen(false)
    }
    updateViewport()
    mediaQuery.addEventListener('change', updateViewport)
    return () => mediaQuery.removeEventListener('change', updateViewport)
  }, [])

  const navigate = (view: WorkspaceView) => {
    setActiveView(view)
    setMobileOpen(false)
  }

  return (
    <div className="app-frame">
      <aside
        className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}
        aria-hidden={isMobile && !mobileOpen ? true : undefined}
        inert={isMobile && !mobileOpen}
      >
        <a className="brand" href="#markets" aria-label="MUSD Yield Exchange home">
          <span className="brand-mark" aria-hidden="true">m</span>
          <span>MUSD<span className="brand-light">.finance</span></span>
        </a>
        <button type="button" className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
          <X aria-hidden="true" /><span>Close menu</span>
        </button>
        <div className="nav-caption">PROTOCOL</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ label, view, icon: Icon }) => (
            <button
              key={view}
              className={`nav-item ${activeView === view ? 'nav-active' : ''}`}
              aria-current={activeView === view ? 'page' : undefined}
              onClick={() => navigate(view)}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
              {activeView === view && <span className="nav-dot" aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon"><CircleHelp size={16} aria-hidden="true" /></span>
            <span><strong>Real testnet contracts</strong><small>Yield claims are on-chain</small></span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </div>
          <div className="sidebar-foot">A yield layer for Mezo<br /><span>Testnet only · Unaudited</span></div>
        </div>
      </aside>
      {mobileOpen && <div className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-expanded={mobileOpen} aria-label={mobileOpen ? 'Close menu' : 'Open menu'}>
            {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
          <div className="breadcrumbs"><span>Protocol</span><span className="crumb-slash">/</span><strong>{activeView}</strong></div>
          <div className="top-actions">
            <a className="docs-link" href="https://docs.mezo.org" target="_blank" rel="noreferrer">Mezo docs <ExternalLink size={13} aria-hidden="true" /></a>
            <NetworkStatus />
            <WalletButton />
          </div>
        </header>
        <section className="page-content" aria-label={`${activeView} workspace`}>
          <div className="eyebrow"><span className="live-indicator" />MEZO TESTNET <span className="eyebrow-divider">/</span> MUSD YIELD EXCHANGE</div>
          <div className="heading-row">
            <div><h1>{activeView === 'Create' ? 'Create Market' : activeView}</h1><p className="page-subtitle">Shared PT/YT maturity markets on Mezo Testnet.</p></div>
            <div className="maturity-chip"><span className="chip-glyph" aria-hidden="true">◷</span><span><small>NETWORK</small><strong>Chain 31611</strong></span></div>
          </div>
          <ProtocolWorkspace view={activeView} onNavigate={navigate} />
          <footer className="content-footer"><span>Mezo Testnet <span className="footer-sep">·</span> Experimental, unaudited contracts</span><a href="https://mezo.org" target="_blank" rel="noreferrer">Mezo network <ExternalLink size={12} aria-hidden="true" /></a></footer>
        </section>
      </main>
    </div>
  )
}
