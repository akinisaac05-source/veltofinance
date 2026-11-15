// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVeMezo, IVeMezoRewardsDistributor} from "./interfaces/IVeMezo.sol";
import {VeMezoYieldSeries} from "./VeMezoYieldSeries.sol";
import {VeMezoYieldDeployer} from "./VeMezoYieldDeployer.sol";
import {VeMezoMarketDeployer} from "./VeMezoMarketDeployer.sol";

/// @notice Testnet factory for isolated one-veNFT PT/YT tranches and MEZO markets.
contract VeMezoYieldFactory {
    uint256 public constant TARGET_CHAIN_ID = 31_611;
    uint256 public constant MAX_SERIES_PER_PAGE = 50;

    struct Series {
        uint256 tokenId;
        uint64 maturity;
        address tranche;
        address market;
        address creator;
    }

    IVeMezo public immutable veMezo;
    IVeMezoRewardsDistributor public immutable rewardsDistributor;
    address public immutable mezo;
    VeMezoYieldDeployer public immutable yieldDeployer;
    VeMezoMarketDeployer public immutable marketDeployer;

    Series[] private series;
    mapping(uint256 tokenId => address tranche) public seriesForTokenId;
    mapping(uint256 tokenId => address market) public marketForTokenId;

    error WrongChain(uint256 actualChainId);
    error InvalidConfiguration();
    error SeriesAlreadyCreated(uint256 tokenId);
    error InvalidPosition();
    error InvalidPageSize(uint256 limit);

    event SeriesCreated(
        uint256 indexed seriesId,
        uint256 indexed tokenId,
        uint64 indexed maturity,
        address creator,
        address tranche,
        address market,
        address principalToken,
        address yieldToken
    );

    constructor(address veMezo_, address distributor_, address mezo_) {
        if (block.chainid != TARGET_CHAIN_ID) revert WrongChain(block.chainid);
        if (
            veMezo_ == address(0) || distributor_ == address(0) || mezo_ == address(0)
                || veMezo_.code.length == 0 || distributor_.code.length == 0
                || mezo_.code.length == 0 || IVeMezo(veMezo_).token() != mezo_
                || IVeMezo(veMezo_).distributor() != distributor_
                || IVeMezoRewardsDistributor(distributor_).ve() != veMezo_
                || IVeMezoRewardsDistributor(distributor_).token() != mezo_
        ) revert InvalidConfiguration();

        veMezo = IVeMezo(veMezo_);
        rewardsDistributor = IVeMezoRewardsDistributor(distributor_);
        mezo = mezo_;
        yieldDeployer = new VeMezoYieldDeployer();
        marketDeployer = new VeMezoMarketDeployer();
    }

    /// @notice Create a tranche for the caller's eligible normal veMEZO NFT.
    /// @dev Each NFT has its own expiry-specific market so PT can redeem MEZO when its lock expires.
    function createSeries(uint256 tokenId) external returns (address tranche, address market) {
        if (seriesForTokenId[tokenId] != address(0)) revert SeriesAlreadyCreated(tokenId);
        if (veMezo.ownerOf(tokenId) != msg.sender) revert InvalidPosition();
        IVeMezo.LockedBalance memory locked = veMezo.locked(tokenId);
        if (
            locked.amount <= 0 || locked.end <= block.timestamp || locked.end > type(uint64).max
                || locked.isPermanent || veMezo.escrowType(tokenId) != 0
        ) revert InvalidPosition();

        uint64 maturity = uint64(locked.end);
        tranche = yieldDeployer.deploy(
            address(veMezo), address(rewardsDistributor), mezo, tokenId, maturity
        );
        market = marketDeployer.deploy(tranche);
        VeMezoYieldSeries yieldSeries = VeMezoYieldSeries(tranche);
        seriesForTokenId[tokenId] = tranche;
        marketForTokenId[tokenId] = market;
        series.push(Series(tokenId, maturity, tranche, market, msg.sender));

        emit SeriesCreated(
            series.length - 1,
            tokenId,
            maturity,
            msg.sender,
            tranche,
            market,
            address(yieldSeries.principalToken()),
            address(yieldSeries.yieldToken())
        );
    }

    function seriesCount() external view returns (uint256) {
        return series.length;
    }

    function seriesAt(uint256 index)
        external
        view
        returns (uint256 tokenId, uint64 maturity, address tranche, address market, address creator)
    {
        Series storage item = series[index];
        return (item.tokenId, item.maturity, item.tranche, item.market, item.creator);
    }

    function seriesPage(uint256 offset, uint256 limit)
        external
        view
        returns (
            uint256[] memory tokenIds,
            uint64[] memory maturities,
            address[] memory tranches,
            address[] memory markets,
            address[] memory creators,
            uint256 total
        )
    {
        if (limit == 0 || limit > MAX_SERIES_PER_PAGE) {
            revert InvalidPageSize(limit);
        }
        total = series.length;
        uint256 pageLength = offset >= total ? 0 : total - offset;
        if (pageLength > limit) pageLength = limit;
        tokenIds = new uint256[](pageLength);
        maturities = new uint64[](pageLength);
        tranches = new address[](pageLength);
        markets = new address[](pageLength);
        creators = new address[](pageLength);
        for (uint256 i; i < pageLength; ++i) {
            Series storage item = series[offset + i];
            tokenIds[i] = item.tokenId;
            maturities[i] = item.maturity;
            tranches[i] = item.tranche;
            markets[i] = item.market;
            creators[i] = item.creator;
        }
    }
}
