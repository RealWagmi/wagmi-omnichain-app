// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

library TransferHelper {
    /// @notice Transfers tokens from the targeted address to the given destination
    /// @notice Errors with 'STF' if transfer fails
    /// @param token The contract address of the token to be transferred
    /// @param from The originating address from which the tokens will be transferred
    /// @param to The destination address of the transfer
    /// @param value The amount to be transferred
    function safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(ERC20.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "STF");
    }

    /// @notice Transfers tokens from msg.sender to a recipient
    /// @dev Errors with ST if transfer fails
    /// @param token The contract address of the token which will be transferred
    /// @param to The recipient of the transfer
    /// @param value The value of the transfer
    function safeTransfer(address token, address to, uint256 value) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(ERC20.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ST");
    }

    function getBalance(address token) internal view returns (uint256 balance) {
        bytes memory callData = abi.encodeWithSelector(ERC20.balanceOf.selector, address(this));
        (bool success, bytes memory data) = token.staticcall(callData);
        require(success && data.length >= 32);
        balance = abi.decode(data, (uint256));
    }

    function getBalanceOf(address token, address target) internal view returns (uint256 balance) {
        bytes memory callData = abi.encodeWithSelector(ERC20.balanceOf.selector, target);
        (bool success, bytes memory data) = token.staticcall(callData);
        require(success && data.length >= 32);
        balance = abi.decode(data, (uint256));
    }

    function decimals(address token) internal view returns (uint8) {
        bytes memory callData = abi.encodeWithSelector(ERC20.decimals.selector);
        (bool success, bytes memory data) = token.staticcall(callData);
        require(success && data.length == 32);
        return abi.decode(data, (uint8));
    }

    function safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(ERC20.approve.selector, spender, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SA");
    }
}
