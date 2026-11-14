// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockUnderlying, MockYieldSource} from "../src/mocks/MockYieldSource.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockYieldSourceTest {
    MockUnderlying private asset;
    MockYieldSource private vault;

    function setUp() public {
        asset = new MockUnderlying();
        vault = new MockYieldSource(address(asset), address(this));
        asset.mint(address(this), 1_000 ether);
        asset.approve(address(vault), type(uint256).max);
    }

    function testDepositAndRedeemAtPar() public {
        uint256 shares = vault.deposit(100 ether, address(this));
        require(shares == 100 ether, "initial shares should be 1:1");
        require(vault.valueOf(shares) == 100 ether, "initial value should be par");
        uint256 assetsOut = vault.withdraw(shares, address(this), address(this));
        require(assetsOut == 100 ether, "redeem should return deposited assets");
        require(IERC20(address(vault)).balanceOf(address(this)) == 0, "shares should burn");
    }

    function testSimulatedYieldRaisesShareValue() public {
        uint256 shares = vault.deposit(100 ether, address(this));
        vault.simulateYield(25 ether);
        require(vault.valueOf(shares) == 125 ether, "mock yield should appreciate shares");
        require(vault.exchangeRate() == 1.25 ether, "exchange rate should reflect mock yield");
    }

    function testWithdrawUsesSharesAndReturnsCurrentValue() public {
        uint256 shares = vault.deposit(100 ether, address(this));
        vault.simulateYield(25 ether);
        uint256 assetsOut = vault.withdraw(shares / 2, address(this), address(this));
        require(assetsOut == 62.5 ether, "partial redemption uses current exchange rate");
        require(vault.balanceOf(address(this)) == shares / 2, "remaining shares should be conserved");
    }
}
