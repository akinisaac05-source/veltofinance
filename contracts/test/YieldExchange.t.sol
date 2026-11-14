// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMUSDSavingsRate} from "../src/interfaces/IMUSDSavingsRate.sol";
import {YieldExchange} from "../src/YieldExchange.sol";
import {YieldMarket} from "../src/YieldMarket.sol";
import {YieldSeriesFactory} from "../src/YieldSeriesFactory.sol";
import {PrincipalToken} from "../src/PrincipalToken.sol";
import {YieldToken} from "../src/YieldToken.sol";

interface Vm {
    function chainId(uint256 newChainId) external;
    function warp(uint256 newTimestamp) external;
    function prank(address sender) external;
    function expectRevert() external;
}

contract FixtureMUSD is ERC20 {
    constructor() ERC20("Fixture MUSD", "fMUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FixtureSavingsRate is ERC20, IMUSDSavingsRate {
    using SafeERC20 for IERC20;

    IERC20 private immutable asset;
    mapping(address holder => uint256 amount) public override claimableYield;
    uint256 public withdrawalBps = 10_000;

    constructor(address asset_) ERC20("Fixture sMUSD", "fsMUSD") {
        asset = IERC20(asset_);
    }

    function musdToken() external view override returns (address) {
        return address(asset);
    }

    function deposit(uint256 amount) external override {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
    }

    function withdraw(uint256 amount) external override {
        _burn(msg.sender, amount);
        asset.safeTransfer(msg.sender, (amount * withdrawalBps) / 10_000);
    }

    function claimYield() external override returns (uint256 claimed) {
        claimed = claimableYield[msg.sender];
        claimableYield[msg.sender] = 0;
        if (claimed > 0) asset.safeTransfer(msg.sender, claimed);
    }

    function simulateProtocolYield(address holder, uint256 amount) external {
        FixtureMUSD(address(asset)).mint(address(this), amount);
        claimableYield[holder] += amount;
    }

    function donateToSource(uint256 amount) external {
        FixtureMUSD(address(asset)).mint(address(this), amount);
    }

    function setWithdrawalBps(uint256 value) external {
        withdrawalBps = value;
    }
}

    contract YieldSeriesFactoryTest {
        Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

        function testCreatesAndRegistersSharedMarketForAllUsers() public {
            vm.chainId(31_611);
            FixtureMUSD asset = new FixtureMUSD();
            FixtureSavingsRate vault = new FixtureSavingsRate(address(asset));
            YieldSeriesFactory factory = new YieldSeriesFactory(address(asset), address(vault));
            uint64 maturity = uint64(block.timestamp + 30 days);

            (address exchangeAddress, address marketAddress) = factory.createSeries(maturity);
            (
                address[] memory exchanges,
                address[] memory markets,
                uint64[] memory maturities,
                address[] memory creators,
                uint256 total
            ) = factory.seriesPage(0, 25);

            require(total == 1 && factory.seriesCount() == 1, "one shared series");
            require(exchanges[0] == exchangeAddress, "registered exchange");
            require(markets[0] == marketAddress, "registered market");
            require(maturities[0] == maturity, "registered maturity");
            require(creators[0] == address(this), "creator recorded");
            require(
                address(YieldExchange(exchangeAddress).principalToken()) != address(0),
                "PT deployed"
            );
            require(
                address(YieldExchange(exchangeAddress).yieldToken()) != address(0), "YT deployed"
            );
            require(
                address(YieldMarket(marketAddress).principalToken())
                    == address(YieldExchange(exchangeAddress).principalToken()),
                "market uses shared PT"
            );
            require(factory.exchangeForMaturity(maturity) == exchangeAddress, "maturity lookup");
        }

        function testCannotCreateDuplicateMaturity() public {
            vm.chainId(31_611);
            FixtureMUSD asset = new FixtureMUSD();
            FixtureSavingsRate vault = new FixtureSavingsRate(address(asset));
            YieldSeriesFactory factory = new YieldSeriesFactory(address(asset), address(vault));
            uint64 maturity = uint64(block.timestamp + 30 days);

            factory.createSeries(maturity);
            vm.expectRevert();
            factory.createSeries(maturity);
        }

        function testSeriesPageRejectsUnboundedReads() public {
            vm.chainId(31_611);
            FixtureMUSD asset = new FixtureMUSD();
            FixtureSavingsRate vault = new FixtureSavingsRate(address(asset));
            YieldSeriesFactory factory = new YieldSeriesFactory(address(asset), address(vault));

            vm.expectRevert();
            factory.seriesPage(0, 51);
        }
    }

    contract YieldExchangeTest {
        Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

        FixtureMUSD private asset;
        FixtureSavingsRate private savingsVault;
        YieldExchange private exchange;

        function setUp() public {
            vm.chainId(31_611);
            asset = new FixtureMUSD();
            savingsVault = new FixtureSavingsRate(address(asset));
            exchange = new YieldExchange(
                address(asset), address(savingsVault), uint64(block.timestamp + 1 days)
            );
            asset.mint(address(this), 10_000 ether);
            asset.approve(address(exchange), type(uint256).max);
        }

        function testDepositMintsComplementaryClaimsAndCustodiesRealShares() public {
            exchange.deposit(100 ether, address(this));

            require(exchange.principalDeposited() == 100 ether, "principal accounting");
            require(
                PrincipalToken(address(exchange.principalToken())).balanceOf(address(this))
                    == 100 ether,
                "PT supply"
            );
            require(
                YieldToken(address(exchange.yieldToken())).balanceOf(address(this)) == 100 ether,
                "YT supply"
            );
            require(savingsVault.balanceOf(address(exchange)) == 100 ether, "source shares");
            require(asset.balanceOf(address(exchange)) == 0, "principal must stay in source");
        }

        function testPreviouslyAccruedYieldBelongsToExistingYTHolders() public {
            exchange.deposit(100 ether, address(this));
            savingsVault.simulateProtocolYield(address(exchange), 25 ether);

            exchange.deposit(50 ether, address(0xBEEF));

            YieldToken yt = exchange.yieldToken();
            require(
                yt.claimableYield(address(this)) == 25 ether, "existing holders receive prior yield"
            );
            require(
                yt.claimableYield(address(0xBEEF)) == 0, "new holders cannot capture prior yield"
            );
        }

        function testTransferCheckpointsYieldBeforeOwnershipMoves() public {
            exchange.deposit(100 ether, address(this));
            savingsVault.simulateProtocolYield(address(exchange), 10 ether);

            exchange.yieldToken().transfer(address(0xBEEF), 50 ether);

            require(
                exchange.yieldToken().claimableYield(address(this)) == 10 ether,
                "seller keeps pre-transfer yield"
            );
            require(
                exchange.yieldToken().claimableYield(address(0xBEEF)) == 0,
                "buyer starts at transfer checkpoint"
            );
        }

        function testMaturitySettlementAllocatesSourceLossToPTAndOnlyRealYieldToYT() public {
            exchange.deposit(100 ether, address(this));
            savingsVault.simulateProtocolYield(address(exchange), 10 ether);
            savingsVault.setWithdrawalBps(8_000);
            vm.warp(exchange.maturity());

            exchange.settle();

            require(exchange.principalClaim() == 80 ether, "PT claim is capped by recovered assets");
            require(
                exchange.yieldToken().claimableYield(address(this)) == 10 ether,
                "YT receives only realized yield"
            );
            require(exchange.yieldToken().claimYield() == 10 ether, "yield payout");
            require(
                exchange.redeemPrincipal(100 ether) == 80 ether,
                "principal loss is reflected in redemption"
            );
            require(asset.balanceOf(address(this)) == 9_990 ether, "no value is paid twice");
        }

        function testSettlementCapturesWithdrawalSurplusForYT() public {
            exchange.deposit(100 ether, address(this));
            savingsVault.donateToSource(5 ether);
            savingsVault.setWithdrawalBps(10_500);
            vm.warp(exchange.maturity());

            exchange.settle();

            require(exchange.principalClaim() == 100 ether, "PT stays capped at principal");
            require(
                exchange.yieldToken().claimableYield(address(this)) == 5 ether,
                "realized surplus accrues to YT"
            );
        }

        function testCannotSettleBeforeMaturity() public {
            exchange.deposit(1 ether, address(this));
            vm.expectRevert();
            exchange.settle();
        }

        function testConstantProductMarketSupportsLivePTQuotesAndSwaps() public {
            exchange.deposit(100 ether, address(this));
            YieldMarket market = new YieldMarket(address(exchange));
            PrincipalToken pt = exchange.principalToken();
            asset.approve(address(market), type(uint256).max);
            pt.approve(address(market), type(uint256).max);
            market.addLiquidity(address(pt), 100 ether, 100 ether, 1);

            uint256 quoted = market.quote(address(pt), address(asset), 1 ether);
            require(quoted > 0, "quote exists");
            uint256 received =
                market.swapExactIn(address(pt), address(asset), 1 ether, quoted, address(this));
            require(received == quoted, "swap respects min output");
            require(pt.balanceOf(address(this)) == received, "PT output delivered");
        }

        function testYTMarketYieldIsDistributedAndClaimedByLPShares() public {
            exchange.deposit(100 ether, address(this));
            YieldMarket market = new YieldMarket(address(exchange));
            YieldToken yt = exchange.yieldToken();
            asset.mint(address(this), 100 ether);
            asset.approve(address(market), type(uint256).max);
            yt.approve(address(market), type(uint256).max);
            market.addLiquidity(address(yt), 100 ether, 100 ether, 1);

            savingsVault.simulateProtocolYield(address(exchange), 20 ether);
            require(
                market.claimableLiquidityYield(address(yt), address(this)) == 0,
                "unharvested pool yield is not reported as claimable"
            );
            uint256 balanceBefore = asset.balanceOf(address(this));
            uint256 claimed = market.claimLiquidityYield(address(yt));

            require(claimed >= 20 ether - 1_000, "LP receives its pro-rata YT yield");
            require(asset.balanceOf(address(this)) == balanceBefore + claimed, "MUSD paid to LP");
            require(
                market.claimableLiquidityYield(address(yt), address(this)) == 0,
                "claim clears accrued yield"
            );
        }

        function testNewLiquidityProviderCannotCaptureEarlierPoolYield() public {
            exchange.deposit(100 ether, address(this));
            YieldMarket market = new YieldMarket(address(exchange));
            YieldToken yt = exchange.yieldToken();
            asset.mint(address(this), 100 ether);
            asset.approve(address(market), type(uint256).max);
            yt.approve(address(market), type(uint256).max);
            market.addLiquidity(address(yt), 100 ether, 100 ether, 1);

            address newProvider = address(0xBEEF);
            asset.mint(newProvider, 100 ether);
            vm.prank(newProvider);
            asset.approve(address(exchange), 50 ether);
            vm.prank(newProvider);
            exchange.deposit(50 ether, newProvider);
            asset.mint(newProvider, 50 ether);
            vm.prank(newProvider);
            asset.approve(address(market), 50 ether);
            vm.prank(newProvider);
            yt.approve(address(market), 50 ether);

            savingsVault.simulateProtocolYield(address(exchange), 10 ether);
            vm.prank(newProvider);
            market.addLiquidity(address(yt), 50 ether, 50 ether, 1);

            require(
                market.claimableLiquidityYield(address(yt), address(this)) > 0,
                "existing LP receives yield earned before the new deposit"
            );
            require(
                market.claimableLiquidityYield(address(yt), newProvider) == 0,
                "new LP cannot capture prior pool yield"
            );
        }

        function testLPKeepsAccruedYieldAfterRemovingLiquidity() public {
            exchange.deposit(100 ether, address(this));
            YieldMarket market = new YieldMarket(address(exchange));
            YieldToken yt = exchange.yieldToken();
            asset.mint(address(this), 100 ether);
            asset.approve(address(market), type(uint256).max);
            yt.approve(address(market), type(uint256).max);
            market.addLiquidity(address(yt), 100 ether, 100 ether, 1);

            savingsVault.simulateProtocolYield(address(exchange), 5 ether);
            uint256 shares = market.liquidityOf(address(yt), address(this));
            market.removeLiquidity(address(yt), shares, 0, 0);
            uint256 accrued = market.claimableLiquidityYield(address(yt), address(this));
            require(accrued >= 5 ether - 1_000, "earned yield remains claimable after exit");
            require(market.claimLiquidityYield(address(yt)) == accrued, "exited LP can claim");
        }

        function testPTPoolDoesNotHaveProtocolYieldClaims() public {
            exchange.deposit(100 ether, address(this));
            YieldMarket market = new YieldMarket(address(exchange));
            PrincipalToken pt = exchange.principalToken();
            require(
                market.claimableLiquidityYield(address(pt), address(this)) == 0,
                "PT pool has no protocol-yield rewards"
            );
            vm.expectRevert();
            market.claimLiquidityYield(address(pt));
        }

        function testUndistributedYieldRoundingCarriesToExistingHolders() public {
            exchange.deposit(3, address(this));
            YieldToken yt = exchange.yieldToken();

            savingsVault.simulateProtocolYield(address(exchange), 1);
            exchange.harvestYield();
            require(yt.claimableYield(address(this)) == 0, "fractional index is not claimable yet");
            require(yt.undistributedYield() == 1, "unallocated wei is retained");

            savingsVault.simulateProtocolYield(address(exchange), 2);
            exchange.harvestYield();
            require(yt.claimableYield(address(this)) == 3, "carried rounding dust reaches holders");
            require(yt.undistributedYield() == 0, "carried amount is cleared");
            require(yt.claimYield() == 3, "all accumulated yield can be claimed");
        }

        function testFuzzSettlementNeverOverpaysSourceRecovery(
            uint64 principalTokens,
            uint64 yieldTokens,
            uint16 withdrawalBpsInput
        ) public {
            uint256 principal =
                (uint256(principalTokens) % 1_000 + 1) * 1 ether;
            uint256 yieldAmount = (uint256(yieldTokens) % 1_001) * 1 ether;
            uint256 withdrawalBps = uint256(withdrawalBpsInput) % 10_001;

            exchange.deposit(principal, address(this));
            if (yieldAmount > 0) savingsVault.simulateProtocolYield(address(exchange), yieldAmount);
            savingsVault.setWithdrawalBps(withdrawalBps);
            vm.warp(exchange.maturity());
            exchange.settle();

            uint256 principalPaid = exchange.redeemPrincipal(principal);
            uint256 yieldPaid = exchange.yieldToken().claimYield();
            uint256 principalRecovered = (principal * withdrawalBps) / 10_000;
            uint256 totalRecovered = principalRecovered + yieldAmount;
            uint256 roundingBound = (principal / 1 ether) + 1;

            require(principalPaid == principalRecovered, "PT payout matches recovered principal");
            require(yieldPaid <= yieldAmount, "YT cannot claim more than realized yield");
            require(principalPaid + yieldPaid <= totalRecovered, "claims cannot exceed recovery");
            require(
                totalRecovered - (principalPaid + yieldPaid) <= roundingBound,
                "rounding loss is bounded"
            );
        }

        function testSwapRevertsWhenMinimumOutputIsNotMet() public {
            exchange.deposit(100 ether, address(this));
            YieldMarket market = new YieldMarket(address(exchange));
            PrincipalToken pt = exchange.principalToken();
            asset.approve(address(market), type(uint256).max);
            pt.approve(address(market), type(uint256).max);
            market.addLiquidity(address(pt), 100 ether, 100 ether, 1);

            uint256 quote = market.quote(address(pt), address(asset), 1 ether);
            vm.expectRevert();
            market.swapExactIn(address(pt), address(asset), 1 ether, quote + 1, address(this));
        }

        function testMarketRejectsEmptyPoolsAndUnsupportedPairs() public {
            YieldMarket market = new YieldMarket(address(exchange));
            PrincipalToken pt = exchange.principalToken();

            require(
                market.quote(address(pt), address(asset), 1 ether) == 0, "empty pool has no quote"
            );
            vm.expectRevert();
            market.quote(address(0xBEEF), address(asset), 1 ether);
            vm.expectRevert();
            market.addLiquidity(address(pt), 0, 1 ether, 1);
            vm.expectRevert();
            market.addLiquidity(address(pt), 1, 1, 1);
            vm.expectRevert();
            market.removeLiquidity(address(pt), 1, 0, 0);
            vm.expectRevert();
            market.swapExactIn(address(pt), address(asset), 1 ether, 0, address(this));
        }

        function testMarketSwapRejectsUnsupportedInputAndZeroRecipient() public {
            exchange.deposit(100 ether, address(this));
            YieldMarket market = new YieldMarket(address(exchange));
            PrincipalToken pt = exchange.principalToken();
            asset.approve(address(market), type(uint256).max);
            pt.approve(address(market), type(uint256).max);
            market.addLiquidity(address(pt), 100 ether, 100 ether, 1);

            vm.expectRevert();
            market.swapExactIn(address(pt), address(0xBEEF), 1 ether, 0, address(this));
            vm.expectRevert();
            market.swapExactIn(address(pt), address(asset), 1 ether, 0, address(0));
            vm.expectRevert();
            market.swapExactIn(address(pt), address(asset), 0, 0, address(this));
        }

        function testLiquidityRemovalHonorsMinimumOutputs() public {
            exchange.deposit(100 ether, address(this));
            YieldMarket market = new YieldMarket(address(exchange));
            PrincipalToken pt = exchange.principalToken();
            asset.approve(address(market), type(uint256).max);
            pt.approve(address(market), type(uint256).max);
            market.addLiquidity(address(pt), 100 ether, 100 ether, 1);

            uint256 shares = market.liquidityOf(address(pt), address(this));
            (uint112 reserveAsset, uint112 reserveToken, uint256 totalLiquidity) =
                market.pool(address(pt));
            uint256 expectedAssetOut = (shares * reserveAsset) / totalLiquidity;
            uint256 expectedTokenOut = (shares * reserveToken) / totalLiquidity;

            vm.expectRevert();
            market.removeLiquidity(address(pt), shares, 0, expectedTokenOut + 1);
            (uint256 assetOut, uint256 tokenOut) =
                market.removeLiquidity(address(pt), shares, expectedAssetOut, expectedTokenOut);
            require(assetOut == expectedAssetOut, "asset minimum enforced");
            require(tokenOut == expectedTokenOut, "token minimum enforced");
            require(market.liquidityOf(address(pt), address(this)) == 0, "position cleared");
        }
    }
