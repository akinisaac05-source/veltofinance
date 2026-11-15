// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVeMezo, IVeMezoRewardsDistributor} from "../src/interfaces/IVeMezo.sol";
import {VeMezoYieldFactory} from "../src/VeMezoYieldFactory.sol";
import {VeMezoYieldSeries} from "../src/VeMezoYieldSeries.sol";
import {VeMezoMarket} from "../src/VeMezoMarket.sol";
import {VeMezoYieldToken} from "../src/VeMezoYieldToken.sol";
import {PrincipalToken} from "../src/PrincipalToken.sol";

interface Vm {
    function chainId(uint256 newChainId) external;
    function warp(uint256 newTimestamp) external;
    function prank(address sender) external;
    function expectRevert() external;
}

contract FixtureMEZO is ERC20 {
    constructor() ERC20("Fixture MEZO", "fMEZO") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FixtureVeMezo {
    struct Lock {
        int128 amount;
        uint256 end;
        bool isPermanent;
    }
    IERC20Like public immutable token;
    address public distributor;
    mapping(uint256 => Lock) private locks;
    mapping(uint256 => address) private owners;
    mapping(uint256 => address) private approvals;
    mapping(uint256 => uint8) public escrowType;
    mapping(address => uint256) private ownerBalances;

    constructor(address token_) {
        token = IERC20Like(token_);
    }

    function setDistributor(address distributor_) external {
        distributor = distributor_;
    }

    function mintLock(address to, uint256 id, uint256 amount, uint256 end) external {
        token.mint(address(this), amount);
        locks[id] = Lock(int128(uint128(amount)), end, false);
        owners[id] = to;
        ownerBalances[to] += 1;
    }

    function ownerOf(uint256 id) public view returns (address) {
        address owner = owners[id];
        require(owner != address(0), "nonexistent");
        return owner;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return ownerBalances[owner];
    }

    function approve(address spender, uint256 id) external {
        require(ownerOf(id) == msg.sender, "not owner");
        approvals[id] = spender;
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        safeTransferFrom(from, to, id, "");
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes memory data) public {
        require(
            ownerOf(id) == from && (msg.sender == from || approvals[id] == msg.sender),
            "not approved"
        );
        require(to != address(0), "zero receiver");
        delete approvals[id];
        owners[id] = to;
        ownerBalances[from] -= 1;
        ownerBalances[to] += 1;
        if (to.code.length != 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, id, data)
                    == IERC721Receiver.onERC721Received.selector,
                "receiver rejected"
            );
        }
    }

    function transferFrom(address from, address to, uint256 id) external {
        require(
            ownerOf(id) == from && (msg.sender == from || approvals[id] == msg.sender),
            "not approved"
        );
        delete approvals[id];
        owners[id] = to;
        ownerBalances[from] -= 1;
        ownerBalances[to] += 1;
    }

    function locked(uint256 id) external view returns (IVeMezo.LockedBalance memory) {
        Lock memory value = locks[id];
        return IVeMezo.LockedBalance(value.amount, value.end, value.isPermanent);
    }

    function depositFor(uint256 id, uint256 amount) external {
        require(msg.sender == distributor, "only distributor");
        token.transferFrom(msg.sender, address(this), amount);
        locks[id].amount += int128(uint128(amount));
    }

    function withdraw(uint256 id) external {
        require(ownerOf(id) == msg.sender, "not owner");
        require(block.timestamp >= locks[id].end, "not expired");
        uint256 amount = uint256(uint128(locks[id].amount));
        delete locks[id];
        owners[id] = address(0);
        ownerBalances[msg.sender] -= 1;
        token.transfer(msg.sender, amount);
    }
}

interface IERC20Like {
    function mint(address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract FixtureRewardsDistributor {
    using SafeERC20 for IERC20;
    IVeMezo public immutable ve;
    IERC20 public immutable token;
    uint256 public lastTokenTime;
    mapping(uint256 => uint256) public claimable;

    constructor(address ve_, address token_) {
        ve = IVeMezo(ve_);
        token = IERC20(token_);
        token.approve(ve_, type(uint256).max);
    }

    function advanceLastTokenTime(uint256 timestamp) external {
        lastTokenTime = timestamp;
    }

    function queue(uint256 id, uint256 amount) external {
        FixtureMEZO(address(token)).mint(address(this), amount);
        claimable[id] += amount;
    }

    function claim(uint256 id) external returns (uint256 amount) {
        amount = claimable[id];
        claimable[id] = 0;
        if (amount == 0) return 0;
        IVeMezo.LockedBalance memory position = ve.locked(id);
        if (block.timestamp >= position.end) token.safeTransfer(ve.ownerOf(id), amount);
        else ve.depositFor(id, amount);
    }
}

contract VeMezoYieldSeriesTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    FixtureMEZO private mezo;
    FixtureVeMezo private ve;
    FixtureRewardsDistributor private distributor;
    VeMezoYieldFactory private factory;
    VeMezoYieldSeries private series;
    uint256 private constant TOKEN_ID = 42;
    uint256 private maturity;

    function setUp() public {
        vm.chainId(31_611);
        mezo = new FixtureMEZO();
        ve = new FixtureVeMezo(address(mezo));
        distributor = new FixtureRewardsDistributor(address(ve), address(mezo));
        ve.setDistributor(address(distributor));
        factory = new VeMezoYieldFactory(address(ve), address(distributor), address(mezo));
        maturity = block.timestamp + 14 days;
        ve.mintLock(address(this), TOKEN_ID, 100 ether, maturity);
        address tranche;
        (tranche,) = factory.createSeries(TOKEN_ID);
        series = VeMezoYieldSeries(tranche);
    }

    function testDepositCheckpointSettlementAndBothRedemptions() public {
        ve.approve(address(series), TOKEN_ID);
        series.deposit(address(this));
        require(series.deposited(), "NFT escrowed");
        require(ve.ownerOf(TOKEN_ID) == address(series), "series owns NFT");
        require(series.principalDeposited() == 100 ether, "original amount is principal");

        distributor.queue(TOKEN_ID, 10 ether);
        require(series.checkpointRebase() == 10 ether, "rebase checkpointed");
        require(series.yieldToken().claimableYield(address(this)) == 10 ether, "YT tracks rebase");
        require(
            series.principalToken().balanceOf(address(this)) == 100 ether,
            "rebase does not change PT"
        );

        vm.warp(maturity);
        vm.expectRevert();
        series.settle();

        vm.warp(maturity + 7 days);
        distributor.queue(TOKEN_ID, 5 ether);
        vm.expectRevert();
        series.settle();
        distributor.advanceLastTokenTime(maturity);
        series.settle();
        require(series.settled(), "series settled");
        require(series.principalClaim() == 100 ether, "PT claim remains original MEZO");
        require(series.yieldReserve() == 15 ether, "YT backed by all rebase MEZO");

        require(series.redeemPrincipal(100 ether) == 100 ether, "PT redeemed");
        require(series.yieldToken().claimYield() == 15 ether, "YT redeemed");
        require(mezo.balanceOf(address(this)) == 115 ether, "no double payment");
        require(ve.balanceOf(address(series)) == 0, "expired NFT burned on withdrawal");
    }

    function testHistoricalRebaseStaysWithSellerWhenYTTransfers() public {
        ve.approve(address(series), TOKEN_ID);
        series.deposit(address(this));
        distributor.queue(TOKEN_ID, 10 ether);
        series.checkpointRebase();

        VeMezoYieldToken yt = series.yieldToken();
        yt.transfer(address(0xBEEF), 50 ether);
        require(yt.claimableYield(address(this)) == 10 ether, "seller keeps accrued rebase");
        require(yt.claimableYield(address(0xBEEF)) == 0, "buyer starts after checkpoint");
    }

    function testFactoryCreatesExpirySpecificMEZOMarket() public view {
        address market = factory.marketForTokenId(TOKEN_ID);
        require(market != address(0), "market registered");
        VeMezoMarket deployedMarket = VeMezoMarket(market);
        require(address(deployedMarket.asset()) == address(mezo), "MEZO is quote asset");
        (,, uint256 supply) = deployedMarket.pool(address(series.yieldToken()));
        require(supply == 0, "YT pool starts empty");
    }

    function testYtPoolAccruesRebasesForItsLpAndAddsPayoutToMezoReserves() public {
        ve.approve(address(series), TOKEN_ID);
        series.deposit(address(this));
        mezo.mint(address(this), 51 ether);

        VeMezoMarket market = VeMezoMarket(factory.marketForTokenId(TOKEN_ID));
        VeMezoYieldToken yt = series.yieldToken();
        mezo.approve(address(market), type(uint256).max);
        yt.approve(address(market), type(uint256).max);
        market.addLiquidity(address(yt), 50 ether, 50 ether, 1);

        distributor.queue(TOKEN_ID, 10 ether);
        series.checkpointRebase();
        uint256 quote = market.quote(address(yt), address(mezo), 1 ether);
        market.swapExactIn(address(yt), address(mezo), 1 ether, quote, address(this));
        require(
            yt.claimableYield(address(market)) == 5 ether, "YT LP owns its accrued rebase share"
        );

        vm.warp(maturity + 7 days);
        distributor.advanceLastTokenTime(maturity);
        series.settle();
        uint256 shares = market.liquidityOf(address(yt), address(this));
        uint256 balanceBefore = mezo.balanceOf(address(this));
        market.removeLiquidity(address(yt), shares, 0, 0);
        require(
            mezo.balanceOf(address(this)) > balanceBefore + 54 ether,
            "YT LP receives reserve plus yield"
        );
        require(yt.claimableYield(address(market)) == 0, "market yield is paid into MEZO reserves");
    }

    function testCannotDepositWrongNFTOrCreateDuplicateSeries() public {
        vm.expectRevert();
        series.deposit(address(this));
        vm.expectRevert();
        factory.createSeries(TOKEN_ID);
    }
}
