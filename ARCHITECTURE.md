# Velto Finance — Current Project State

Last verified against the repository and Mezo Testnet RPC: 2026-11-15. On-chain figures below are a point-in-time snapshot, not a promise that contracts, balances, or liquidity remain unchanged.

## Product

Velto is a testnet yield-market application with two distinct flows:

- **MUSD savings-rate markets:** a MUSD deposit is placed into the Mezo sMUSD savings vault and represented by equal PT and YT claims for a selected maturity. PT represents the principal claim at settlement; YT receives realized, attributed savings yield. The app supports market discovery, PT/YT trading against MUSD, liquidity management, portfolio balances, yield harvesting/claims, and maturity settlement/redemption.
- **veMEZO lock-yield markets:** an eligible veMEZO NFT lock is deposited into a maturity-specific tranche and represented by PT/YT claims. The app supports lock/series discovery, market creation for eligible locks, NFT approval/deposit, PT/YT trading against MEZO, liquidity management, rebase checkpointing, and settlement/redemption.

The app connects through an injected MetaMask-compatible EVM wallet using wagmi/viem, targets Mezo Testnet only (chain ID `31611`), and reads/writes contracts onchain. The current wallet provider does **not** implement Mezo Passport or Bitcoin-native wallet connection. Testnet assets have no guaranteed value. This is unaudited experimental software, not a production financial product.

## Verified MUSD testnet deployment

The following addresses are configured in `lib/mezo.ts` and were checked against the public Mezo Testnet RPC on 2026-11-15:

| Contract | Address | Observed state |
| --- | --- | --- |
| MUSD | `0x118917a40FAF1CD7a13DB0Ef56C86De7973Ac503` | Chain reads identify the token as MUSD with 18 decimals. |
| sMUSD savings vault | `0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16` | Chain reads identify the share token; the vault is an upgradeable proxy. |
| Yield series factory | `0x67f679c30ed7ee3a11b82311301a20cd1448be8c` | Deployed code present; `seriesCount()` returned 1. |
| Yield exchange | `0xAd3a0240CCacEa277AD2efc7fd6De42463766cEb` | Registered by the factory; `principalDeposited()` returned 20 MUSD; not settled at check time. |
| Yield market | `0x4A847b5e4F81CA3f76FFfe9f84ed190f550E4e72` | Registered by the factory; has PT/MUSD and YT/MUSD pools. |
| PT | `0xE374f1F299CFe31E679196268F33C571e1F8262c` | Exchange principal token. |
| YT | `0x3951cD851Ee21Ac9314FcD07081490C57bfc2460` | Exchange yield token. |

At the check time, the MUSD market reported PT pool reserves of `2,596` MUSD base units and `386` PT base units, and YT pool reserves of `2,054` MUSD base units and `488` YT base units. These are 18-decimal tokens: the reserves are dust-scale (far below one token), not usable market depth. **The markets are deployed and nonzero-reserve, but practically unliquid.** Do not describe them as having usable liquidity or imply that a representative trade can be completed without first checking current reserves.

The configured factory address can be overridden with `NEXT_PUBLIC_YIELD_SERIES_FACTORY_ADDRESS`. The code falls back to the deployed address above. Factory registration and configuration make the contracts discoverable to the app; they do not ensure meaningful liquidity.

## Verified veMEZO testnet deployment

The following addresses are configured in `lib/ve-mezo.ts` and were checked against the public RPC on 2026-11-15:

| Contract | Address | Observed state |
| --- | --- | --- |
| veMEZO | `0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b` | Configured veNFT contract. |
| Rewards distributor | `0x2962E8817ae716019F759d098e2caE658bDcAd04` | Configured distributor. |
| MEZO token | `0x7B7c000000000000000000000000000000000001` | Configured MEZO asset. |
| veMEZO yield factory | `0x45374d75ddf7c6c496776c7d33d1eb85a363990d` | Deployed code present; `seriesCount()` returned 1 and factory asset identities matched configured veMEZO/MEZO addresses. |

The factory page returned one registered series at the check time. This confirms deployed protocol setup, not that an arbitrary visitor owns an eligible NFT or can execute every flow; those depend on wallet state, approvals, funding, distributor state, and live contract conditions. `NEXT_PUBLIC_VEMEZO_YIELD_FACTORY_ADDRESS` can override the configured factory.

## Contract behavior and boundaries

- `YieldExchange` is a testnet-only, immutable, single-maturity MUSD/sMUSD custody and settlement contract. It checks the configured asset/vault identity and expected 18-decimal denominations and requires exact 1:1 sMUSD shares on deposit.
- Depositing `P` MUSD mints `P` PT and `P` YT. These are complementary claims, not two independently redeemable copies of principal. Principal is redeemable only after settlement and cannot exceed assets actually recovered.
- The exchange harvests realized vault yield before relevant accounting boundaries, attributes it through a cumulative per-share index, and checkpoints YT holders before transfers. At settlement, it withdraws the source position once, allocates recovered principal subject to actual recovery, and assigns surplus/yield according to the contract accounting. Source loss can reduce PT recovery.
- `YieldMarket` has separate constant-product PT/MUSD and YT/MUSD pools with a 0.30% swap fee, exact-input swaps, caller-specified minimum output, and onchain liquidity accounting. App swaps use a 1% quote slippage bound. Pool prices are reserve quotes, not oracles or yield guarantees. LP accounting is non-transferable in this testnet version; YT-pool LPs can claim attributed realized source yield, while PT-pool LPs receive swap-fee economics only.
- The veMEZO contracts represent veNFT/rebase semantics separately from MUSD/sMUSD share accounting; the two sources are not interchangeable. veMEZO positions require a valid eligible lock, and settlement is gated by expiry/distributor conditions implemented in the contracts and app.
- Contract fixtures are in `contracts/test`; do not deploy fixtures. `lib/deployment-artifacts.json` is generated from Solidity sources for the app's contract interactions and deployment flows.

## App behavior and limitations

- Main routes: `/` is the marketing page and `/app` is the exchange workspace.
- The MUSD workspace reads the factory catalog and onchain balances, quotes and swaps PT/YT, deposits MUSD, manages LP positions, harvests/claims yield, and provides maturity settlement and PT redemption controls. The veMEZO workspace reads owned lock NFTs and market series, and exposes the corresponding NFT, trade, LP, checkpoint, and settlement actions.
- Wallet-signed transactions require Mezo Testnet and user approval. The app does not collect or hold private keys. The current connector is injected MetaMask-compatible EVM only; Passport is not wired in.
- The Developer console is restricted to the configured developer address. It contains factory controls and an explicitly illustrative market-design calculator/source-admission guidance; calculator output is not live data or a deployed market design.
- The code is a client-side dapp and reads the configured public RPC directly. It has no app database, user account system, server-side transaction relay, indexed history service, or backend persistence. Deployed market discovery comes from the onchain factories.
- The factories expose pagination. MUSD catalog reads use 25 entries per page; veMEZO reads a first page of up to 50. The veMEZO portfolio only enumerates up to 20 NFTs returned by the contract for the connected wallet. Keep these limits in mind when describing catalog/portfolio completeness.
- Empty, stale, or dust-depth markets are possible. Quotes, token balances, allowances, eligibility, and maturity state are contract- and wallet-dependent. A nonzero reserve alone is not evidence of practical tradability.

## Verification status

- `pnpm run contracts:test` passed on 2026-11-15: 25 Foundry tests across three suites, including a 256-run settlement fuzz test. This validates those local fixtures and properties only; it does not audit deployed bytecode or prove all live interactions work.
- Live RPC reads on 2026-11-15 confirmed chain ID `31611`, deployed MUSD factory code and one registered series, deployed exchange/market/token reads, a 20 MUSD principal-deposit counter, dust-scale PT/YT pool reserves, and a deployed veMEZO factory with one registered series.
- The configured sMUSD vault is a proxy. Its implementation/admin policy and future upgrades are external trust assumptions; checking token identity is not an independent audit.
- Remaining risk work before any production use: independent contract/security review, broader invariant/adversarial testing, funded end-to-end flows against the deployed vault and veMEZO distributor, and operational monitoring/incident procedures. Do not use mainnet assets.

## Market-design evaluation (P2)

The current MUSD reference is two separate 0.30% constant-product pools: PT/MUSD and YT/MUSD. The Developer console calculator compares a user-entered two-pool capital split with a shared-depth upper-bound proxy. Its capital, trade volume, source yield, price, and maturity assumptions are illustrative inputs, not live observations or a Pendle AMM simulation. It omits time-varying curves, PT/SY inventory rules, routing effects beyond its stated toy model, gas, correlated order flow, source loss, utilization, and incentives. Do not use its output as evidence of live market depth, realized APR, or a recommendation to change contract mechanics.

The separate pools remain the implemented design. Any alternative should be evaluated against captured onchain reserves and order flow at matched capital, maturity, fee, and trade assumptions; report output, fees, utilization, LP inventory divergence, realized yield, and downside scenarios separately. No alternative curve or router is represented as deployed by this app.

## Yield-source admission and incentives (P3)

The Developer console documents a proposed admission policy, not an automated monitor or complete production control system. The policy calls for evidence covering source identity/governance, denominations and transfer behavior, yield claim semantics, maturity/solvency, independent review/testing, and operating ownership. Incentives remain a policy proposal: a real program would require an authorized, bounded budget, defined eligibility and anti-wash rules, dates, monitoring, and an auditable payout path. The UI's policy text does not itself enforce those operational requirements or create a reward program.
