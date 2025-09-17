// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

library TypeCasting {
    function toBytes32(address evmAddress) internal pure returns (bytes32) {
        return bytes32(bytes20(evmAddress));
    }

    function toAddress(bytes32 commonAddress) internal pure returns (address) {
        require(commonAddress >> 20 == bytes32(0), "Bytes32 casting failed");
        return address(bytes20(commonAddress));
    }
}