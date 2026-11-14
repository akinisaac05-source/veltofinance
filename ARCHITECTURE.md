# MUSD Yield Exchange — Mezo Testnet Implementation

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
