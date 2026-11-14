// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mezo's non-ERC-4626 MUSD Savings Rate vault interface on Mezo Testnet.
interface IMUSDSavingsRate is IERC20 {
    function musdToken() external view returns (address);
    function claimableYield(address holder) external view returns (uint256);
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimYield() external returns (uint256 claimed);
}
