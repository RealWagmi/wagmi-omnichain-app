// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { IBalancer } from "./interfaces/IBalancer.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { FullMath } from "./libraries/FullMath.sol";

// import { console } from "hardhat/console.sol";

/**
 * @title Balancer
 * @author Your Name/Company
 * @notice This contract is responsible for calculating penalties and bonuses
 *         for cross-chain token transfers based on token distribution across different chains.
 *         It aims to incentivize balanced liquidity of synthetic tokens.
 */
contract Balancer is IBalancer, Ownable {
    /**
     * @notice Configuration for a specific synthetic token on a specific chain.
     * @param thresholdWeightBps The target weight (in basis points, 1e6 = 100%) this chain should ideally hold
     *                           of the token's total supply. If the chain's balance relative to total supply
     *                           falls below this threshold, penalties may apply on withdrawals.
     * @param curveFlattener A coefficient that adjusts the steepness of the penalty/bonus curve.
     *                       Higher values generally lead to more aggressive penalties/bonuses.
     */
    struct TokenConfig {
        uint256 thresholdWeightBps; // Target weight for the token on this chain, in BPS (1e6 = 100%)
        uint256 curveFlattener; // Coefficient to adjust penalty/bonus curve steepness
    }

    /**
     * @dev Internal struct to cache normalized balances during penalty/bonus calculation.
     *      These represent states before and after a potential transfer.
     * @param oldBalance Total supply of the synthetic token across all chains before the transfer.
     * @param newBalance Total supply of the synthetic token across all chains after the transfer.
     * @param oldTokenbalance Balance of the synthetic token on the specific chain before the transfer.
     * @param newTokenBalance Balance of the synthetic token on the specific chain after the transfer.
     */
    struct NormalizedBalances {
        uint256 oldBalance; // Total supply before transfer
        uint256 newBalance; // Total supply after transfer
        uint256 oldTokenbalance; // Chain-specific balance before transfer
        uint256 newTokenBalance; // Chain-specific balance after transfer
    }

    // Mapping: synthetic token address => chain ID => TokenConfig
    mapping(address => mapping(uint32 => TokenConfig)) private _tokenConfigs;

    uint256 internal constant MAX_CURVE_FLATTENER = 11; // Maximum allowed value for curveFlattener
    uint256 internal constant MIN_CURVE_FLATTENER = 1; // Minimum allowed value for curveFlattener
    uint256 internal constant DEFAULT_CURVE_FLATTENER = 4; // Default curveFlattener if not set explicitly
    uint256 internal constant BPS = 1e6; // Basis points denominator for percentage calculations (1,000,000 means 100%)

    /**
     * @notice Contract constructor.
     * @param _owner The address that will initially own the contract.
     */
    constructor(address _owner) Ownable(_owner) {}

    /**
     * @notice Sets or updates the configuration for a given synthetic token on a specific chain.
     * @dev Can only be called by the contract owner.
     * @param _syntheticTokenAddress The address of the synthetic token.
     * @param _chainId The chain ID for which this configuration applies.
     * @param _thresholdWeightBps The target weight for the token on this chain (e.g., 500000 for 50%). Must be <= BPS.
     * @param _curveFlattener The curve flattener coefficient. Must be between MIN_CURVE_FLATTENER and MAX_CURVE_FLATTENER.
     */
    function setTokenConfig(
        address _syntheticTokenAddress,
        uint32 _chainId,
        uint256 _thresholdWeightBps,
        uint256 _curveFlattener
    ) external onlyOwner {
        require(
            _curveFlattener >= MIN_CURVE_FLATTENER && _curveFlattener <= MAX_CURVE_FLATTENER,
            "Invalid curve flattener"
        );
        require(_thresholdWeightBps <= BPS, "Invalid threshold weight");
        _tokenConfigs[_syntheticTokenAddress][_chainId] = TokenConfig({
            thresholdWeightBps: _thresholdWeightBps,
            curveFlattener: _curveFlattener
        });
    }

    /**
     * @notice Calculates the penalty for withdrawing a certain amount of a synthetic token from a destination chain.
     * @dev The penalty aims to discourage withdrawals that would significantly unbalance the token's distribution
     *      relative to its configured threshold weight on that chain.
     * @param _tokenOut The address of the synthetic token being withdrawn.
     * @param _dstEid The endpoint ID (chain ID) of the destination chain from which tokens are withdrawn.
     * @param _currentDstChainTokenBalance The current balance of the synthetic token on the destination chain.
     * @param _amountOut The amount of the synthetic token to be withdrawn.
     * @param _chainLength The total number of chains this synthetic token is actively linked/distributed across.
     * @return uint256 The calculated penalty amount. Returns 0 if no penalty applies.
     */
    function getPenalty(
        address _tokenOut,
        uint32 _dstEid,
        uint256 _currentDstChainTokenBalance,
        uint256 _amountOut,
        uint256 _chainLength
    ) external view returns (uint256) {
        if (_chainLength == 0) {
            // No penalty if the token is not considered distributed across any chains.
            return 0;
        }
        TokenConfig memory config = _tokenConfigs[_tokenOut][_dstEid];

        // Use configured curveFlattener or default if not set (or set to 0).
        uint256 curveFlattener = config.curveFlattener > 0
            ? config.curveFlattener
            : DEFAULT_CURVE_FLATTENER;
        // Use configured thresholdWeightBps or calculate a default based on even distribution if not set (or set to 0).
        uint256 thresholdWeightBps = config.thresholdWeightBps > 0
            ? config.thresholdWeightBps
            : BPS / _chainLength; // Default assumes an even target distribution across all chains.

        uint256 _currentTotalSupply = totalSupply(_tokenOut); // Fetch current total supply of the synthetic token.

        // Populate balances before and after the potential withdrawal.
        NormalizedBalances memory cachedBalances = NormalizedBalances({
            oldBalance: _currentTotalSupply,
            newBalance: _currentTotalSupply - _amountOut, // Total supply after withdrawal
            oldTokenbalance: _currentDstChainTokenBalance, // Chain balance before withdrawal
            newTokenBalance: _currentDstChainTokenBalance - _amountOut // Chain balance after withdrawal
        });

        // Determine the ranges for penalty calculation based on threshold and balances.
        (
            uint256 penaltyFreeAmt, // Amount that can be withdrawn without penalty
            uint256 integralLowerLimit, // Lower limit for the penalty integration curve
            uint256 integralUpperLimit // Upper limit for the penalty integration curve
        ) = determineIntegralLimits(thresholdWeightBps, cachedBalances);

        if (integralUpperLimit == 0 || penaltyFreeAmt >= _amountOut) {
            // No penalty if the withdrawal does not cross into a penalty-inducing deficit,
            // or if the entire amount is covered by the penalty-free allowance.
            return 0;
        } else {
            // Amount that falls into the penalty calculation range.
            uint256 underPenaltyAmt = _amountOut - penaltyFreeAmt;
            // Calculate the amount received after the penalty is applied to `underPenaltyAmt`.
            uint256 outputWithPenalty = calculateIntegral(
                underPenaltyAmt,
                integralLowerLimit,
                integralUpperLimit,
                curveFlattener
            );
            // The penalty is the difference between the amount subject to penalty and what's received after penalty.
            return underPenaltyAmt - outputWithPenalty;
        }
    }

    /**
     * @dev Determines the limits for penalty calculation based on balance thresholds.
     * @param thresholdWeightBps The target weight of the token for the specific chain, in BPS.
     * @param cachedBalances A struct containing token balances before and after the potential withdrawal.
     * @return penaltyFreeAmt Amount that can be withdrawn without incurring a penalty.
     * @return integralLowerLimit The lower bound (as a BPS value representing deficit) for the integral calculation.
     *                            Represents the deficit level before withdrawal if already in deficit.
     * @return integralUpperLimit The upper bound (as a BPS value representing deficit) for the integral calculation.
     *                            Represents the deficit level after withdrawal.
     */
    function determineIntegralLimits(
        uint256 thresholdWeightBps,
        NormalizedBalances memory cachedBalances
    )
        internal
        pure
        returns (uint256 penaltyFreeAmt, uint256 integralLowerLimit, uint256 integralUpperLimit)
    {
        // Calculate the average (target) balance for the chain after the withdrawal, based on the new total supply.
        uint256 _newAverageThreshold = FullMath.mulDiv(
            cachedBalances.newBalance,
            thresholdWeightBps,
            BPS
        );

        // Check if the chain balance after withdrawal falls below the new target average.
        if (cachedBalances.newTokenBalance < _newAverageThreshold) {
            // If yes, a penalty might apply. Calculate the deficit severity after withdrawal (0 to BPS).
            integralUpperLimit =
                ((_newAverageThreshold - cachedBalances.newTokenBalance) * BPS) /
                _newAverageThreshold; // Deficit BPS after withdrawal, relative to the new average threshold.

            // Calculate the average (target) balance for the chain before the withdrawal.
            uint256 _currentAverageThreshold = FullMath.mulDiv(
                cachedBalances.oldBalance,
                thresholdWeightBps,
                BPS
            );

            // Check if the chain was already in deficit before the withdrawal.
            if (cachedBalances.oldTokenbalance < _currentAverageThreshold) {
                // If yes, calculate the deficit severity before withdrawal.
                integralLowerLimit =
                    ((_currentAverageThreshold - cachedBalances.oldTokenbalance) * BPS) /
                    _currentAverageThreshold; // Deficit BPS before withdrawal, relative to the current average threshold.
            } else {
                // If the chain was not in deficit, calculate how much could be withdrawn penalty-free
                // until it reaches the _currentAverageThreshold.
                // This formula calculates the amount that, when withdrawn, would bring oldTokenbalance down to _currentAverageThreshold.
                penaltyFreeAmt =
                    ((cachedBalances.oldTokenbalance - _currentAverageThreshold) * BPS) /
                    (BPS - thresholdWeightBps); // (BPS - thresholdWeightBps) accounts for the reduction in total supply due to this penaltyFreeAmt withdrawal.
            }
        } else {
            // No penalty applies if the balance after withdrawal is still at or above the target average.
            // penaltyFreeAmt, integralLowerLimit, and integralUpperLimit remain 0.
            return (0, 0, 0);
        }
        // Implicit return if inside the if block
    }

    /**
     * @notice Calculates the amount after applying a penalty based on integral limits and a curve flattener.
     * @dev This function performs an integral calculation of (1 - (x/BPS)^k)dx from a to b, scaled by `amount`.
     *      The result represents the portion of `amount` that remains after the penalty.
     *      The integral effectively calculates an average discount rate over the deficit range [a, b].
     * @param amount The initial amount before the penalty is applied (this is the portion subject to penalty, i.e., `underPenaltyAmt`).
     * @param a The lower limit of the integral's range (deficit BPS before, or 0 if not previously in deficit).
     * @param b The upper limit of the integral's range (deficit BPS after).
     * @param k The curve flattener coefficient used in calculations (adjusts (x/BPS)^k part).
     * @return amountAfterPenalty The amount remaining after the penalty is applied to the input `amount`.
     */
    function calculateIntegral(
        uint256 amount,
        uint256 a, // LowerLimit (deficit BPS, 0 to BPS)
        uint256 b, // UpperLimit (deficit BPS, 0 to BPS)
        uint256 k // curveFlattener
    ) internal pure returns (uint256 amountAfterPenalty) {
        if (b > a) {
            // Ensure integral range is valid.
            uint256 delta = (b - a); // Width of the integration range.
            uint256 kPlusOne = k + 1;
            // Integral of (x/BPS)^k is (x^(k+1)) / (BPS^k * (k+1)). We need BPS^(k-1) in denominator due to BPS constant.
            // The term (b^(k+1) - a^(k+1)) / (BPS^(k-1) * (k+1)) represents part of the integrated penalty factor, scaled.
            // It corresponds to BPS * integral of (x/BPS)^k dx = BPS * [ (x/BPS)^(k+1) / (k+1) ] from a to b
            // = (b^(k+1) - a^(k+1)) / (BPS^k * (k+1)). We have BPS^(k-1) in denominator.
            uint256 numerator = (b ** kPlusOne) - (a ** kPlusOne); // (b^(k+1) - a^(k+1))
            uint256 denominator = (BPS ** (k - 1)) * kPlusOne; // BPS^(k-1) * (k+1)

            // The formula effectively calculates: amount * (1 - average_penalty_rate_over_range)
            // average_penalty_rate_over_range is derived from the integral.
            // FullMath.mulDiv(numerator, amount, denominator) is related to total penalty value component.
            // Final formula: amount * ( (b-a)/BPS - ( integral_{a to b} (x/BPS)^k dx ) / ((b-a)/BPS) )
            // Simplified to: amount * (1 - ( (b^(k+1) - a^(k+1)) / (BPS^k * (k+1)) ) / (b-a) )
            // The implementation is: amountOut = amountIn * (1 - Integral_of_PenaltyRate)
            // Integral [ (x/BPS)^k ] dx from a/BPS to b/BPS = [ (x^(k+1)) / ((k+1)*BPS^k) ] from a to b
            // = ( b^(k+1) - a^(k+1) ) / ( (k+1) * BPS^k )
            // Average penalty rate = Integral / ( (b-a)/BPS )
            // Amount after penalty = amount * (1 - Average penalty rate)
            // This expression simplifies to the contract's implementation:
            // ( BPS * delta * amount - FullMath.mulDiv( (b^(k+1)-a^(k+1)) , amount, BPS^(k-1)*(k+1) ) ) / (delta * BPS)
            // which is amount - amount * ( (b^(k+1)-a^(k+1)) / (BPS^k * (k+1) * delta) ) if BPS is 1 unit.
            // Here, numerator = b**(k+1) - a**(k+1), amount is `amount`, denominator_for_muldiv = BPS**(k-1) * (k+1)
            // The term subtracted is: amount * [ (b**(k+1) - a**(k+1)) / (BPS**(k-1) * (k+1)) ] / (delta * BPS)
            // which is: amount * [ (b**(k+1) - a**(k+1)) / (BPS^k * (k+1) * delta) ] (This is the total penalty part if scaled by BPS)
            amountAfterPenalty =
                (BPS * delta * amount - FullMath.mulDiv(numerator, amount, denominator)) /
                (delta * BPS);
        } else {
            // If b <= a, no penalty range or invalid range, so no penalty applied to this amount.
            amountAfterPenalty = amount;
        }
    }

    /**
     * @notice Calculates the bonus for depositing a certain amount of a synthetic token to a source chain.
     * @dev The bonus aims to incentivize deposits to chains that are below their target liquidity threshold.
     *      The bonus is drawn from a pre-accumulated pool of penalties for that token on that chain.
     * @param _tokenIn The address of the synthetic token being deposited.
     * @param _srcEid The endpoint ID (chain ID) of the source chain where tokens are deposited.
     * @param _bonusBalance The total currently available bonus pool for this token on this chain.
     * @param _currentBalance The current balance of the synthetic token on the source chain (before this deposit).
     * @param _amountIn The amount of the synthetic token being deposited.
     * @param _chainLength The total number of chains this synthetic token is actively linked/distributed across.
     * @return uint256 The calculated bonus amount. Capped by `_bonusBalance`.
     */
    function getBonus(
        address _tokenIn,
        uint32 _srcEid,
        uint256 _bonusBalance, // This is the total accumulated bonus pool
        uint256 _currentBalance, // oldTokenbalance on the specific chain (before this deposit)
        uint256 _amountIn,
        uint256 _chainLength
    ) external view returns (uint256) {
        if (_chainLength == 0 || _bonusBalance == 0 || _amountIn == 0) {
            // No bonus if the token isn't considered distributed, no bonus pool exists, or no deposit amount.
            return 0;
        }

        TokenConfig memory config = _tokenConfigs[_tokenIn][_srcEid];
        // curveFlattener from config is not directly used in this bonus logic.
        // thresholdWeightBps is still used to determine the target average balance.
        uint256 thresholdWeightBps = config.thresholdWeightBps > 0
            ? config.thresholdWeightBps
            : BPS / _chainLength; // Default assumes an even target distribution.

        uint256 currentTotalSupplySystem = totalSupply(_tokenIn); // Total supply of the synthetic token BEFORE this deposit.

        // Target average balance for this chain BEFORE this deposit.
        uint256 currentAverageThresholdChain = FullMath.mulDiv(
            currentTotalSupplySystem,
            thresholdWeightBps,
            BPS
        );

        // If the chain is already at or above its target balance before this deposit, no bonus is given.
        if (_currentBalance >= currentAverageThresholdChain) {
            return 0;
        }

        // Target average balance for this chain AFTER this deposit.
        uint256 newAverageThresholdChain = FullMath.mulDiv(
            currentTotalSupplySystem + _amountIn,
            thresholdWeightBps,
            BPS
        );

        // Chain balance after this deposit.
        uint256 newTokenBalanceChain = _currentBalance + _amountIn;

        // If this deposit brings the chain balance to or above its new target average,
        // the user is eligible for the entire available bonus pool (as they fully corrected the deficit or created surplus).
        if (newTokenBalanceChain >= newAverageThresholdChain) {
            return _bonusBalance; // User gets the entire accumulated bonus pool.
        }

        // Calculate deficit severity (0 to BPS) BEFORE deposit.
        uint256 oldDeficitBps = FullMath.mulDiv(
            currentAverageThresholdChain - _currentBalance,
            BPS,
            currentAverageThresholdChain // Denominator should not be zero if _currentBalance < currentAverageThresholdChain
        );

        // Calculate deficit severity (0 to BPS) AFTER deposit.
        uint256 newDeficitBps = FullMath.mulDiv(
            newAverageThresholdChain - newTokenBalanceChain,
            BPS,
            newAverageThresholdChain // Denominator should not be zero if newTokenBalanceChain < newAverageThresholdChain
        );

        // Improvement in deficit severity (in BPS terms).
        uint256 improvementInDeficitBps = oldDeficitBps - newDeficitBps;

        // Bonus awarded is proportional to the improvement in deficit relative to the original deficit severity.
        // earnedBonus = total_available_bonus * (improvement_in_deficit_bps / original_deficit_bps)
        uint256 earnedBonus = FullMath.mulDiv(
            _bonusBalance, // The total available bonus pool for this token/chain
            improvementInDeficitBps, // How much the deficit (in BPS) was reduced
            oldDeficitBps // The original deficit (in BPS) before this deposit (cannot be 0 here due to earlier checks)
        );

        return earnedBonus;
    }

    /**
     * @dev Internal helper function to get the total supply of an ERC20 token.
     * @param token The address of the ERC20 token contract.
     * @return uint256 The total supply of the token.
     */
    function totalSupply(address token) internal view returns (uint256) {
        // Performs a staticcall to the token's `totalSupply()` function.
        bytes memory callData = abi.encodeWithSelector(ERC20.totalSupply.selector);
        (bool success, bytes memory data) = token.staticcall(callData);
        require(success && data.length >= 32, "Failed to get total supply"); // Ensure call succeeded and returned data.
        return abi.decode(data, (uint256)); // Decode the returned total supply.
    }
}
