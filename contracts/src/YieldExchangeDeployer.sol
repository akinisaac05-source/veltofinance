// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {YieldExchange} from "./YieldExchange.sol";

/// @notice Small deployment helper used by YieldSeriesFactory to stay below EIP-170.
contract YieldExchangeDeployer {
    function deploy(address asset, address savingsVault, uint64 maturity)
        external
        returns (address)
    {
        return address(new YieldExchange(asset, savingsVault, maturity));
    }
}
