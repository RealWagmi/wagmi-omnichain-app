// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.23;

import { IUniswapV3Pool } from "./interfaces/IMinimalUniswapV3Pool.sol";
import { SafeCast } from "./vendor0.8/uniswap/SafeCast.sol";
import { Tick } from "./vendor0.8/uniswap/Tick.sol";
import { TickBitmap } from "./vendor0.8/uniswap/TickBitmap.sol";
import { TickMath } from "./vendor0.8/uniswap/TickMath.sol";
import { SwapMath } from "./vendor0.8/uniswap/SwapMath.sol";
import { BitMath } from "./vendor0.8/uniswap/BitMath.sol";

import "./vendor0.8/uniswap/V3Path.sol";
import "./vendor0.8/uniswap/PoolTicksCounter.sol";

contract SwapQuoterV3 {
    using V3Path for bytes;
    using SafeCast for uint256;
    using SafeCast for int256;
    using PoolTicksCounter for IUniswapV3Pool;

    struct QuoteSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
        uint256 amount;
    }

    struct SwapCache {
        uint8 feeProtocol;
        uint24 fee;
        int24 tickSpacing;
        int24 tickBefore;
        uint160 sqrtPriceX96Before;
    }

    // the top level state of the swap, the results of which are recorded in storage at the end
    struct SwapState {
        // the amount remaining to be swapped in/out of the input/output asset
        int256 amountSpecifiedRemaining;
        // the amount already swapped out/in of the output/input asset
        int256 amountCalculated;
        // current sqrt(price)
        uint160 sqrtPriceX96;
        // the tick associated with the current price
        int24 tick;
        // the current liquidity in range
        uint128 liquidity;
    }

    struct StepComputations {
        // the price at the beginning of the step
        uint160 sqrtPriceStartX96;
        // the next tick to swap to from the current tick in the swap direction
        int24 tickNext;
        // whether tickNext is initialized or not
        bool initialized;
        // sqrt(price) for the next tick (1/0)
        uint160 sqrtPriceNextX96;
        // how much is being swapped in in this step
        uint256 amountIn;
        // how much is being swapped out
        uint256 amountOut;
        // how much fee is being paid in
        uint256 feeAmount;
    }

    address public immutable factory;
    bytes32 public immutable initCodeHash;

    constructor(address _factory, bytes32 _initCodeHash) {
        factory = _factory;
        initCodeHash = _initCodeHash;
    }

    error SilentErrorMulti(uint256 i);

    function _calcsSwap(
        bool zeroForOne,
        address swapPool,
        uint24 fee,
        uint160 sqrtPriceLimitX96,
        int256 amountSpecified //exactOutput if negative, exactInput if positive
    ) private view returns (uint160, int256, int256) {
        require(amountSpecified != 0, "AS");
        SwapCache memory cache;
        SwapState memory state;
        {
            (
                // the current price)
                uint160 sqrtPriceX96Before,
                // the current tick
                int24 tickBefore,
                ,
                ,
                ,
                // the current protocol fee as a percentage of the swap fee taken on withdrawal
                // represented as an integer denominator (1/x)%
                uint8 feeProtocol,

            ) = IUniswapV3Pool(swapPool).slot0();

            sqrtPriceLimitX96 = sqrtPriceLimitX96 == 0
                ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                : sqrtPriceLimitX96;

            require(
                zeroForOne
                    ? sqrtPriceLimitX96 < sqrtPriceX96Before &&
                        sqrtPriceLimitX96 > TickMath.MIN_SQRT_RATIO
                    : sqrtPriceLimitX96 > sqrtPriceX96Before &&
                        sqrtPriceLimitX96 < TickMath.MAX_SQRT_RATIO,
                "SPL"
            );

            cache = SwapCache({
                feeProtocol: zeroForOne ? (feeProtocol % 16) : (feeProtocol >> 4),
                fee: fee,
                tickSpacing: IUniswapV3Pool(swapPool).tickSpacing(),
                tickBefore: tickBefore,
                sqrtPriceX96Before: sqrtPriceX96Before
            });

            state = SwapState({
                amountSpecifiedRemaining: amountSpecified,
                amountCalculated: 0,
                sqrtPriceX96: sqrtPriceX96Before,
                tick: tickBefore,
                liquidity: IUniswapV3Pool(swapPool).liquidity()
            });
        }
        bool exactInput = amountSpecified > 0;

        // continue swapping as long as we haven't used the entire input/output and haven't reached the price limit
        while (state.amountSpecifiedRemaining != 0 && state.sqrtPriceX96 != sqrtPriceLimitX96) {
            StepComputations memory step;

            step.sqrtPriceStartX96 = state.sqrtPriceX96;

            (step.tickNext, step.initialized) = _nextInitializedTickWithinOneWord(
                swapPool,
                state.tick,
                cache.tickSpacing,
                zeroForOne
            );

            // ensure that we do not overshoot the min/max tick, as the tick bitmap is not aware of these bounds
            if (step.tickNext < TickMath.MIN_TICK) {
                step.tickNext = TickMath.MIN_TICK;
            } else if (step.tickNext > TickMath.MAX_TICK) {
                step.tickNext = TickMath.MAX_TICK;
            }

            // get the price for the next tick
            step.sqrtPriceNextX96 = TickMath.getSqrtRatioAtTick(step.tickNext);

            // compute values to swap to the target tick, price limit, or point where input/output amount is exhausted
            (state.sqrtPriceX96, step.amountIn, step.amountOut, step.feeAmount) = SwapMath
                .computeSwapStep(
                    state.sqrtPriceX96,
                    (
                        zeroForOne
                            ? step.sqrtPriceNextX96 < sqrtPriceLimitX96
                            : step.sqrtPriceNextX96 > sqrtPriceLimitX96
                    )
                        ? sqrtPriceLimitX96
                        : step.sqrtPriceNextX96,
                    state.liquidity,
                    state.amountSpecifiedRemaining,
                    cache.fee
                );

            if (exactInput) {
                // safe because we test that amountSpecified > amountIn + feeAmount in SwapMath
                unchecked {
                    state.amountSpecifiedRemaining -= (step.amountIn + step.feeAmount).toInt256();
                }
                state.amountCalculated -= step.amountOut.toInt256();
            } else {
                unchecked {
                    state.amountSpecifiedRemaining += step.amountOut.toInt256();
                }
                state.amountCalculated += (step.amountIn + step.feeAmount).toInt256();
            }

            // if the protocol fee is on, calculate how much is owed, decrement feeAmount, and increment protocolFee
            if (cache.feeProtocol > 0) {
                unchecked {
                    uint256 delta = step.feeAmount / cache.feeProtocol;
                    step.feeAmount -= delta;
                }
            }

            // shift tick if we reached the next price
            if (state.sqrtPriceX96 == step.sqrtPriceNextX96) {
                // if the tick is initialized, run the tick transition
                if (step.initialized) {
                    // check for the placeholder value, which we replace with the actual value the first time the swap
                    // crosses an initialized tick

                    (, int128 liquidityNet, , , , , , ) = IUniswapV3Pool(swapPool).ticks(
                        step.tickNext
                    );
                    // if we're moving leftward, we interpret liquidityNet as the opposite sign
                    // safe because liquidityNet cannot be type(int128).min
                    unchecked {
                        if (zeroForOne) liquidityNet = -liquidityNet;
                    }

                    state.liquidity = liquidityNet < 0
                        ? state.liquidity - uint128(-liquidityNet)
                        : state.liquidity + uint128(liquidityNet);
                }

                unchecked {
                    state.tick = zeroForOne ? step.tickNext - 1 : step.tickNext;
                }
            } else if (state.sqrtPriceX96 != step.sqrtPriceStartX96) {
                // recompute unless we're on a lower tick boundary (i.e. already transitioned ticks), and haven't moved
                state.tick = TickMath.getTickAtSqrtRatio(state.sqrtPriceX96);
            }
        }
        int256 amount0;
        int256 amount1;
        unchecked {
            (amount0, amount1) = zeroForOne == exactInput
                ? (amountSpecified - state.amountSpecifiedRemaining, state.amountCalculated)
                : (state.amountCalculated, amountSpecified - state.amountSpecifiedRemaining);
        }
        return (state.sqrtPriceX96, amount0, amount1);
    }

    function _position(int24 tick) private pure returns (int16 wordPos, uint8 bitPos) {
        unchecked {
            wordPos = int16(tick >> 8);
            bitPos = uint8(int8(tick % 256));
        }
    }

    function _nextInitializedTickWithinOneWord(
        address swapPool,
        int24 tick,
        int24 tickSpacing,
        bool lte
    ) private view returns (int24 next, bool initialized) {
        unchecked {
            int24 compressed = tick / tickSpacing;
            if (tick < 0 && tick % tickSpacing != 0) compressed--; // round towards negative infinity

            if (lte) {
                (int16 wordPos, uint8 bitPos) = _position(compressed);
                // all the 1s at or to the right of the current bitPos
                uint256 mask = (1 << bitPos) - 1 + (1 << bitPos);
                uint256 masked = IUniswapV3Pool(swapPool).tickBitmap(wordPos) & mask;

                // if there are no initialized ticks to the right of or at the current tick, return rightmost in the word
                initialized = masked != 0;
                // overflow/underflow is possible, but prevented externally by limiting both tickSpacing and tick
                next = initialized
                    ? (compressed - int24(uint24(bitPos - BitMath.mostSignificantBit(masked)))) *
                        tickSpacing
                    : (compressed - int24(uint24(bitPos))) * tickSpacing;
            } else {
                // start from the word of the next tick, since the current tick state doesn't matter
                (int16 wordPos, uint8 bitPos) = _position(compressed + 1);
                // all the 1s at or to the left of the bitPos
                uint256 mask = ~((1 << bitPos) - 1);
                uint256 masked = IUniswapV3Pool(swapPool).tickBitmap(wordPos) & mask;

                // if there are no initialized ticks to the left of the current tick, return leftmost in the word
                initialized = masked != 0;
                // overflow/underflow is possible, but prevented externally by limiting both tickSpacing and tick
                next = initialized
                    ? (compressed +
                        1 +
                        int24(uint24(BitMath.leastSignificantBit(masked) - bitPos))) * tickSpacing
                    : (compressed + 1 + int24(uint24(type(uint8).max - bitPos))) * tickSpacing;
            }
        }
    }

    function quoteExactInputSingle(
        QuoteSingleParams memory params
    ) public view returns (uint160 sqrtPriceX96After, uint256 amountOut) {
        int256 amount0;
        int256 amount1;
        (bool zeroForOne, address swapPool) = computePoolAddress(
            params.tokenIn,
            params.tokenOut,
            params.fee
        );

        (sqrtPriceX96After, amount0, amount1) = _calcsSwap(
            zeroForOne,
            swapPool,
            params.fee,
            params.sqrtPriceLimitX96,
            params.amount.toInt256()
        );

        amountOut = zeroForOne ? uint256(-amount1) : uint256(-amount0);
    }

    function quoteExactInput(
        bytes calldata path,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        amountOut = amountIn;
        uint256 i = 0;
        while (true) {
            (address tokenIn, uint24 fee, address tokenOut) = path.decodeFirstPool();

            (, amountOut) = quoteExactInputSingle(
                QuoteSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: fee,
                    sqrtPriceLimitX96: 0,
                    amount: amountOut // the outputs of prior swaps become the inputs to subsequent ones
                })
            );
            unchecked {
                ++i;
            }

            // decide whether to continue or terminate
            if (path.hasMultiplePools()) {
                path = path.skipToken();
            } else {
                break;
            }
        }
    }

    function quoteExactOutputSingle(
        QuoteSingleParams memory params
    ) public view returns (uint160 sqrtPriceX96After, uint256 amountIn) {
        (bool zeroForOne, address swapPool) = computePoolAddress(
            params.tokenIn,
            params.tokenOut,
            params.fee
        );
        int256 amount0;
        int256 amount1;

        (sqrtPriceX96After, amount0, amount1) = _calcsSwap(
            zeroForOne,
            swapPool,
            params.fee,
            params.sqrtPriceLimitX96,
            -params.amount.toInt256()
        );

        uint256 amountOut;
        (amountIn, amountOut) = zeroForOne
            ? (uint256(amount0), uint256(-amount1))
            : (uint256(amount1), uint256(-amount0));

        if (params.sqrtPriceLimitX96 == 0) {
            require(params.amount == amountOut, "amountOut is too small");
        }
    }

    function quoteExactOutput(
        bytes calldata path,
        uint256 amountOut
    ) external view returns (uint256 amountIn) {
        uint256 i = 0;
        while (true) {
            (address tokenIn, uint24 fee, address tokenOut) = path.decodeFirstPool();

            // the outputs of prior swaps become the inputs to subsequent ones
            (, amountIn) = quoteExactOutputSingle(
                QuoteSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: fee,
                    sqrtPriceLimitX96: 0,
                    amount: amountOut
                })
            );
            amountOut = amountIn;
            i++;

            // decide whether to continue or terminate
            if (path.hasMultiplePools()) {
                path = path.skipToken();
            } else {
                break;
            }
        }
    }

    function multicall(bytes[] calldata data) public payable returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);

            if (!success) {
                // Next 5 lines from https://ethereum.stackexchange.com/a/83577
                if (result.length < 68) revert SilentErrorMulti(i);
                assembly {
                    result := add(result, 0x04)
                }
                revert(abi.decode(result, (string)));
            }

            results[i] = result;
        }
    }

    function computePoolAddress(
        address tokenA,
        address tokenB,
        uint24 fee
    ) public view returns (bool zeroForOne, address pool) {
        if (tokenA > tokenB) {
            (tokenA, tokenB) = (tokenB, tokenA);
        } else {
            zeroForOne = true;
        }

        pool = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            factory,
                            keccak256(abi.encode(tokenA, tokenB, fee)),
                            initCodeHash
                        )
                    )
                )
            )
        );
    }
}
