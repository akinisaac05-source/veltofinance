// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Normalizes deposits into and withdrawals from a yield source.
/// @dev Amounts are denominated in the underlying asset's smallest units. `exchangeRate`
/// returns underlying units per share scaled by 1e18. Implementations must document decimals.
interface IYieldSourceAdapter {
    function underlying() external view returns (address);
    function shareToken() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function exchangeRate() external view returns (uint256 rateWad);
    function positionOf(address account) external view returns (uint256 shares);
    function valueOf(uint256 shares) external view returns (uint256 assets);
}
