'use client'

import { useMemo, useState } from 'react'

const initialInputs = {
  capital: 100_000,
  tradeSize: 2_000,
  annualVolume: 1_000_000,
  lpShare: 10,
  annualYield: 5,
  daysToMaturity: 180,
  priceShock: 0.25,
}

function quoteExactIn(reserve: number, amountIn: number, feeBps: number) {
  if (reserve <= 0 || amountIn <= 0) return 0
  const netInput = amountIn * (10_000 - feeBps) / 10_000
  return netInput * reserve / (reserve + netInput)
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`
}

export function DeveloperLab() {
  const [inputs, setInputs] = useState(initialInputs)
  const results = useMemo(() => {
    const poolReserve = Math.max(0, inputs.capital) / 4
    const consolidatedReserve = Math.max(0, inputs.capital) / 2
    const safeTradeSize = Math.max(0, inputs.tradeSize)
    const safeDaysToMaturity = Math.max(1, inputs.daysToMaturity)
    const continuousRate = Math.max(0, inputs.annualYield) / 100
    const currentOutput = quoteExactIn(poolReserve, safeTradeSize, 30)
    const consolidatedOutput = quoteExactIn(consolidatedReserve, safeTradeSize, 30)
    const routeMusdOutput = quoteExactIn(poolReserve, safeTradeSize, 30)
    const routedYtOutput = quoteExactIn(poolReserve, routeMusdOutput, 30)
    const ptPrice = Math.exp(-continuousRate * safeDaysToMaturity / 365)
    const impliedAnnualYield = (Math.pow(1 / ptPrice, 365 / safeDaysToMaturity) - 1) * 100
    const maturityPrices = [30, 180, 365].map((days) => ({ days, price: Math.exp(-continuousRate * days / 365) }))
    const feeIncomePerMarket = Math.max(0, inputs.annualVolume) * 0.003 * Math.max(0, inputs.lpShare) / 100
    const consolidatedFeeIncome = Math.max(0, inputs.annualVolume) * 2 * 0.003 * Math.max(0, inputs.lpShare) / 100
    const priceRatio = Math.max(0.01, 1 + inputs.priceShock)
    const impermanentLoss = (2 * Math.sqrt(priceRatio) / (1 + priceRatio) - 1) * 100
    const currentImpact = safeTradeSize > 0 ? (1 - currentOutput / safeTradeSize) * 100 : 0
    const sharedImpact = safeTradeSize > 0 ? (1 - consolidatedOutput / safeTradeSize) * 100 : 0
    const routeImpact = safeTradeSize > 0 ? (1 - routedYtOutput / safeTradeSize) * 100 : 0
    return { poolReserve, consolidatedReserve, currentOutput, consolidatedOutput, routeMusdOutput, routedYtOutput, ptPrice, impliedAnnualYield, maturityPrices, feeIncomePerMarket, consolidatedFeeIncome, impermanentLoss, currentImpact, sharedImpact, routeImpact }
  }, [inputs])

  const update = (key: keyof typeof initialInputs, value: string) => {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) setInputs((current) => ({ ...current, [key]: parsed }))
  }

  return (
    <div className="developer-lab">
      <section className="lab-intro">
        <div><span className="section-label">P2 · MARKET DESIGN</span><h2>Pool design benchmark</h2><p>Compare today&apos;s two independent PT/MUSD and YT/MUSD constant-product pools with a shared-depth routing <strong>upper-bound proxy</strong>. This is a decision aid—not Pendle AMM math and not a proposed contract.</p></div>
        <span className="lab-status">SIMULATION · NOT LIVE DATA</span>
      </section>

      <div className="lab-layout">
        <section className="lab-card" aria-labelledby="lab-assumptions-title">
          <h3 id="lab-assumptions-title">Scenario assumptions</h3>
          <p className="lab-caption">All amounts are illustrative. Change one input to see how the comparison responds.</p>
          <div className="lab-input-grid">
            <label>Total LP capital (USD)<input type="number" min="1000" step="1000" value={inputs.capital} onChange={(event) => update('capital', event.target.value)} /></label>
            <label>Exact-input trade (USD)<input type="number" min="1" step="100" value={inputs.tradeSize} onChange={(event) => update('tradeSize', event.target.value)} /></label>
            <label>Annual volume per market (USD)<input type="number" min="0" step="10000" value={inputs.annualVolume} onChange={(event) => update('annualVolume', event.target.value)} /></label>
            <label>LP ownership (%)<input type="number" min="0" max="100" step="1" value={inputs.lpShare} onChange={(event) => update('lpShare', event.target.value)} /></label>
            <label>Source yield assumption (%)<input type="number" min="0" max="100" step="0.25" value={inputs.annualYield} onChange={(event) => update('annualYield', event.target.value)} /></label>
            <label>Days to maturity<input type="number" min="1" max="3650" step="1" value={inputs.daysToMaturity} onChange={(event) => update('daysToMaturity', event.target.value)} /></label>
            <label>PT market price move (%)<input type="number" min="-99" max="500" step="1" value={inputs.priceShock * 100} onChange={(event) => update('priceShock', String(Number(event.target.value) / 100))} /></label>
          </div>
        </section>

        <section className="lab-card lab-results" aria-labelledby="lab-results-title">
          <h3 id="lab-results-title">Same capital, different topology</h3>
          <p className="lab-caption">At a 1:1 starting price, the baseline splits capital evenly across two pools. Shared depth assumes both markets can use one consolidated reserve.</p>
          <div className="benchmark-table-wrap"><table className="benchmark-table"><thead><tr><th>Metric</th><th>Two CP pools</th><th>Shared-depth proxy</th></tr></thead><tbody>
            <tr><th scope="row">MUSD-side reserve per route</th><td>{formatUsd(results.poolReserve)}</td><td>{formatUsd(results.consolidatedReserve)}</td></tr>
            <tr><th scope="row">Exact-input output after 0.30% fee and price impact</th><td>{formatUsd(results.currentOutput)}</td><td>{formatUsd(results.consolidatedOutput)}</td></tr>
            <tr><th scope="row">Execution price impact, incl. 0.30% fee</th><td>{formatPercent(results.currentImpact)}</td><td>{formatPercent(results.sharedImpact)}</td></tr>
            <tr><th scope="row">Illustrative annual fee share</th><td>{formatUsd(results.feeIncomePerMarket)}</td><td>{formatUsd(results.consolidatedFeeIncome)}</td></tr>
          </tbody></table></div>
          <div className="lab-kpis"><div><span>PT fair-value reference</span><strong>{results.ptPrice.toFixed(4)} SY</strong><small>Continuous-yield illustration at {inputs.annualYield}% for {Math.max(1, inputs.daysToMaturity)} days</small></div><div><span>Annualized rate from PT price</span><strong>{formatPercent(results.impliedAnnualYield)}</strong><small>Model-derived; not an observed rate or forecast</small></div><div><span>CP LP divergence loss</span><strong>{formatPercent(Math.abs(results.impermanentLoss))}</strong><small>At a {formatPercent(inputs.priceShock * 100)} PT price move vs holding, before fees/yield</small></div></div>
          <div className="benchmark-table-wrap maturity-table-wrap"><table className="benchmark-table"><caption>PT/SY fair-value sensitivity to maturity · illustrative only</caption><thead><tr><th scope="col">Days to maturity</th>{results.maturityPrices.map(({ days }) => <th key={days} scope="col">{days} days</th>)}</tr></thead><tbody><tr><th scope="row">PT/SY reference</th>{results.maturityPrices.map(({ days, price }) => <td key={days}>{price.toFixed(4)} SY</td>)}</tr></tbody></table></div>
          <p className="route-scenario"><strong>Current router reference:</strong> PT → MUSD → YT applies two separate 30 bps CP swaps. For the entered trade it returns {formatUsd(results.routedYtOutput)} YT after routing {formatUsd(results.routeMusdOutput)} MUSD; modeled execution impact is {formatPercent(results.routeImpact)}. The shared-depth case above is a capital-concentration proxy, not a simulated PT/SY route or an assertion that routes are interchangeable.</p>
          <p className="lab-caveat"><strong>Read this carefully:</strong> Shared-depth assumes fungible routing inventory and 2× per-route MUSD depth. It does not model Pendle&apos;s time-varying AMM curve, PT/SY exchange mechanics, correlated flow, routing gas, utilization, source loss, or incentive dilution. Fee estimates assume 30 bps and the entered volume is fully realized; they are not APR promises.</p>
        </section>
      </div>

      <section className="lab-card design-dimensions" aria-labelledby="design-dimensions-title"><h3 id="design-dimensions-title">What a Pendle-inspired candidate changes</h3><p className="lab-caption">Directional design comparison only; candidate behavior must be implemented against a specified curve and replayed before it is comparable.</p><div className="policy-table-wrap"><table className="benchmark-table policy-table"><thead><tr><th>Dimension</th><th>Current MUSD design</th><th>Candidate to benchmark</th><th>Decision metric</th></tr></thead><tbody>
          <tr><th scope="row">Liquidity inventory</th><td>Independent PT/MUSD and YT/MUSD reserves; LP capital and depth fragment by token.</td><td>PT/SY market may concentrate liquidity into a yield-aware venue; share accounting and source wrapper must be specified first.</td><td>Quote depth and price impact at matched capital across realistic order sizes.</td></tr>
          <tr><th scope="row">Maturity pricing</th><td>Reserve-ratio spot price is maturity-agnostic; it can diverge from redemption value.</td><td>Time-aware PT/SY curve can move toward PT redemption value as maturity approaches.</td><td>Price convergence, rate sensitivity, arbitrage loss, and tail behavior over maturity buckets.</td></tr>
          <tr><th scope="row">Routing</th><td>Single selected PT/MUSD or YT/MUSD swap; PT→MUSD→YT requires two pools and two fees.</td><td>Router may compare direct, split, and multi-hop paths across eligible markets.</td><td>Net output after fees, impact, gas, route failure, and source-specific conversion costs.</td></tr>
          <tr><th scope="row">LP return sources</th><td>Swap fees in both pools; realized source yield accrues to YT-pool LPs only.</td><td>Potential PT yield, SY yield, fees, and capped incentives differ by implementation.</td><td>Report each realized component, inventory divergence, and source-loss exposure separately.</td></tr>
        </tbody></table></div></section>

      <section className="lab-card lab-decision" aria-labelledby="lab-decision-title"><h3 id="lab-decision-title">Decision gate: measure before changing contracts</h3><div className="lab-gates"><div><strong>1. Replay real flow</strong><p>Collect per-market swaps, sizes, direction, fees, reserves, and maturity; replay identical order flow through both models.</p></div><div><strong>2. Report LP outcomes</strong><p>Compare depth by trade size, fees net of inventory divergence, yield actually realized, and tail loss across maturity windows.</p></div><div><strong>3. Keep deployment gated</strong><p>Require audited curve math, oracle/spot separation, invariant and manipulation tests, and a funded liquidity plan before selecting mechanics.</p></div></div><p className="lab-recommendation">No mechanics are selected here. The current separate pools remain the reference until a reproducible, source-backed benchmark shows a robust improvement.</p></section>

      <section className="lab-card source-policy" aria-labelledby="source-policy-title">
        <div className="policy-heading"><div><span className="section-label">P3 · SCALE</span><h2 id="source-policy-title">Source admission standard</h2></div><span className="policy-badge">REVIEW REQUIRED</span></div>
        <p className="lab-caption">A source is admitted only when every gate below has evidence, an owner, and a monitor. A new source starts testnet-only; missing evidence blocks deposits and incentives.</p>
        <div className="policy-table-wrap"><table className="benchmark-table policy-table"><thead><tr><th>Gate</th><th>Required invariant / evidence</th><th>Monitor and failure response</th></tr></thead><tbody>
          <tr><th scope="row">Identity & custody</th><td>Chain, asset, vault/share token, reward token, proxy implementation, admin and upgrade policy are verified. Asset and share decimals match the adapter&apos;s explicit conversion rules.</td><td>Pin addresses and code/implementation hashes; alert on upgrades, owner changes, or identity mismatch. Freeze new deposits pending review.</td></tr>
          <tr><th scope="row">Token behavior</th><td>Exact-transfer behavior, balance deltas, decimals, rebases, fees, pausing, blacklists, and callbacks are documented. Unsupported behavior is rejected, not silently normalized.</td><td>Check pre/post transfer balances and share conversion; alert on unexpected deltas, decimals, or transfer failures. Keep withdrawals/claims available where safely possible.</td></tr>
          <tr><th scope="row">Claim accounting</th><td>Claimable amount is monotonic or its reset semantics are specified; claimed asset delta is measured; zero-progress/backlog bounds are tested; rounding dust and claimant snapshot rules are defined.</td><td>Track claimable vs claimed and reserve vs token supply; alert on stalled claims, backlog, reserve deficit, or index drift. Do not publish estimated yield as realized.</td></tr>
          <tr><th scope="row">Maturity & loss</th><td>Settlement timing, redemption order, source loss, surplus, unclaimed balances, and final claim behavior are specified and invariant-tested.</td><td>Reconcile source shares, recovered assets, PT liability, and YT reserve at each checkpoint and settlement. Pause new issuance if solvency checks fail.</td></tr>
          <tr><th scope="row">Operational readiness</th><td>Independent code review, adversarial/fuzz tests, testnet end-to-end evidence, incident owner, pause authority, and migration/withdrawal plan are signed off.</td><td>Publish last-check time, source health, and incident status. Any critical alert blocks new markets until resolved.</td></tr>
        </tbody></table></div>
        <div className="reward-rules"><h3>Reward-budget rules</h3><ul><li>Rewards must be pre-funded or backed by a capped, explicitly authorized budget; never promise uncapped emissions.</li><li>Set per-market and program-wide caps, start/end dates, eligible actions, anti-wash-trading rules, and a stop condition before launch.</li><li>Disclose fee income, source yield, and incentive rewards separately. Calculate realized LP outcomes from on-chain data; label projections as estimates.</li><li>Do not add governance incentives until source admission, budget ownership, monitoring, and an auditable payout path are in place.</li></ul></div>
      </section>
    </div>
  )
}
