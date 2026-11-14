// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {YieldMarket} from "./YieldMarket.sol";

/// @notice Small deployment helper used by YieldSeriesFactory to stay below EIP-170.
contract YieldMarketDeployer {
    function deploy(address exchange) external returns (address) {
        return address(new YieldMarket(exchange));
    }
}
