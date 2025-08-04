// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ISyntheticToken
 * @notice Interface for synthetic tokens managed by SyntheticTokenHub
 */
interface ISyntheticToken is IERC20 {
    /**
     * @notice Returns the token index
     * @return The token index
     */
    function tokenIndex() external view returns (uint256);

    /**
     * @notice Mint new tokens
     * @param _to Token recipient
     * @param _amount Token amount
     */
    function mint(address _to, uint256 _amount) external;

    /**
     * @notice Burn tokens
     * @param _from Address from which tokens are burned
     * @param _amount Token amount
     */
    function burn(address _from, uint256 _amount) external;
}
