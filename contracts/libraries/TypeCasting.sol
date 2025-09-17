// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import "hardhat/console.sol";

library TypeCasting {
    function toBytes32(address evmAddress) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(evmAddress)));
    }

    function toAddress(bytes32 commonAddress) internal view returns (address) {
        require(commonAddress >> 160 == bytes32(0), "Bytes32 casting failed");
        return address(uint160(uint256(commonAddress)));
    }    
}