// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMUSDSavingsRate} from "./interfaces/IMUSDSavingsRate.sol";
import {PrincipalToken} from "./PrincipalToken.sol";
import {YieldToken} from "./YieldToken.sol";

/// @notice One-maturity PT/YT series backed by Mezo's live MUSD Savings Rate vault.
/// @dev Testnet-only. PT bears source principal loss; YT receives realized MUSD yield.
contract YieldExchange is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TARGET_CHAIN_ID = 31_611;
    uint256 private constant MAX_HARVEST_ROUNDS = 16;

    IERC20 public immutable asset;
    IMUSDSavingsRate public immutable savingsVault;
    PrincipalToken public immutable principalToken;
    YieldToken public immutable yieldToken;
    uint64 public immutable maturity;
    uint256 public principalDeposited;
    uint256 public principalClaim;
    uint256 public unclaimedPrincipal;
    uint256 public yieldReserve;
    bool public settled;

    error WrongChain(uint256 actualChainId);
    error InvalidConfiguration();
    error InvalidMaturity();
    error ZeroAmount();
    error InvalidReceiver();
    error NotMature();
    error MarketMatured();
    error AlreadySettled();
    error NotSettled();
    error UnsupportedAsset();
    error UnexpectedShareAmount(uint256 expected, uint256 received);
    error YieldClaimStalled();
    error YieldBacklog();
    error NotYieldToken();

    event Deposited(address indexed caller, address indexed receiver, uint256 assets);
    event YieldHarvested(uint256 amount, uint256 newReserve);
    event Settled(uint256 requestedPrincipal, uint256 principalRecovered, uint256 yieldSurplus);
    event PrincipalRedeemed(address indexed account, uint256 tokensBurned, uint256 assetsPaid);
    event YieldPaid(address indexed receiver, uint256 amount);

    constructor(address asset_, address savingsVault_, uint64 maturity_) {
        if (block.chainid != TARGET_CHAIN_ID) revert WrongChain(block.chainid);
        if (asset_ == address(0) || savingsVault_ == address(0) || asset_.code.length == 0 || savingsVault_.code.length == 0) {
            revert InvalidConfiguration();
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (maturity_ <= block.timestamp) revert InvalidMaturity();

        IERC20Metadata assetMetadata = IERC20Metadata(asset_);
        IMUSDSavingsRate vault = IMUSDSavingsRate(savingsVault_);
        if (
            vault.musdToken() != asset_
                || assetMetadata.decimals() != 18
                || IERC20Metadata(savingsVault_).decimals() != 18
        ) revert UnsupportedAsset();

        asset = IERC20(asset_);
        savingsVault = vault;
        maturity = maturity_;
        principalToken = new PrincipalToken(address(this), "MUSD Principal Token", "PT-MUSD");
        yieldToken = new YieldToken(address(this), "MUSD Yield Token", "YT-MUSD");
    }

    function deposit(uint256 assets, address receiver) external nonReentrant {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= maturity) revert MarketMatured();
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidReceiver();

        _harvestFully();

        uint256 assetBalanceBefore = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), assets);
        if (asset.balanceOf(address(this)) - assetBalanceBefore != assets) revert UnsupportedAsset();

        asset.forceApprove(address(savingsVault), assets);
        uint256 sharesBefore = savingsVault.balanceOf(address(this));
        savingsVault.deposit(assets);
        asset.forceApprove(address(savingsVault), 0);
        uint256 sharesReceived = savingsVault.balanceOf(address(this)) - sharesBefore;
        if (sharesReceived != assets) revert UnexpectedShareAmount(assets, sharesReceived);

        principalDeposited += assets;
        principalToken.mint(receiver, assets);
        yieldToken.mint(receiver, assets);
        emit Deposited(msg.sender, receiver, assets);
    }

    /// @notice Harvests one source claim. Repeat while the source reports a remaining balance.
    function harvestYield() external nonReentrant returns (uint256 harvested) {
        harvested = _harvestOne();
    }

    /// @notice Finalizes the only series after maturity and makes PT/YT claims redeemable.
    function settle() external nonReentrant {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < maturity) revert NotMature();
        if (settled) revert AlreadySettled();

        _harvestFully();
        uint256 shares = savingsVault.balanceOf(address(this));
        uint256 assetBalanceBefore = asset.balanceOf(address(this));
        if (shares > 0) savingsVault.withdraw(shares);
        uint256 recovered = asset.balanceOf(address(this)) - assetBalanceBefore;

        principalClaim = recovered < principalDeposited ? recovered : principalDeposited;
        unclaimedPrincipal = principalClaim;
        uint256 surplus = recovered - principalClaim;
        if (surplus > 0) _distributeYield(surplus);
        settled = true;

        emit Settled(principalDeposited, principalClaim, surplus);
    }

    function redeemPrincipal(uint256 amount) external nonReentrant returns (uint256 assetsOut) {
        if (!settled) revert NotSettled();
        if (amount == 0) revert ZeroAmount();

        uint256 supply = principalToken.totalSupply();
        if (amount > principalToken.balanceOf(msg.sender)) revert ZeroAmount();
        assetsOut = amount == supply
            ? unclaimedPrincipal
            : (principalClaim * amount) / principalDeposited;
        principalToken.burn(msg.sender, amount);
        unclaimedPrincipal -= assetsOut;
        if (assetsOut > 0) asset.safeTransfer(msg.sender, assetsOut);
        emit PrincipalRedeemed(msg.sender, amount, assetsOut);
    }

    /// @notice Called only by the YT contract after it checkpoints a holder's index.
    function payYield(address receiver, uint256 amount) external nonReentrant {
        if (msg.sender != address(yieldToken)) revert NotYieldToken();
        if (amount == 0 || receiver == address(0) || amount > yieldReserve) revert ZeroAmount();
        yieldReserve -= amount;
        asset.safeTransfer(receiver, amount);
        emit YieldPaid(receiver, amount);
    }

    /// @notice Called by YT before transfers and claims to prevent uncheckpointed yield moving.
    function checkpointYield() external nonReentrant {
        if (msg.sender != address(yieldToken)) revert NotYieldToken();
        _harvestFully();
    }

    function _harvestFully() private {
        for (uint256 i; i < MAX_HARVEST_ROUNDS; ++i) {
            if (savingsVault.balanceOf(address(this)) == 0) return;
            if (savingsVault.claimableYield(address(this)) == 0) return;
            if (_harvestOne() == 0) revert YieldClaimStalled();
        }
        if (savingsVault.claimableYield(address(this)) != 0) revert YieldBacklog();
    }

    function _harvestOne() private returns (uint256 amount) {
        if (savingsVault.balanceOf(address(this)) == 0) return 0;
        if (savingsVault.claimableYield(address(this)) == 0) return 0;

        uint256 beforeBalance = asset.balanceOf(address(this));
        savingsVault.claimYield();
        amount = asset.balanceOf(address(this)) - beforeBalance;
        if (amount == 0) revert YieldClaimStalled();
        _distributeYield(amount);
        emit YieldHarvested(amount, yieldReserve);
    }

    function _distributeYield(uint256 amount) private {
        yieldReserve += amount;
        yieldToken.distributeYield(amount);
    }
}
