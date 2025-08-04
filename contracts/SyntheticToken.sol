// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ISyntheticToken } from "./interfaces/ISyntheticToken.sol";

/**
 * @title SyntheticToken
 * @notice Implementation of synthetic token for cross-chain operations
 */
contract SyntheticToken is ERC20, Ownable, ISyntheticToken {
    uint8 private _decimals;
    uint256 public tokenIndex;

    /**
     * @param _name Token name
     * @param _symbol Token symbol
     * @param _tokenDecimals Token decimals
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _tokenDecimals,
        uint256 _tokenIndex
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        _decimals = _tokenDecimals;
        tokenIndex = _tokenIndex;
    }

    /**
     * @notice Returns the number of decimals used by the token
     * @return The token decimals
     */
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Mint new tokens (owner only)
     * @param _to Token recipient
     * @param _amount Token amount
     */
    function mint(address _to, uint256 _amount) external override onlyOwner {
        _mint(_to, _amount);
    }

    /**
     * @notice Burn tokens (owner only)
     * @param _from Address from which tokens are burned
     * @param _amount Token amount
     */
    function burn(address _from, uint256 _amount) external override onlyOwner {
        _burn(_from, _amount);
    }
}
