// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

enum MessageType {
    Deposit,
    Withdraw,
    Swap,
    LinkToken,
    RevertSwap
}

struct EvmAsset {
    address tokenAddress;
    uint256 tokenAmount;
}

struct CommonAsset {
    bytes32 tokenAddress;
    uint256 tokenAmount;
}

struct EvmSwapParams {
    bytes32 from;
    bytes32 to;
    address evmAddress;
    address syntheticTokenOut;
    uint128 gasLimit;
    uint32 dstEid;
    uint256 value;
    EvmAsset[] assets;
    bytes commands;
    bytes[] inputs;
    uint256 minimumAmountOut;
}

struct CommonSwapParams {
    bytes32 from;
    bytes32 to;
    address evmAddress;
    address syntheticTokenOut;
    uint128 gasLimit;
    uint32 dstEid;
    uint256 value;
    CommonAsset[] assets;
    bytes commands;
    bytes[] inputs;
    uint256 minimumAmountOut;
}

struct EvmAvailableToken {
    bool onPause;
    address tokenAddress;
    address syntheticTokenAddress;
    int8 decimalsDelta;
    uint256 minBridgeAmt;
}

struct CommonAvailableToken {
    bool onPause;
    bytes32 tokenAddress;
    address syntheticTokenAddress;
    int8 decimalsDelta;
    uint256 minBridgeAmt;
}