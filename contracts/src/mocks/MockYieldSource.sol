// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IYieldSourceAdapter} from "../interfaces/IYieldSourceAdapter.sol";

/// @notice Test-only faucet asset. Anyone can mint; it is not MUSD and has no market value.
contract MockUnderlying is ERC20 {
    constructor() ERC20("Mock Underlying USD", "mUSD-MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice A deliberately simulated ERC-4626-like source for local/testnet demonstrations.
/// @dev `simulateYield` mints mock assets directly to the vault; it never models live yield.
contract MockYieldSource is ERC20, Ownable, IYieldSourceAdapter {
    using SafeERC20 for IERC20;

    IERC20 private immutable _asset;

    error ZeroAmount();
    error InsufficientShares();

    constructor(address asset_, address admin)
        ERC20("Mock Yield Share", "myS-MOCK")
        Ownable(admin)
    {
        require(asset_ != address(0), "asset is zero");
        _asset = IERC20(asset_);
    }

    function underlying() external view override returns (address) { return address(_asset); }
    function shareToken() external view override returns (address) { return address(this); }

    function deposit(uint256 assets, address receiver) external override returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        uint256 balance = _asset.balanceOf(address(this));
        shares = supply == 0 || balance == 0 ? assets : assets * supply / balance;
        if (shares == 0) revert ZeroAmount();
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
    }

    function withdraw(uint256 shares, address receiver, address owner)
        external override returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        assets = valueOf(shares);
        if (assets == 0) revert ZeroAmount();
        _burn(owner, shares);
        _asset.safeTransfer(receiver, assets);
    }

    function exchangeRate() public view override returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? 1e18 : _asset.balanceOf(address(this)) * 1e18 / supply;
    }

    function positionOf(address account) external view override returns (uint256) { return balanceOf(account); }
    function valueOf(uint256 shares) public view override returns (uint256) {
        return totalSupply() == 0 ? shares : shares * _asset.balanceOf(address(this)) / totalSupply();
    }

    function simulateYield(uint256 assets) external onlyOwner {
        if (assets == 0) revert ZeroAmount();
        MockUnderlying(address(_asset)).mint(address(this), assets);
    }
}
