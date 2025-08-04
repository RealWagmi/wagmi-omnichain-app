// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

enum MessageType {
    Deposit,
    Withdraw,
    Swap,
    LinkToken,
    RevertSwap
}

struct Asset {
    address tokenAddress;
    uint256 tokenAmount;
}

struct SwapParams {
    address from;
    address to;
    address syntheticTokenOut;
    uint128 gasLimit;
    uint32 dstEid;
    uint256 value;
    Asset[] assets;
    bytes commands;
    bytes[] inputs;
    uint256 minimumAmountOut;
}

struct AvailableToken {
    bool onPause;
    address tokenAddress;
    address syntheticTokenAddress;
    int8 decimalsDelta;
    uint256 minBridgeAmt;
}
