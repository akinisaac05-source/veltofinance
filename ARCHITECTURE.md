# MUSD Yield Exchange — Phase 1 Architecture

## Status and verified environment

- Target: Mezo Testnet, chain ID `31611`, RPC `https://rpc.test.mezo.org`, native gas token BTC, Solidity `0.8.28`.
- The RPC answered `eth_chainId` with `0x7b7b` (31611) on 2026-11-14.
- The address `0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16` was mentioned in secondary research as a savings-rate-related contract. `eth_getCode` returned bytecode, but this does not prove its identity as the sMUSD vault, its source verification, or its ABI. The official materials inspected here did not establish the vault address or a usable interface. It is intentionally NOT wired into the app or contracts.
- The official product description available in research describes sMUSD as a receipt token for MUSD deposits, with yield associated with periodic protocol-fee distributions and reflected in the share exchange rate. Exact testnet deployment, conversion functions, source and deposit/withdrawal ABI remain unverified. Do not display this as live yield.

## Components and boundaries

- `IYieldSourceAdapter`: normalized underlying/share token addresses, deposit, withdrawal, exchange-rate, position and share valuation methods.
- `MockUnderlying` / `MockYieldSource`: local/testnet-only simulation. `MockUnderlying` is a permissionless faucet, while the vault's owner-controlled `simulateYield` mints mock assets into the vault to demonstrate appreciation. This is intentionally unsafe demo code: it is not MUSD, is not live yield, and must never be presented as such or deployed to production.
- Future `SMUSDYieldSourceAdapter`: implement only after verifying official deployment/source, token decimals, actual vault ABI, conversion semantics, deposit/withdrawal behavior, and testnet access. Keep protocol accounting independent of its implementation.
- Future `PrincipalToken` / `YieldToken`: distinct ERC-20 claims scoped to a source and maturity.
- Future `YieldTokenization`: custodies source shares and enforces issuance, yield accounting, maturity, and redemption.
- Future `YieldMarket` / `YieldRouter`: one market per maturity initially; trading and routing should be separate from custody/accounting.
- Frontend shell: Markets, Trade, Mint, Portfolio, Redeem navigation; wallet/network entry; no fabricated market/APY values and no simulated transactions.

## Accounting decision (required before implementation)

At deposit time record source shares `S0`, exchange rate `R0`, and maturity `T`; record `P0 = valueOf(S0)` underlying units. Mint 1:1 PT and YT against a defined principal unit only after selecting and auditing the denomination convention. PT is a claim on the maturity principal; YT is a claim to positive appreciation attributable to the tokenized shares. The underlying share balance, not a presumed growing token count, is the source of truth.

Yield attribution should use a cumulative per-share index / checkpoint model: snapshot an exchange-rate baseline for each series, compute positive appreciation from the source's exchange-rate and share accounting, checkpoint the user's YT balance before transfers, and accrue claimable yield without paying the same interval twice. Losses, rate decreases, rounding dust, fees, donations, and whether negative yield offsets later gains must be specified before implementation. The conservative default is no yield claims before a successful positive delta is realized and no principal payout beyond assets held.

At maturity, stop new yield accrual, settle YT against the final accounted value, and permit PT redemption only once per tokenized unit, burning/invalidating the corresponding claim before transferring assets. PT and YT represent complementary claims, not two independently redeemable copies of the full deposit. Enforce exact token/share conservation, maturity checks, reentrancy protection, safe token operations, access control for source/configuration, and per-series isolation. This is a design note, not audited or implemented settlement logic.

## Risks / security work before funds

- No production or testnet PT/YT issuance, trading, oracle, settlement, or custody logic is deployed by Phase 1.
- Validate rounding, decimals, exchange-rate manipulation, donation/inflation attacks, stale/malicious adapters, pauses, upgrade/config permissions, reentrancy, and token behavior.
- Add invariant/fuzz tests for conservation, no double redemption/claim, and adversarial exchange-rate paths before deployment. Obtain independent review and testnet rehearsal; never treat mocks as solvency evidence.
- Solidity compiler is pinned in Foundry config. Foundry is not installed in the current workspace, so Solidity test execution is presently blocked.

## Phase 2 prerequisites

1. Verify official sMUSD testnet deployment/address/source and call semantics from official Mezo docs or explorer; test against the live endpoint.
2. Finalize principal denomination, yield/loss and maturity accounting; implement PT, YT and tokenization with invariant tests.
3. Add one maturity market only after reviewing market design and settlement risks.
4. Wire wallet and contract transactions; keep an explicit mock-vs-real source selector and visually mark simulation.
5. Run Foundry unit/fuzz tests and frontend checks, then deploy/rehearse only on Mezo Testnet. No deployment has occurred in Phase 1.
