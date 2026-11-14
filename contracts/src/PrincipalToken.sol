// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A transferable maturity-principal claim. Only its exchange can mint or burn it.
contract PrincipalToken is ERC20 {
    address public immutable exchange;

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

    function burn(address from, uint256 amount) external onlyExchange {
        _burn(from, amount);
    }
}
