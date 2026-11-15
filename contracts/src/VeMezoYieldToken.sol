// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IVeMezoYieldSettlement {
    function checkpointYield() external;
    function payYield(address receiver, uint256 amount) external;
    function settled() external view returns (bool);
}

/// @notice Transferable claim on MEZO rebases attributed while held.
contract VeMezoYieldToken is ERC20, ReentrancyGuard {
    uint256 private constant INDEX_SCALE = 1e18;

    address public immutable series;
    mapping(address account => uint256 amount) public accruedYield;
    mapping(address account => uint256 index) public indexPaid;
    uint256 public yieldIndex;
    uint256 public undistributedYield;

    error NotSeries();
    error NotMatured();
    error ZeroAddress();

    modifier onlySeries() {
        if (msg.sender != series) revert NotSeries();
        _;
    }

    constructor(address series_) ERC20("MEZO Rebase Yield Token", "YT-veMEZO") {
        if (series_ == address(0)) revert ZeroAddress();
        series = series_;
    }

    function mint(address to, uint256 amount) external onlySeries {
        _mint(to, amount);
    }

    function distributeYield(uint256 amount) external onlySeries {
        if (amount == 0) return;
        uint256 amountToDistribute = amount + undistributedYield;
        uint256 supply = totalSupply();
        if (supply == 0) {
            undistributedYield = amountToDistribute;
            return;
        }
        uint256 indexIncrease = Math.mulDiv(amountToDistribute, INDEX_SCALE, supply);
        uint256 allocated = Math.mulDiv(indexIncrease, supply, INDEX_SCALE);
        yieldIndex += indexIncrease;
        undistributedYield = amountToDistribute - allocated;
    }

    function claimableYield(address account) external view returns (uint256) {
        return accruedYield[account]
            + Math.mulDiv(balanceOf(account), yieldIndex - indexPaid[account], INDEX_SCALE);
    }

    function checkpointForHolder() external nonReentrant {
        IVeMezoYieldSettlement(series).checkpointYield();
        _checkpoint(msg.sender);
    }

    function claimYield() external nonReentrant returns (uint256 amount) {
        IVeMezoYieldSettlement(series).checkpointYield();
        if (!IVeMezoYieldSettlement(series).settled()) revert NotMatured();
        _checkpoint(msg.sender);
        amount = accruedYield[msg.sender];
        if (amount == 0) return 0;
        accruedYield[msg.sender] = 0;
        IVeMezoYieldSettlement(series).payYield(msg.sender, amount);
    }

    function transfer(address to, uint256 value) public override nonReentrant returns (bool) {
        IVeMezoYieldSettlement(series).checkpointYield();
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value)
        public
        override
        nonReentrant
        returns (bool)
    {
        IVeMezoYieldSettlement(series).checkpointYield();
        return super.transferFrom(from, to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) _checkpoint(from);
        if (to != address(0) && to != from) _checkpoint(to);
        super._update(from, to, value);
    }

    function _checkpoint(address account) private {
        uint256 currentIndex = yieldIndex;
        uint256 paidIndex = indexPaid[account];
        if (currentIndex != paidIndex) {
            accruedYield[
                account
            ] += Math.mulDiv(balanceOf(account), currentIndex - paidIndex, INDEX_SCALE);
            indexPaid[account] = currentIndex;
        }
    }
}
