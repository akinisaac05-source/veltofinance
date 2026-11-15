// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VeMezoYieldSeries} from "./VeMezoYieldSeries.sol";

/// @notice Isolates tranche creation code so the shared factory stays deployable.
contract VeMezoYieldDeployer {
    function deploy(
        address veMezo,
        address distributor,
        address mezo,
        uint256 tokenId,
        uint64 maturity
    ) external returns (address) {
        return address(new VeMezoYieldSeries(veMezo, distributor, mezo, tokenId, maturity));
    }
}
