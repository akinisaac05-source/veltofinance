// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {YieldExchange} from "./YieldExchange.sol";
import {YieldToken} from "./YieldToken.sol";

/// @notice A testnet-only constant-product market for PT/MUSD and YT/MUSD.
/// @dev Each side is a separate permissionless pool; quotes are reserve-based, not an oracle.
contract YieldMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TARGET_CHAIN_ID = 31_611;
    uint256 public constant FEE_BPS = 30;
    uint256 private constant BPS = 10_000;
    uint256 private constant MINIMUM_LIQUIDITY = 1_000;
    uint256 private constant YIELD_INDEX_SCALE = 1e18;
    address private constant LOCKED_LIQUIDITY = address(0xdead);

    IERC20 public immutable asset;
    IERC20 public immutable principalToken;
    IERC20 public immutable yieldToken;

    struct Pool {
        uint112 reserveAsset;
        uint112 reserveToken;
        uint256 totalLiquidity;
        mapping(address account => uint256 amount) liquidity;
    }

    mapping(address token => Pool) private pools;
    mapping(address token => uint256 index) private liquidityYieldIndex;
    mapping(address token => uint256 amount) private undistributedLiquidityYield;
    mapping(address token => mapping(address provider => uint256 amount)) private accruedLiquidityYield;
    mapping(address token => mapping(address provider => uint256 index)) private liquidityYieldIndexPaid;

    error WrongChain(uint256 actualChainId);
    error InvalidExchange();
    error UnsupportedToken();
    error InvalidAmount();
    error InsufficientOutput();
    error InsufficientLiquidity();
    error InsufficientLiquidityTokens();
    error YieldOnlyPool();
    error ReserveOverflow();

    event LiquidityAdded(address indexed provider, address indexed token, uint256 assetAmount, uint256 tokenAmount, uint256 shares);
    event LiquidityRemoved(address indexed provider, address indexed token, uint256 assetAmount, uint256 tokenAmount, uint256 shares);
    event LiquidityYieldDistributed(address indexed token, uint256 amount, uint256 index);
    event LiquidityYieldClaimed(address indexed provider, uint256 amount);
    event Swap(address indexed trader, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address recipient);

    constructor(address exchange_) {
        if (block.chainid != TARGET_CHAIN_ID) revert WrongChain(block.chainid);
        if (exchange_ == address(0) || exchange_.code.length == 0) revert InvalidExchange();
        YieldExchange exchange = YieldExchange(exchange_);
        asset = exchange.asset();
        principalToken = IERC20(address(exchange.principalToken()));
        yieldToken = IERC20(address(exchange.yieldToken()));
    }

    function pool(address token) external view returns (uint112 reserveAsset, uint112 reserveToken, uint256 totalLiquidity) {
        _requireToken(token);
        Pool storage pair = pools[token];
        return (pair.reserveAsset, pair.reserveToken, pair.totalLiquidity);
    }

    function liquidityOf(address token, address account) external view returns (uint256) {
        _requireToken(token);
        return pools[token].liquidity[account];
    }

    function claimableLiquidityYield(address token, address account) external view returns (uint256) {
        _requireToken(token);
        uint256 index = liquidityYieldIndex[token];
        return accruedLiquidityYield[token][account]
            + Math.mulDiv(
                pools[token].liquidity[account],
                index - liquidityYieldIndexPaid[token][account],
                YIELD_INDEX_SCALE
            );
    }

    function claimLiquidityYield(address token) external nonReentrant returns (uint256 amount) {
        _requireToken(token);
        if (token != address(yieldToken)) revert YieldOnlyPool();

        _harvestLiquidityYield(token);
        _checkpointLiquidityYield(token, msg.sender);
        amount = accruedLiquidityYield[token][msg.sender];
        if (amount == 0) return 0;

        accruedLiquidityYield[token][msg.sender] = 0;
        asset.safeTransfer(msg.sender, amount);
        emit LiquidityYieldClaimed(msg.sender, amount);
    }

    function quote(address token, address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        _requireToken(token);
        if (tokenIn != address(asset) && tokenIn != token) revert UnsupportedToken();
        Pool storage pair = pools[token];
        if (pair.reserveAsset == 0 || pair.reserveToken == 0 || amountIn == 0) return 0;
        bool assetIn = tokenIn == address(asset);
        uint256 reserveIn = assetIn ? pair.reserveAsset : pair.reserveToken;
        uint256 reserveOut = assetIn ? pair.reserveToken : pair.reserveAsset;
        uint256 amountInWithFee = amountIn * (BPS - FEE_BPS);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * BPS + amountInWithFee);
    }

    function addLiquidity(address token, uint256 assetAmount, uint256 tokenAmount, uint256 minShares)
        external nonReentrant returns (uint256 shares)
    {
        _requireToken(token);
        if (assetAmount == 0 || tokenAmount == 0) revert InvalidAmount();
        Pool storage pair = pools[token];
        _harvestLiquidityYield(token);
        _checkpointLiquidityYield(token, msg.sender);
        uint256 supply = pair.totalLiquidity;

        uint256 usedAsset = assetAmount;
        uint256 usedToken = tokenAmount;
        if (supply == 0) {
            uint256 root = Math.sqrt(assetAmount * tokenAmount);
            if (root <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            shares = root - MINIMUM_LIQUIDITY;
        } else {
            if (pair.reserveAsset == 0 || pair.reserveToken == 0) revert InsufficientLiquidity();
            uint256 sharesByAsset = (assetAmount * supply) / pair.reserveAsset;
            uint256 sharesByToken = (tokenAmount * supply) / pair.reserveToken;
            shares = sharesByAsset < sharesByToken ? sharesByAsset : sharesByToken;
            if (shares == 0) revert InsufficientLiquidity();
            if (sharesByAsset <= sharesByToken) {
                usedToken = Math.mulDiv(shares, pair.reserveToken, supply, Math.Rounding.Ceil);
            } else {
                usedAsset = Math.mulDiv(shares, pair.reserveAsset, supply, Math.Rounding.Ceil);
            }
        }
        if (shares < minShares) revert InsufficientLiquidityTokens();

        IERC20(address(asset)).safeTransferFrom(msg.sender, address(this), usedAsset);
        IERC20(token).safeTransferFrom(msg.sender, address(this), usedToken);
        if (supply == 0) {
            pair.totalLiquidity = shares + MINIMUM_LIQUIDITY;
            pair.liquidity[LOCKED_LIQUIDITY] = MINIMUM_LIQUIDITY;
        } else {
            pair.totalLiquidity = supply + shares;
        }
        pair.liquidity[msg.sender] += shares;
        _sync(pair, usedAsset, usedToken);
        emit LiquidityAdded(msg.sender, token, usedAsset, usedToken, shares);
    }

    function removeLiquidity(address token, uint256 shares, uint256 minAssetOut, uint256 minTokenOut)
        external nonReentrant returns (uint256 assetOut, uint256 tokenOut)
    {
        _requireToken(token);
        Pool storage pair = pools[token];
        if (shares == 0 || shares > pair.liquidity[msg.sender]) revert InsufficientLiquidityTokens();
        _harvestLiquidityYield(token);
        _checkpointLiquidityYield(token, msg.sender);
        uint256 supply = pair.totalLiquidity;
        assetOut = (shares * pair.reserveAsset) / supply;
        tokenOut = (shares * pair.reserveToken) / supply;
        if (assetOut < minAssetOut || tokenOut < minTokenOut) revert InsufficientOutput();
        pair.liquidity[msg.sender] -= shares;
        pair.totalLiquidity = supply - shares;
        _setReserves(pair, uint256(pair.reserveAsset) - assetOut, uint256(pair.reserveToken) - tokenOut);
        IERC20(address(asset)).safeTransfer(msg.sender, assetOut);
        IERC20(token).safeTransfer(msg.sender, tokenOut);
        emit LiquidityRemoved(msg.sender, token, assetOut, tokenOut, shares);
    }

    function swapExactIn(address token, address tokenIn, uint256 amountIn, uint256 minAmountOut, address recipient)
        external nonReentrant returns (uint256 amountOut)
    {
        _requireToken(token);
        if (tokenIn != address(asset) && tokenIn != token) revert UnsupportedToken();
        if (amountIn == 0 || recipient == address(0)) revert InvalidAmount();
        Pool storage pair = pools[token];
        if (pair.reserveAsset == 0 || pair.reserveToken == 0) revert InsufficientLiquidity();
        bool assetIn = tokenIn == address(asset);
        uint256 reserveIn = assetIn ? pair.reserveAsset : pair.reserveToken;
        uint256 reserveOut = assetIn ? pair.reserveToken : pair.reserveAsset;
        uint256 amountInWithFee = amountIn * (BPS - FEE_BPS);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * BPS + amountInWithFee);
        if (amountOut == 0 || amountOut < minAmountOut || amountOut >= reserveOut) revert InsufficientOutput();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(assetIn ? token : address(asset)).safeTransfer(recipient, amountOut);
        uint256 nextAssetReserve = uint256(pair.reserveAsset) + (assetIn ? amountIn : 0) - (assetIn ? 0 : amountOut);
        uint256 nextTokenReserve = uint256(pair.reserveToken) + (assetIn ? 0 : amountIn) - (assetIn ? amountOut : 0);
        _setReserves(pair, nextAssetReserve, nextTokenReserve);
        emit Swap(msg.sender, tokenIn, assetIn ? token : address(asset), amountIn, amountOut, recipient);
    }

    function _requireToken(address token) private view {
        if (token != address(principalToken) && token != address(yieldToken)) revert UnsupportedToken();
    }

    function _harvestLiquidityYield(address token) private {
        if (token != address(yieldToken)) return;

        uint256 harvested = YieldToken(address(yieldToken)).claimYield();
        if (harvested == 0) return;

        uint256 supply = pools[token].totalLiquidity;
        if (supply == 0) return;

        uint256 amountToDistribute = harvested + undistributedLiquidityYield[token];
        uint256 indexIncrease = Math.mulDiv(amountToDistribute, YIELD_INDEX_SCALE, supply);
        uint256 allocated = Math.mulDiv(indexIncrease, supply, YIELD_INDEX_SCALE);
        liquidityYieldIndex[token] += indexIncrease;
        undistributedLiquidityYield[token] = amountToDistribute - allocated;
        emit LiquidityYieldDistributed(token, harvested, liquidityYieldIndex[token]);
    }

    function _checkpointLiquidityYield(address token, address provider) private {
        uint256 index = liquidityYieldIndex[token];
        uint256 paidIndex = liquidityYieldIndexPaid[token][provider];
        if (index != paidIndex) {
            accruedLiquidityYield[token][provider] += Math.mulDiv(
                pools[token].liquidity[provider], index - paidIndex, YIELD_INDEX_SCALE
            );
        }
        liquidityYieldIndexPaid[token][provider] = index;
    }

    function _sync(Pool storage pair, uint256 addedAsset, uint256 addedToken) private {
        _setReserves(pair, uint256(pair.reserveAsset) + addedAsset, uint256(pair.reserveToken) + addedToken);
    }

    function _setReserves(Pool storage pair, uint256 assetReserve, uint256 tokenReserve) private {
        if (assetReserve > type(uint112).max || tokenReserve > type(uint112).max) revert ReserveOverflow();
        pair.reserveAsset = SafeCast.toUint112(assetReserve);
        pair.reserveToken = SafeCast.toUint112(tokenReserve);
    }
}
