// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { SyntheticToken } from "../SyntheticToken.sol";

library SyntheticTokenHubHelpers {
    
    function createToken(
        string memory tokenName,
        string memory symbol,
        uint8 decimals,
        uint256 tokenIndex
    ) external returns (SyntheticToken) {
        return new SyntheticToken(
            tokenName,
            symbol,
            decimals,
            tokenIndex
        );
    }
}