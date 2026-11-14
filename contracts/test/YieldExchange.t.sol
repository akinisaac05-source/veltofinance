// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMUSDSavingsRate} from "../src/interfaces/IMUSDSavingsRate.sol";
import {YieldExchange} from "../src/YieldExchange.sol";
import {YieldMarket} from "../src/YieldMarket.sol";
import {PrincipalToken} from "../src/PrincipalToken.sol";
import {YieldToken} from "../src/YieldToken.sol";

interface Vm {
    function chainId(uint256 newChainId) external;
    function warp(uint256 newTimestamp) external;
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

contract YieldExchangeTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    FixtureMUSD private asset;
    FixtureSavingsRate private savingsVault;
    YieldExchange private exchange;

    function setUp() public {
        vm.chainId(31_611);
        asset = new FixtureMUSD();
        savingsVault = new FixtureSavingsRate(address(asset));
        exchange = new YieldExchange(address(asset), address(savingsVault), uint64(block.timestamp + 1 days));
        asset.mint(address(this), 10_000 ether);
        asset.approve(address(exchange), type(uint256).max);
    }

    function testDepositMintsComplementaryClaimsAndCustodiesRealShares() public {
        exchange.deposit(100 ether, address(this));

        require(exchange.principalDeposited() == 100 ether, "principal accounting");
        require(PrincipalToken(address(exchange.principalToken())).balanceOf(address(this)) == 100 ether, "PT supply");
        require(YieldToken(address(exchange.yieldToken())).balanceOf(address(this)) == 100 ether, "YT supply");
        require(savingsVault.balanceOf(address(exchange)) == 100 ether, "source shares");
        require(asset.balanceOf(address(exchange)) == 0, "principal must stay in source");
    }

    function testPreviouslyAccruedYieldBelongsToExistingYTHolders() public {
        exchange.deposit(100 ether, address(this));
        savingsVault.simulateProtocolYield(address(exchange), 25 ether);

        exchange.deposit(50 ether, address(0xBEEF));

        YieldToken yt = exchange.yieldToken();
        require(yt.claimableYield(address(this)) == 25 ether, "existing holders receive prior yield");
        require(yt.claimableYield(address(0xBEEF)) == 0, "new holders cannot capture prior yield");
    }

    function testTransferCheckpointsYieldBeforeOwnershipMoves() public {
        exchange.deposit(100 ether, address(this));
        savingsVault.simulateProtocolYield(address(exchange), 10 ether);

        exchange.yieldToken().transfer(address(0xBEEF), 50 ether);

        require(exchange.yieldToken().claimableYield(address(this)) == 10 ether, "seller keeps pre-transfer yield");
        require(exchange.yieldToken().claimableYield(address(0xBEEF)) == 0, "buyer starts at transfer checkpoint");
    }

    function testMaturitySettlementAllocatesSourceLossToPTAndOnlyRealYieldToYT() public {
        exchange.deposit(100 ether, address(this));
        savingsVault.simulateProtocolYield(address(exchange), 10 ether);
        savingsVault.setWithdrawalBps(8_000);
        vm.warp(exchange.maturity());

        exchange.settle();

        require(exchange.principalClaim() == 80 ether, "PT claim is capped by recovered assets");
        require(exchange.yieldToken().claimableYield(address(this)) == 10 ether, "YT receives only realized yield");
        require(exchange.yieldToken().claimYield() == 10 ether, "yield payout");
        require(exchange.redeemPrincipal(100 ether) == 80 ether, "principal loss is reflected in redemption");
        require(asset.balanceOf(address(this)) == 9_990 ether, "no value is paid twice");
    }

    function testSettlementCapturesWithdrawalSurplusForYT() public {
        exchange.deposit(100 ether, address(this));
        savingsVault.donateToSource(5 ether);
        savingsVault.setWithdrawalBps(10_500);
        vm.warp(exchange.maturity());

        exchange.settle();

        require(exchange.principalClaim() == 100 ether, "PT stays capped at principal");
        require(exchange.yieldToken().claimableYield(address(this)) == 5 ether, "realized surplus accrues to YT");
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
        uint256 received = market.swapExactIn(address(pt), address(asset), 1 ether, quoted, address(this));
        require(received == quoted, "swap respects min output");
        require(pt.balanceOf(address(this)) == received, "PT output delivered");
    }
}
