// SPDX-License-Identifier: SAL-1.0
pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { TransferHelper } from "./../libraries/TransferHelper.sol";
import { IUniswapV3Pool } from "./interfaces/IMinimalUniswapV3Pool.sol";
import { SafeCast } from "./vendor0.8/uniswap/SafeCast.sol";
import { ISyntheticToken } from "./../interfaces/ISyntheticToken.sol";
import { IUniswapV3Factory } from "./interfaces/IMinimalUniswapV3Factory.sol";
import { INonfungiblePositionManager } from "./interfaces/IMinimalNonfungiblePositionManager.sol";
import { TickMath } from "./vendor0.8/uniswap/TickMath.sol";

// import { console } from "hardhat/console.sol";

contract PoolCreator {
    using SafeCast for uint256;
    using TransferHelper for address;

    struct PoolInfo {
        address token0;
        address token1;
        address poolAddress;
        string name;
    }

    struct Asset {
        address token;
        uint256 amount;
    }

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    IUniswapV3Factory public immutable factory;
    INonfungiblePositionManager public immutable positionManager;

    PoolInfo[] public pools;

    constructor(address _factory, address _positionManager) {
        factory = IUniswapV3Factory(_factory);
        positionManager = INonfungiblePositionManager(_positionManager);
    }

    function createPool(int24 _initTick, Asset memory _assetA, Asset memory _assetB) public {
        IUniswapV3Pool poolAddress = IUniswapV3Pool(
            factory.createPool(_assetA.token, _assetB.token, 500)
        );
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(_initTick);
        poolAddress.initialize(sqrtPriceX96);
        address token0 = _assetA.token < _assetB.token ? _assetA.token : _assetB.token;
        address token1 = _assetA.token < _assetB.token ? _assetB.token : _assetA.token;
        _maxApproveIfNecessary(token0, address(positionManager));
        _maxApproveIfNecessary(token1, address(positionManager));
        uint256 amount0 = _assetA.token == token0 ? _assetA.amount : _assetB.amount;
        uint256 amount1 = _assetA.token == token1 ? _assetA.amount : _assetB.amount;
        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);
        string memory name = string.concat(
            IERC20Metadata(token0).symbol(),
            "/",
            IERC20Metadata(token1).symbol()
        );

        pools.push(
            PoolInfo({
                token0: token0,
                token1: token1,
                poolAddress: address(poolAddress),
                name: name
            })
        );

        positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: 500,
                tickLower: -887250, //full range for 500
                tickUpper: 887250,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        uint256 remaining0 = IERC20(token0).balanceOf(address(this));
        uint256 remaining1 = IERC20(token1).balanceOf(address(this));
        IERC20(token0).transfer(msg.sender, remaining0);
        IERC20(token1).transfer(msg.sender, remaining1);
    }

    function _tryApprove(address token, address spender, uint256 amount) private returns (bool) {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, amount)
        );
        return success && (data.length == 0 || abi.decode(data, (bool)));
    }

    function _maxApproveIfNecessary(address token, address spender) internal {
        if (IERC20(token).allowance(address(this), spender) < type(uint128).max) {
            if (!_tryApprove(token, spender, type(uint256).max)) {
                if (!_tryApprove(token, spender, type(uint256).max - 1)) {
                    require(_tryApprove(token, spender, 0));
                    if (!_tryApprove(token, spender, type(uint256).max)) {
                        if (!_tryApprove(token, spender, type(uint256).max - 1)) {
                            revert("ERC20_APPROVE_DID_NOT_SUCCEED");
                        }
                    }
                }
            }
        }
    }
}
