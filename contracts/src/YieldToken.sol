// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IYieldSettlement {
    function checkpointYield() external;
    function payYield(address receiver, uint256 amount) external;
}

/// @notice Transferable claim on realized sMUSD yield, accounted through a cumulative index.
contract YieldToken is ERC20, ReentrancyGuard {
    uint256 private constant INDEX_SCALE = 1e18;

    address public immutable exchange;
    mapping(address account => uint256 amount) public accruedYield;
    mapping(address account => uint256 index) public indexPaid;
    uint256 public yieldIndex;

    error NotExchange();
    error ZeroAddress();

    modifier onlyExchange() {
        if (msg.sender != exchange) revert NotExchange();
        _;
    }

    constructor(address exchange_, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        if (exchange_ == address(0)) revert ZeroAddress();
        exchange = exchange_;
    }

    function mint(address to, uint256 amount) external onlyExchange {
        _mint(to, amount);
    }

    function distributeYield(uint256 amount) external onlyExchange {
        uint256 supply = totalSupply();
        if (amount == 0 || supply == 0) return;
        yieldIndex += Math.mulDiv(amount, INDEX_SCALE, supply);
    }

    function claimableYield(address account) external view returns (uint256) {
        return accruedYield[account]
            + Math.mulDiv(balanceOf(account), yieldIndex - indexPaid[account], INDEX_SCALE);
    }

    function claimYield() external nonReentrant returns (uint256 amount) {
        IYieldSettlement(exchange).checkpointYield();
        _checkpoint(msg.sender);
        amount = accruedYield[msg.sender];
        if (amount == 0) return 0;
        accruedYield[msg.sender] = 0;
        IYieldSettlement(exchange).payYield(msg.sender, amount);
    }

    function transfer(address to, uint256 value) public override nonReentrant returns (bool) {
        IYieldSettlement(exchange).checkpointYield();
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override nonReentrant returns (bool) {
        IYieldSettlement(exchange).checkpointYield();
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
            accruedYield[account] += Math.mulDiv(balanceOf(account), currentIndex - paidIndex, INDEX_SCALE);
            indexPaid[account] = currentIndex;
        }
    }
}
