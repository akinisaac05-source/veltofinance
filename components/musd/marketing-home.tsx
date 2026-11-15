'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Check, ChevronDown, CircleHelp, Menu, ShieldCheck, Sparkles, X } from 'lucide-react'

type Product = 'MUSD' | 'veMEZO'

const productDetails: Record<Product, { label: string; headline: string; description: string; tag: string }> = {
  MUSD: {
    label: 'MUSD savings yield',
    headline: 'Make a view on yield.',
    description: 'Explore principal and yield tokens built around MUSD savings-rate markets and defined maturities.',
    tag: 'Savings-rate markets',
  },
  veMEZO: {
    label: 'veMEZO lock yield',
    headline: 'Put lock yield to work.',
    description: 'Explore markets tied to eligible veMEZO locks, with maturity-aware positions and liquidity tools.',
    tag: 'Lock-based markets',
  },
}

export function MarketingHome() {
  const [product, setProduct] = useState<Product>('MUSD')
  const [menuOpen, setMenuOpen] = useState(false)
  const detail = productDetails[product]

  return (
    <main className="marketing-page" id="top">
      <header className="marketing-nav">
        <Link className="marketing-brand" href="/" aria-label="Velto Finance home"><span className="brand-mark" aria-hidden="true">V</span><span>Velto<span className="brand-light"> Finance</span></span></Link>
        <button className="marketing-menu-toggle" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        <nav className={menuOpen ? 'marketing-links marketing-links-open' : 'marketing-links'} aria-label="Marketing navigation">
          <a href="#markets" onClick={() => setMenuOpen(false)}>Markets</a>
          <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
          <a href="#risk" onClick={() => setMenuOpen(false)}>Risk &amp; transparency</a>
          <Link className="marketing-nav-cta" href="/app">Open the app <ArrowUpRight aria-hidden="true" /></Link>
        </nav>
      </header>

      <section className="marketing-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="marketing-kicker"><span className="kicker-dot" /> MEZO TESTNET <span className="kicker-divider">/</span> YIELD MARKETS</div>
          <h1 id="hero-title">Yield has<br /><em>more than one</em><br />dimension.</h1>
          <p className="hero-description">Explore, trade, and provide liquidity across MUSD savings and veMEZO lock-yield markets—with principal and yield separated by maturity.</p>
          <div className="hero-actions"><Link className="button-dark" href="/app">Explore the exchange <ArrowRight aria-hidden="true" /></Link><a className="text-link" href="#how-it-works">See how it works <ArrowDownRight aria-hidden="true" /></a></div>
          <div className="hero-footnote"><span className="live-indicator" /> Experimental smart contracts on Mezo Testnet</div>
        </div>
        <div className="hero-visual" aria-label="Illustration of yield markets, principal and yield tokens, and a maturity timeline">
          <div className="visual-topline"><span>MARKET STRUCTURE / 01</span><span>MATURITY-BASED</span></div>
          <div className="yield-art">
            <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
            <div className="art-core"><span className="core-symbol">V</span><span className="core-caption">YIELD<br />EXCHANGE</span></div>
            <div className="art-node node-principal"><small>01 / PRINCIPAL</small><strong>PT</strong><span>Defined value at maturity</span></div>
            <div className="art-node node-yield"><small>02 / YIELD</small><strong>YT</strong><span>Exposure to future yield</span></div>
            <div className="art-node node-market"><small>03 / MARKET</small><strong>AMM</strong><span>Liquidity across maturities</span></div>
            <div className="art-line line-a" /><div className="art-line line-b" /><div className="art-line line-c" />
          </div>
          <div className="visual-footer"><span>Separate the components.</span><span>Choose your exposure. <ArrowUpRight aria-hidden="true" /></span></div>
        </div>
      </section>

      <section className="proof-strip" aria-label="Exchange capabilities">
        <div><span className="proof-index">01</span><strong>Principal tokens</strong><span>Defined maturity exposure</span></div>
        <div><span className="proof-index">02</span><strong>Yield tokens</strong><span>Variable yield exposure</span></div>
        <div><span className="proof-index">03</span><strong>Liquidity pools</strong><span>Market participation tools</span></div>
        <div><span className="proof-index">04</span><strong>Onchain markets</strong><span>Explore directly in the app</span></div>
      </section>

      <section className="markets-section" id="markets" aria-labelledby="markets-title">
        <div className="section-intro"><div><div className="marketing-kicker">TWO SOURCES. ONE EXCHANGE.</div><h2 id="markets-title">Choose the yield<br /><em>you want to understand.</em></h2></div><p>Switch between market types to see what each is designed to represent. Available markets and terms depend on the testnet deployment.</p></div>
        <div className="market-explorer">
          <div className="market-selector" role="tablist" aria-label="Select a yield market">
            {(['MUSD', 'veMEZO'] as Product[]).map((name) => <button type="button" role="tab" aria-selected={product === name} aria-controls="market-panel" id={`market-tab-${name}`} className={product === name ? 'market-select-active' : ''} key={name} onClick={() => setProduct(name)}><span className="selector-index">0{name === 'MUSD' ? 1 : 2}</span><strong>{name}</strong><span>{name === 'MUSD' ? 'Savings yield' : 'Lock yield'}</span><ArrowUpRight aria-hidden="true" /></button>)}
            <div className="selector-note"><ShieldCheck aria-hidden="true" /><span>Testnet only<br />No real assets</span></div>
          </div>
          <div className="market-detail" id="market-panel" role="tabpanel" aria-labelledby={`market-tab-${product}`} aria-live="polite">
            <div className="market-detail-head"><span className="market-tag"><span />{detail.tag}</span><span className="detail-index">MARKET / 0{product === 'MUSD' ? '1' : '2'}</span></div>
            <h3>{detail.headline}</h3><p>{detail.description}</p>
            <div className="market-graphic" aria-hidden="true">
              <div className="graphic-axis"><span>YIELD EXPOSURE</span><span>MATURITY →</span></div>
              <svg viewBox="0 0 620 180" preserveAspectRatio="none"><defs><linearGradient id="yieldFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#e64552" stopOpacity=".25"/><stop offset="100%" stopColor="#e64552" stopOpacity="0"/></linearGradient></defs><path className="chart-area" d="M0 144 C55 136 72 108 123 118 S202 86 258 100 S341 49 386 73 S462 48 507 62 S572 24 620 18 V180 H0Z"/><path className="chart-line" d="M0 144 C55 136 72 108 123 118 S202 86 258 100 S341 49 386 73 S462 48 507 62 S572 24 620 18"/><circle cx="386" cy="73" r="5"/><circle cx="620" cy="18" r="5"/></svg>
              <div className="chart-labels"><span>NOW</span><span>MATURITY</span></div>
            </div>
            <div className="market-detail-bottom"><div><span>AVAILABLE IN APP</span><strong>Markets · Trade · Liquidity</strong></div><Link href="/app">Explore {product} <ArrowRight aria-hidden="true" /></Link></div>
          </div>
        </div>
      </section>

      <section className="how-section" id="how-it-works" aria-labelledby="how-title">
        <div className="how-header"><div className="marketing-kicker">A CLEARER WAY TO PARTICIPATE</div><h2 id="how-title">From market to position,<br /><em>with the details in view.</em></h2><Link className="button-outline" href="/app">Go to the exchange <ArrowUpRight aria-hidden="true" /></Link></div>
        <div className="steps-grid">
          <article className="step-card"><div className="step-head"><span>01 / DISCOVER</span><BarChart3 aria-hidden="true" /></div><h3>Compare active markets</h3><p>Review available source, maturity, liquidity, and market terms before you decide what to do.</p><div className="step-micro"><span className="micro-bars"><i /><i /><i /><i /><i /></span><span>MARKET DETAILS</span></div></article>
          <article className="step-card"><div className="step-head"><span>02 / SELECT</span><Sparkles aria-hidden="true" /></div><h3>Choose principal or yield</h3><p>Trade PT or YT based on the exposure you want. Each token represents a different part of the position.</p><div className="token-pair"><span>PT <small>PRINCIPAL</small></span><span className="pair-plus">+</span><span>YT <small>YIELD</small></span></div></article>
          <article className="step-card"><div className="step-head"><span>03 / MANAGE</span><Check aria-hidden="true" /></div><h3>Track your position</h3><p>Use the portfolio view to review balances and manage supported actions for your connected wallet.</p><div className="step-micro portfolio-micro"><span>YOUR POSITION</span><strong>PT <i /> YT <i /> LP</strong><ArrowUpRight aria-hidden="true" /></div></article>
        </div>
      </section>

      <section className="risk-section" id="risk" aria-labelledby="risk-title">
        <div className="risk-mark"><CircleHelp aria-hidden="true" /><span>READ BEFORE USE</span></div>
        <div className="risk-copy"><div className="marketing-kicker">TRANSPARENCY FIRST</div><h2 id="risk-title">This is an experiment,<br /><em>not a promise of yield.</em></h2><p>Velto Finance is an experimental interface for Mezo Testnet. Smart contracts, markets, displayed rates, and balances may be incomplete or change without notice. Testnet assets have no guaranteed value. This is not financial advice or a guarantee of performance.</p><Link href="/app">Review the live testnet markets <ArrowRight aria-hidden="true" /></Link></div>
        <div className="risk-stamp"><span>MEZO</span><strong>TEST<br />NET</strong><span>EXPERIMENTAL / 2026</span></div>
      </section>

      <footer className="marketing-footer"><Link className="marketing-brand" href="/" aria-label="Velto Finance home"><span className="brand-mark" aria-hidden="true">V</span><span>Velto<span className="brand-light"> Finance</span></span></Link><span>Yield markets on Mezo Testnet.</span><div><a href="#risk">Risk disclosure</a><Link href="/app">Open exchange <ArrowUpRight aria-hidden="true" /></Link></div></footer>
      <a className="back-to-top" href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>TOP <ChevronDown aria-hidden="true" /></a>
    </main>
  )
}
