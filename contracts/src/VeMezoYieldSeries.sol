// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PrincipalToken} from "./PrincipalToken.sol";
import {VeMezoYieldToken} from "./VeMezoYieldToken.sol";
import {IVeMezo, IVeMezoRewardsDistributor} from "./interfaces/IVeMezo.sol";

/// @notice Testnet-only single-veNFT PT/YT tranche. The NFT is consumed at expiry and MEZO is redeemed.
contract VeMezoYieldSeries is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TARGET_CHAIN_ID = 31_611;
    uint256 private constant MAX_REBASE_CLAIM_ROUNDS = 5;
    uint256 private constant SETTLEMENT_DELAY = 7 days;

    IVeMezo public immutable veMezo;
    IVeMezoRewardsDistributor public immutable rewardsDistributor;
    IERC20 public immutable mezo;
    uint256 public immutable tokenId;
    uint64 public immutable maturity;
    PrincipalToken public immutable principalToken;
    VeMezoYieldToken public immutable yieldToken;

    address public depositor;
    uint256 public principalDeposited;
    uint256 public principalClaim;
    uint256 public unclaimedPrincipal;
    uint256 public yieldReserve;
    uint256 public totalRebaseClaimed;
    bool public deposited;
    bool public settled;
    bool private receivingVeNft;

    error WrongChain(uint256 actualChainId);
    error InvalidConfiguration();
    error InvalidPosition();
    error NotDepositor();
    error NotMature();
    error NotSettled();
    error AlreadySettled();
    error InvalidReceiver();
    error ZeroAmount();
    error RebaseClaimStalled();
    error RebaseBacklog();
    error NotYieldToken();

    event Deposited(
        address indexed caller, address indexed receiver, uint256 indexed tokenId, uint256 principal
    );
    event RebaseCheckpointed(uint256 indexed tokenId, uint256 amount, uint256 totalClaimed);
    event Settled(uint256 principal, uint256 recovered, uint256 yieldReserve);
    event PrincipalRedeemed(address indexed account, uint256 tokensBurned, uint256 mezoPaid);
    event YieldPaid(address indexed receiver, uint256 amount);

    constructor(
        address veMezo_,
        address distributor_,
        address mezo_,
        uint256 tokenId_,
        uint64 maturity_
    ) {
        if (block.chainid != TARGET_CHAIN_ID) revert WrongChain(block.chainid);
        if (
            veMezo_ == address(0) || distributor_ == address(0) || mezo_ == address(0)
                || veMezo_.code.length == 0 || distributor_.code.length == 0
                || mezo_.code.length == 0 || IVeMezo(veMezo_).token() != mezo_
                || IVeMezo(veMezo_).distributor() != distributor_
                || IVeMezoRewardsDistributor(distributor_).ve() != veMezo_
                || IVeMezoRewardsDistributor(distributor_).token() != mezo_
                || maturity_ <= block.timestamp
        ) revert InvalidConfiguration();

        veMezo = IVeMezo(veMezo_);
        rewardsDistributor = IVeMezoRewardsDistributor(distributor_);
        mezo = IERC20(mezo_);
        tokenId = tokenId_;
        maturity = maturity_;
        principalToken = new PrincipalToken(address(this), "MEZO Principal Token", "PT-veMEZO");
        yieldToken = new VeMezoYieldToken(address(this));
    }

    /// @notice Escrows the configured normal veMEZO NFT and mints equal principal/yield units.
    /// @dev Existing unclaimed rebases are claimed before YT minting and become PT principal.
    function deposit(address receiver) external nonReentrant {
        if (deposited || block.timestamp >= maturity || receiver == address(0)) {
            revert InvalidPosition();
        }
        if (veMezo.ownerOf(tokenId) != msg.sender) revert NotDepositor();

        IVeMezo.LockedBalance memory beforeClaim = veMezo.locked(tokenId);
        if (
            beforeClaim.amount <= 0 || beforeClaim.end != maturity || beforeClaim.isPermanent
                || veMezo.escrowType(tokenId) != 0
        ) revert InvalidPosition();

        _claimRebases(false);
        IVeMezo.LockedBalance memory locked = veMezo.locked(tokenId);
        if (locked.amount <= 0 || locked.end != maturity || locked.isPermanent) {
            revert InvalidPosition();
        }
        uint256 principal = uint256(uint128(locked.amount));

        receivingVeNft = true;
        veMezo.safeTransferFrom(msg.sender, address(this), tokenId);
        receivingVeNft = false;
        if (veMezo.ownerOf(tokenId) != address(this)) revert InvalidPosition();

        deposited = true;
        depositor = msg.sender;
        principalDeposited = principal;
        principalToken.mint(receiver, principal);
        yieldToken.mint(receiver, principal);
        emit Deposited(msg.sender, receiver, tokenId, principal);
    }

    function onERC721Received(address, address, uint256 receivedTokenId, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (msg.sender != address(veMezo) || !receivingVeNft || receivedTokenId != tokenId) {
            revert InvalidPosition();
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Permissionlessly checkpoints eligible weekly rebase rewards for the current YT holders.
    function checkpointRebase() external nonReentrant returns (uint256) {
        if (!deposited || settled) revert InvalidPosition();
        return _claimRebases(true);
    }

    /// @notice Called by YT before transfers and claims so historical rewards stay with prior holders.
    function checkpointYield() external nonReentrant {
        if (msg.sender != address(yieldToken)) revert NotYieldToken();
        if (deposited && !settled) _claimRebases(true);
    }

    /// @notice Claims final rebases and withdraws the expired NFT's MEZO principal and rebase additions.
    /// @dev Waits one weekly epoch after expiry so the latest distributor epoch can be checkpointed.
    function settle() external nonReentrant {
        if (!deposited) revert InvalidPosition();
        if (settled) revert AlreadySettled();
        if (block.timestamp < uint256(maturity) + SETTLEMENT_DELAY) revert NotMature();
        if (rewardsDistributor.lastTokenTime() < maturity) revert RebaseBacklog();

        uint256 beforeBalance = mezo.balanceOf(address(this));
        _claimRebases(true);
        if (rewardsDistributor.claimable(tokenId) != 0) revert RebaseBacklog();
        veMezo.withdraw(tokenId);
        uint256 recovered = mezo.balanceOf(address(this)) - beforeBalance;

        principalClaim = Math.min(recovered, principalDeposited);
        unclaimedPrincipal = principalClaim;
        yieldReserve = recovered - principalClaim;
        settled = true;
        emit Settled(principalDeposited, recovered, yieldReserve);
    }

    function redeemPrincipal(uint256 amount) external nonReentrant returns (uint256 mezoOut) {
        if (!settled) revert NotSettled();
        if (amount == 0 || amount > principalToken.balanceOf(msg.sender)) revert ZeroAmount();
        uint256 supply = principalToken.totalSupply();
        mezoOut = amount == supply
            ? unclaimedPrincipal
            : Math.mulDiv(principalClaim, amount, principalDeposited);
        principalToken.burn(msg.sender, amount);
        unclaimedPrincipal -= mezoOut;
        if (mezoOut > 0) mezo.safeTransfer(msg.sender, mezoOut);
        emit PrincipalRedeemed(msg.sender, amount, mezoOut);
    }

    function payYield(address receiver, uint256 amount) external nonReentrant {
        if (msg.sender != address(yieldToken)) revert NotYieldToken();
        if (!settled) revert NotSettled();
        if (amount == 0 || receiver == address(0) || amount > yieldReserve) revert ZeroAmount();
        yieldReserve -= amount;
        mezo.safeTransfer(receiver, amount);
        emit YieldPaid(receiver, amount);
    }

    function _claimRebases(bool distribute) private returns (uint256 totalClaimed) {
        for (uint256 i; i < MAX_REBASE_CLAIM_ROUNDS; ++i) {
            if (rewardsDistributor.claimable(tokenId) == 0) return totalClaimed;
            uint256 claimed = rewardsDistributor.claim(tokenId);
            if (claimed == 0) revert RebaseClaimStalled();
            totalClaimed += claimed;
            if (distribute && deposited) {
                totalRebaseClaimed += claimed;
                yieldToken.distributeYield(claimed);
                emit RebaseCheckpointed(tokenId, claimed, totalRebaseClaimed);
            }
        }
        if (rewardsDistributor.claimable(tokenId) != 0) revert RebaseBacklog();
    }
}
