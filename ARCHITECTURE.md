# Velto Finance — Yield Exchange on Mezo Testnet

## Live environment checks

- Target: Mezo Testnet, chain ID `31611`, RPC `https://rpc.test.mezo.org`, native gas token BTC, Solidity `0.8.28`.
- The RPC answered `eth_chainId` with `0x7b7b` (31611) on 2026-11-14.
- Live testnet MUSD: `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`; on-chain `name`, `symbol`, and `decimals` returned `Mezo USD`, `MUSD`, and `18`.
- Live testnet savings vault: `0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16`; on-chain `name`, `symbol`, and `decimals` returned `MUSD Savings Rate`, `sMUSD`, and `18`. Its `musdToken()` returned the MUSD address above, and the EIP-1967 implementation slot resolved to `0x92d12f0a60906b39d81acd9bf8977b6c824cd98c`.
- The deployed vault is a custom non-ERC-4626 share token with separate `claimableYield(holder)` / `claimYield()` accounting. Its mainnet and testnet implementations are not assumed identical; the exchange checks the live underlying and 18-decimal share/asset interface at deployment.
- The vault is a proxy, so its implementation and admin policy remain an external protocol trust assumption. Identity checks are not an independent bytecode audit.

## Components and boundaries

- `YieldExchange`: immutable, testnet-only single-maturity custody and settlement contract. It verifies the MUSD/sMUSD addresses, exact 18-decimal denominations, and 1:1 source shares on every deposit.
- `PrincipalToken` and `YieldToken`: separate transferable ERC-20 claims minted 1:1. YT balances are checkpointed before transfers so already-realized yield cannot move to a later holder.
- `YieldMarket`: separate permissionless constant-product PT/MUSD and YT/MUSD pools with a 0.30% fee, reserve-based quotes, exact-input swaps, and liquidity positions. It does not expose an oracle price or fabricated APR.
- Browser app: reads the real Mezo testnet contracts through the public RPC, provides wallet-signed contract deployment and deposit/trade/LP/settlement flows, and stores deployed addresses in the URL rather than local storage or a backend.
- No mock or faucet contract remains in `contracts/src`; isolated controllable fixtures exist only under `contracts/test` for regression testing.

## Implemented accounting rule

Each exchange has one immutable future maturity. A deposit of `P` MUSD must produce exactly `P` sMUSD shares or the transaction reverts; on success it mints `P` PT plus `P` YT. PT and YT are complementary claims, not two redeemable copies of principal. The source sMUSD balance is the custody record; principal cannot be redeemed before settlement.

The exchange harvests `claimableYield(exchange)` before new deposits and before YT transfers. Each realized MUSD yield delta is credited through a cumulative per-share index; YT holders are checkpointed before their balances change. Users may claim only credited MUSD held by the exchange. On maturity, the exchange harvests remaining yield, withdraws the actual sMUSD position once, caps PT redemption at the lesser of initial principal and MUSD actually recovered, and allocates any recovered surplus above principal to YT. Any source loss is borne by PT; no principal payout can exceed assets actually recovered. Settlement and PT redemption are guarded against reentrancy and double claims.

The market uses two independent constant-product pools. Swaps require exact input and a caller-supplied minimum output; the app derives that minimum from a 1% slippage bound. Pool quotes are not an oracle or a fair-value assertion. LP balances are tracked on-chain and intentionally non-transferable in this testnet version. Rounding dust remains in the contracts; it is not swept to an operator.

## Testnet-only status and remaining gates

- Seven Foundry regression tests pass for issuance, source custody, pre-deposit yield allocation, transfer checkpointing, source loss, realized surplus, maturity gating, and PT/MUSD trading. Contract sizes are below EVM runtime/initcode limits.
- The app and deployment artifacts compile against Solidity 0.8.28 / OpenZeppelin 5.6.1. Unit fixtures are isolated in `contracts/test`; they are not wired into the app and must never be deployed.
- Protocol contracts are not yet deployed to Mezo Testnet. The app includes a wallet-signed deployment flow; a user must connect a wallet on chain 31611, select maturity, and approve the two deployment transactions. No private key is collected or held by the app.
- No market liquidity is seeded at deployment. Trading starts only after a user supplies PT or YT and MUSD to its pool.
- These contracts are unaudited testnet code. Do not use mainnet assets or treat passing unit tests as an audit. Remaining checks before wider reliance: test with a funded wallet against the actual vault, verify deposit/claim/withdraw behavior on testnet, fuzz adversarial transfer and rounding sequences, and obtain independent review.
- MUSD/sMUSD contract addresses and claim selectors were checked using live read-only RPC calls. That does not establish byte-for-byte source verification or eliminate the source proxy's upgrade risk.

## P2 — Market-design evaluation (no mechanic selected)

The current reference is two independent 0.30% constant-product pools: PT/MUSD and YT/MUSD. They have separate reserves, LP shares, and execution prices; YT-side LPs also receive realized source yield under the current contract, while PT-side LPs receive swap fees only. Neither reserve quote is an oracle or an implied-yield guarantee.

The Developer console includes an illustrative capital/depth calculator. It compares the current two-pool capital split with a shared-depth upper-bound proxy at an assumed 1:1 start price, using the exact-input constant-product formula with 30 bps. The proxy is intentionally not labeled a Pendle AMM simulation: it does not implement Pendle's PT/SY inventory rules, time-varying curve, dynamic fee, routing, utilization, correlated order flow, gas, source losses, or incentives. Its outputs are not deployment evidence. The PT value reference uses continuous compounding, `PT/SY = exp(-r × days / 36500)` for percentage `r`; annualized yield is derived from that price. The LP divergence estimate uses the standard constant-product hold comparison and excludes fee income and yield.

**Decision gate:** collect actual per-market reserves, order sizes/directions, realized fees, claimable and realized source yield, and time-to-maturity snapshots; replay identical flows against specified candidate curve implementations; report execution cost by trade size and maturity, LP inventory divergence, realized fee/yield/incentive components, utilization, and tail scenarios. Require independent review, invariant/fuzz/manipulation tests, and source-backed capital/reward assumptions before selecting or deploying any new pool or router. Until then, separate pools remain the reference.

## P3 — Yield-source admission and incentives

A source is not eligible for deposits or market creation until an accountable reviewer has recorded evidence for all gates below. The same controls apply to MUSD/sMUSD and the distinct veMEZO NFT/rebase source model; a common tokenized-yield abstraction must not erase their different custody and claim semantics.

1. **Identity and governance:** verify chain, asset/share/reward addresses, bytecode and proxy implementation, admin/upgrader, and upgrade/pause policy. Pin expected values and re-review any implementation or privileged-role change.
2. **Denominations and transfer behavior:** record decimals and conversion rules for every asset/share/reward token. Test exact in/out deltas, fees, rebases, callbacks, pauses, blacklist behavior, and transfer restrictions. Reject unsupported token behavior or use a separately reviewed adapter; never assume 18 decimals or 1:1 shares without evidence.
3. **Yield claim semantics:** specify claimable-state and reset behavior, reward asset, bounded rounds, progress detection, index/snapshot rules, rounding dust, and behavior when claims stall or backlog. Measure received balances rather than trusting a return value; distinguish realized assets from estimates.
4. **Solvency and maturity:** define source custody, settlement timing, recovery waterfall, PT loss cap, YT surplus treatment, redemption order, and all final/unclaimed states. Test that liabilities never exceed actual recoveries and that source loss and surplus are represented correctly.
5. **Verification and operations:** require independent review, unit/fuzz/invariant/adversarial tests, a funded testnet lifecycle, event/accounting reconciliation, an incident owner, monitoring, pause criteria, and a recovery/withdrawal plan. Publish status and last-check time; a critical identity, claim, reserve, or accounting alert blocks new deposits until cleared.

**Reward-budget policy:** incentives require an identified budget owner, pre-funded or explicitly capped authorization, per-market and global ceilings, start/end dates, eligible actions, anti-wash-trading rules, and a stop condition. Pay only under an auditable, tested distribution path. Show swap fees, source yield, and incentive rewards as separate realized components; do not advertise a guaranteed or blended APR. Governance-funded incentives remain out of scope until admission, budget authority, monitoring, and payout controls are operational.
