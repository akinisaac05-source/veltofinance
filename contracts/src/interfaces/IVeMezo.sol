// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IVeMezo is IERC721 {
    struct LockedBalance {
        int128 amount;
        uint256 end;
        bool isPermanent;
    }

    function token() external view returns (address);
    function distributor() external view returns (address);
    function ownerToNFTokenIdList(address owner, uint256 index) external view returns (uint256);
    function locked(uint256 tokenId) external view returns (LockedBalance memory);
    function escrowType(uint256 tokenId) external view returns (uint8);
    function depositFor(uint256 tokenId, uint256 amount) external;
    function withdraw(uint256 tokenId) external;
}

interface IVeMezoRewardsDistributor {
    function ve() external view returns (address);
    function token() external view returns (address);
    function lastTokenTime() external view returns (uint256);
    function claimable(uint256 tokenId) external view returns (uint256);
    function claim(uint256 tokenId) external returns (uint256);
}
