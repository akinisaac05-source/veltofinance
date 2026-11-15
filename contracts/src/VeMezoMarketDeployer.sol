// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VeMezoMarket} from "./VeMezoMarket.sol";

/// @notice Isolates PT/YT market creation code from the tranche factory.
contract VeMezoMarketDeployer {
    function deploy(address series) external returns (address) {
        return address(new VeMezoMarket(series));
    }
}
