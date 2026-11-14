// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMUSDSavingsRate} from "./interfaces/IMUSDSavingsRate.sol";
import {YieldExchange} from "./YieldExchange.sol";
import {YieldExchangeDeployer} from "./YieldExchangeDeployer.sol";
import {YieldMarketDeployer} from "./YieldMarketDeployer.sol";

/// @notice Permissionless creator for shared PT/YT maturity series and their markets.
/// @dev Traders use the registered series; only market creators call createSeries.
contract YieldSeriesFactory {
    uint256 public constant TARGET_CHAIN_ID = 31_611;
    uint256 public constant MAX_SERIES_PER_PAGE = 50;

    struct Series {
        address exchange;
        address market;
        uint64 maturity;
        address creator;
    }

    IERC20 public immutable asset;
    IMUSDSavingsRate public immutable savingsVault;
    YieldExchangeDeployer public immutable exchangeDeployer;
    YieldMarketDeployer public immutable marketDeployer;

    Series[] private series;
    mapping(uint64 maturity => address exchange) public exchangeForMaturity;

    error WrongChain(uint256 actualChainId);
    error InvalidConfiguration();
    error MaturityAlreadyCreated(uint64 maturity);
    error InvalidPageSize(uint256 limit);

    event SeriesCreated(
        uint256 indexed seriesId,
        uint64 indexed maturity,
        address indexed creator,
        address exchange,
        address market,
        address principalToken,
        address yieldToken
    );

    constructor(address asset_, address savingsVault_) {
        if (block.chainid != TARGET_CHAIN_ID) revert WrongChain(block.chainid);
        if (
            asset_ == address(0) || savingsVault_ == address(0) || asset_.code.length == 0
                || savingsVault_.code.length == 0
                || IMUSDSavingsRate(savingsVault_).musdToken() != asset_
        ) revert InvalidConfiguration();

        asset = IERC20(asset_);
        savingsVault = IMUSDSavingsRate(savingsVault_);
        exchangeDeployer = new YieldExchangeDeployer();
        marketDeployer = new YieldMarketDeployer();
    }

    /// @notice Deploy and register one shared exchange and market for a maturity.
    /// @dev Permissionless like Pendle market creation; the caller pays deployment gas.
    function createSeries(uint64 maturity_)
        external
        returns (address exchangeAddress, address marketAddress)
    {
        if (exchangeForMaturity[maturity_] != address(0)) {
            revert MaturityAlreadyCreated(maturity_);
        }

        exchangeAddress = exchangeDeployer.deploy(address(asset), address(savingsVault), maturity_);
        marketAddress = marketDeployer.deploy(exchangeAddress);
        YieldExchange exchange = YieldExchange(exchangeAddress);

        exchangeForMaturity[maturity_] = exchangeAddress;
        series.push(Series(exchangeAddress, marketAddress, maturity_, msg.sender));

        emit SeriesCreated(
            series.length - 1,
            maturity_,
            msg.sender,
            exchangeAddress,
            marketAddress,
            address(exchange.principalToken()),
            address(exchange.yieldToken())
        );
    }

    function seriesCount() external view returns (uint256) {
        return series.length;
    }

    function seriesAt(uint256 index)
        external
        view
        returns (address exchangeAddress, address marketAddress, uint64 maturity, address creator)
    {
        Series storage item = series[index];
        return (item.exchange, item.market, item.maturity, item.creator);
    }

    function seriesPage(uint256 offset, uint256 limit)
        external
        view
        returns (
            address[] memory exchanges,
            address[] memory markets,
            uint64[] memory maturities,
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
        exchanges = new address[](pageLength);
        markets = new address[](pageLength);
        maturities = new uint64[](pageLength);
        creators = new address[](pageLength);

        for (uint256 i; i < pageLength; ++i) {
            Series storage item = series[offset + i];
            exchanges[i] = item.exchange;
            markets[i] = item.market;
            maturities[i] = item.maturity;
            creators[i] = item.creator;
        }
    }
}
