'use client'

import { useEffect, useState } from 'react'
import { ArrowDownUp, BarChart3, Code2, Droplets, LayoutDashboard, Menu, X } from 'lucide-react'
import { useAccount } from 'wagmi'
import { MEZO_DEVELOPER_ADDRESS } from '@/lib/mezo'
import { NetworkStatus, WalletButton } from './wallet-provider'
import { ProtocolWorkspace, type WorkspaceView } from './protocol-workspace'
import { VeMezoWorkspace, type VeMezoView } from './ve-mezo-workspace'
import { DeveloperLab } from './developer-lab'

type PageView = 'Markets' | 'Trade' | 'Liquidity' | 'Portfolio' | 'Developer' | 'Create' | 'Mint' | 'Redeem'
type Protocol = 'MUSD' | 'veMEZO'

const navigation: { label: PageView; icon: typeof BarChart3 }[] = [
  { label: 'Markets', icon: BarChart3 },
  { label: 'Trade', icon: ArrowDownUp },
  { label: 'Liquidity', icon: Droplets },
  { label: 'Portfolio', icon: LayoutDashboard },
]

const protocols: Protocol[] = ['MUSD', 'veMEZO']

export function ExchangeShell() {
  const [activeView, setActiveView] = useState<PageView>('Markets')
  const [protocol, setProtocol] = useState<Protocol>('MUSD')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const { address, isConnected } = useAccount()
  const isDeveloper = isConnected && address?.toLowerCase() === MEZO_DEVELOPER_ADDRESS.toLowerCase()

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 720px)')
    const updateViewport = () => {
      setIsMobile(mediaQuery.matches)
      if (!mediaQuery.matches) setMobileOpen(false)
    }
    updateViewport()
    mediaQuery.addEventListener('change', updateViewport)
    return () => mediaQuery.removeEventListener('change', updateViewport)
  }, [])

  useEffect(() => {
    if (activeView === 'Developer' && !isDeveloper) setActiveView('Markets')
  }, [activeView, isDeveloper])

  const navigate = (view: PageView) => {
    if (view === 'Developer' && !isDeveloper) return
    setActiveView(view)
    setMobileOpen(false)
  }

  const primaryView: PageView = activeView === 'Create' ? 'Markets' : activeView === 'Mint' || activeView === 'Redeem' ? 'Trade' : activeView
  const pageTitle = activeView === 'Developer' ? 'Developer console' : activeView === 'Create' ? 'Create market' : primaryView
  const pageSubtitle = activeView === 'Markets' ? 'Browse MUSD and veMEZO yield markets.' : activeView === 'Trade' ? 'Swap principal and yield tokens.' : activeView === 'Liquidity' ? 'Add or withdraw liquidity from active markets.' : activeView === 'Portfolio' ? 'Your positions and balances across MUSD and veMEZO.' : activeView === 'Developer' ? 'Protocol configuration, market-design evaluation, and source admission.' : activeView === 'Create' ? 'Create a market for a new maturity or eligible veMEZO lock.' : 'Manage your MUSD position and claims.'
  const showProtocolTabs = ['Markets', 'Trade', 'Liquidity'].includes(activeView)
  const protocolView = activeView as WorkspaceView
  const veMezoView = primaryView as VeMezoView

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-hidden={isMobile && !mobileOpen ? true : undefined} inert={isMobile && !mobileOpen}>
        <a className="brand" href="#markets" aria-label="MUSD Yield Exchange home">
          <span className="brand-mark" aria-hidden="true">m</span>
          <span>MUSD<span className="brand-light">.finance</span></span>
        </a>
        <button type="button" className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X aria-hidden="true" /><span>Close menu</span></button>
        <div className="nav-caption">EXCHANGE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${primaryView === label ? 'nav-active' : ''}`} aria-current={primaryView === label ? 'page' : undefined} onClick={() => navigate(label)}>
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
          {isDeveloper && <button className={`nav-item ${activeView === 'Developer' ? 'nav-active' : ''}`} aria-current={activeView === 'Developer' ? 'page' : undefined} onClick={() => navigate('Developer')}><Code2 size={17} strokeWidth={1.8} aria-hidden="true" /><span>Developer</span></button>}
        </nav>
        <div className="sidebar-bottom"><div className="sidebar-foot">Built on Mezo<br /><span>Testnet environment</span></div></div>
      </aside>
      {mobileOpen && <div className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-expanded={mobileOpen} aria-label={mobileOpen ? 'Close menu' : 'Open menu'}>{mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>
          <div className="breadcrumbs"><span>Mezo</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div>
          <div className="top-actions"><a className="app-home-link" href="/" aria-label="Back to MUSD Yield Exchange marketing homepage">Home</a><NetworkStatus /><WalletButton /></div>
        </header>
        <section className="page-content" aria-label={`${pageTitle} workspace`}>
          <div className="heading-row">
            <div><h1>{pageTitle}</h1><p className="page-subtitle">{pageSubtitle}</p></div>
          </div>
          {showProtocolTabs && <div className="protocol-tabs" role="group" aria-label="Choose market protocol">{protocols.map((item) => <button key={item} type="button" aria-pressed={protocol === item} className={protocol === item ? 'protocol-tab-active' : ''} onClick={() => setProtocol(item)}>{item}<span>{item === 'MUSD' ? 'Savings yield' : 'Rebase yield'}</span></button>)}</div>}
          {activeView === 'Portfolio' ? (
            <div className="combined-workspace"><section className="protocol-workspace-section"><div className="section-label">MUSD positions</div><ProtocolWorkspace view="Portfolio" onNavigate={navigate} /></section><section className="protocol-workspace-section"><div className="section-label">veMEZO positions</div><VeMezoWorkspace view="Portfolio" /></section></div>
          ) : activeView === 'Developer' ? (
            <div className="combined-workspace developer-workspace"><section className="protocol-workspace-section"><div className="section-label">MUSD factory</div><ProtocolWorkspace view="Developer" onNavigate={navigate} /></section><section className="protocol-workspace-section"><div className="section-label">veMEZO factory</div><VeMezoWorkspace view="Developer" /></section><section className="protocol-workspace-section"><DeveloperLab /></section></div>
          ) : protocol === 'MUSD' ? (
            <ProtocolWorkspace view={protocolView} onNavigate={navigate} />
          ) : (
            <VeMezoWorkspace view={veMezoView} />
          )}
          <footer className="content-footer"><span>Mezo Testnet <span className="footer-sep">·</span> Experimental contracts</span><a href="https://mezo.org" target="_blank" rel="noreferrer">Mezo network</a></footer>
        </section>
      </main>
    </div>
  )
}
