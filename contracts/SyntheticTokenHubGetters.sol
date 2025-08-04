// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { ISyntheticTokenHubGetters } from "./interfaces/ISyntheticTokenHubGetters.sol";

/**
 * @title SyntheticTokenHubGetters
 * @notice A read-only contract to fetch data from a SyntheticTokenHub contract by directly reading its storage slots.
 * @dev This contract assumes a specific storage layout of the SyntheticTokenHub contract.
 * It uses `staticcall` to the `getStorageSlotData` function of the hub, which is presumed to use assembly `sload`.
 * This approach is used to retrieve data without altering the state of the hub and without needing explicit getter functions for all data in the hub itself.
 * IMPORTANT: This contract will break if the storage layout of SyntheticTokenHub changes.
 */
contract SyntheticTokenHubGetters is ISyntheticTokenHubGetters {
    // Storage slot configuration for matching SyntheticTokenHub layout
    // These constants define the specific storage slots in the SyntheticTokenHub contract
    // where particular pieces of information are stored. They are crucial for the correct functioning
    // of this getter contract, as it directly reads from these slots.

    uint256 private constant OWNER_SLOT = 0; // Slot for the _owner variable (inherited from OpenZeppelin's Ownable contract)
    uint256 private constant PEERS_SLOT = 1; // Slot for the peers mapping (inherited from LayerZero's OApp contract)
    uint256 private constant ENFORCED_OPTIONS_SLOT = 2; // Slot for the enforcedOptions mapping (inherited from LayerZero's OAppOptionsType3)
    uint256 private constant BALANCER_SLOT = 3; // Slot for the balancer address variable
    uint256 private constant SYNTHETIC_TOKENS_MAP_SLOT = 4; // Base slot for the _syntheticTokens mapping (mapping(uint256 => SyntheticTokenInfo))
    uint256 private constant REMOTE_TOKENS_MAP_SLOT = 5; // Base slot for the _remoteTokens mapping (mapping(address => mapping(uint32 => RemoteTokenInfo)))
    uint256 private constant SYNTHETIC_TOKEN_COUNT_SLOT = 6; // Slot for the _syntheticTokenCount variable
    uint256 private constant TOKEN_INDEX_MAP_SLOT = 7; // Base slot for the _tokenIndexByAddress mapping (mapping(address => uint256))
    uint256 private constant SYNTHETIC_BY_REMOTE_MAP_SLOT = 8; // Base slot for the _syntheticAddressByRemoteAddress mapping (mapping(uint32 => mapping(address => address)))
    uint256 private constant REMOTE_BY_SYNTHETIC_MAP_SLOT = 9; // Base slot for the _remoteAddressBySyntheticAddress mapping (mapping(uint32 => mapping(address => address)))
    uint256 private constant GATEWAY_VAULT_MAP_SLOT = 10; // Base slot for the _gatewayVaultByEid mapping (mapping(uint32 => address))
    uint256 private constant BONUS_BALANCE_MAP_SLOT = 11; // Base slot for the _bonusBalance mapping (mapping(address => mapping(uint32 => uint256)))

    // Synthetic token storage layout offsets
    // These constants define the offsets within a SyntheticTokenInfo struct in storage.
    // A struct's fields are typically packed into sequential storage slots if they don't fit in one.
    uint256 private constant TOKEN_ADDRESS_OFFSET = 0; // Offset for the tokenAddress field within the SyntheticTokenInfo struct storage
    uint256 private constant TOKEN_SYMBOL_OFFSET = 1; // Offset for the tokenSymbol field (assumed to be in the next slot if address takes full slot)
    uint256 private constant TOKEN_DECIMALS_OFFSET = 2; // Offset for the tokenDecimals field
    uint256 private constant TOKEN_CHAIN_LIST_OFFSET = 3; // Offset for the chainList dynamic array field

    address public immutable hub; // The address of the SyntheticTokenHub contract whose storage is being read.

    /**
     * @notice Constructor to set the SyntheticTokenHub address.
     * @param _hub The address of the deployed SyntheticTokenHub contract.
     */
    constructor(address _hub) {
        hub = _hub;
    }

    /**
     * @notice Gets the total number of synthetic tokens created in the hub.
     * @return uint256 The count of synthetic tokens.
     */
    function getSyntheticTokenCount() external view returns (uint256) {
        // Reads the storage slot corresponding to _syntheticTokenCount in SyntheticTokenHub.
        bytes32 countData = getStorageSlotData(bytes32(SYNTHETIC_TOKEN_COUNT_SLOT));
        return uint256(countData);
    }

    /**
     * @notice Retrieves information about a remote token linked to a local synthetic token on a specific chain.
     * @param _tokenAddress The address of the local synthetic token.
     * @param _eid The endpoint ID (chain ID) of the remote network.
     * @return RemoteTokenInfo A struct containing the remote token's address, decimals delta, and total balance.
     */
    function getRemoteTokenInfo(
        address _tokenAddress,
        uint32 _eid
    ) external view returns (RemoteTokenInfo memory) {
        // Delegates to an internal function to perform the storage read.
        return _getRemoteTokenInfo(_tokenAddress, _eid);
    }

    /**
     * @notice Gets the token index for a given synthetic token address.
     * @dev The token index is `_tokenIndexByAddress[tokenAddress]` in SyntheticTokenHub.
     * @param _tokenAddress The address of the synthetic token.
     * @return uint256 The index of the token (0 if not found, though other functions might require >0).
     */
    function getTokenIndexByAddress(address _tokenAddress) external view returns (uint256) {
        // Calculates the storage slot for the mapping `_tokenIndexByAddress[_tokenAddress]` and reads it.
        bytes32 indexData = getStorageSlotData(getTokenIndexSlot(_tokenAddress));
        return uint256(indexData);
    }

    /**
     * @notice Gets the remote token address linked to a local synthetic token address on a specific chain.
     * @dev Reads `_remoteAddressBySyntheticAddress[eid][syntheticAddress]` from SyntheticTokenHub.
     * @param _eid The endpoint ID (chain ID) of the remote network.
     * @param _syntheticAddress The address of the local synthetic token.
     * @return address The address of the corresponding token on the remote chain.
     */
    function getRemoteAddressBySyntheticAddress(
        uint32 _eid,
        address _syntheticAddress
    ) external view returns (address) {
        // Calculates the storage slot for the nested mapping `_remoteAddressBySyntheticAddress[eid][syntheticAddress]`.
        bytes32 baseSlot = bytes32(uint256(REMOTE_BY_SYNTHETIC_MAP_SLOT)); // Base slot of the mapping
        bytes32 eidSlot = keccak256(abi.encode(_eid, baseSlot)); // Slot for the inner mapping: mapping(address => address)
        bytes32 finalSlot = keccak256(abi.encode(_syntheticAddress, eidSlot)); // Slot for the final address value
        bytes32 data = getStorageSlotData(finalSlot);
        return address(uint160(uint256(data))); // Convert bytes32 to address
    }

    /**
     * @notice Gets the local synthetic token address linked to a remote token address on a specific chain.
     * @dev Reads `_syntheticAddressByRemoteAddress[eid][remoteAddress]` from SyntheticTokenHub.
     * @param _eid The endpoint ID (chain ID) of the remote network.
     * @param _remoteAddress The address of the token on the remote chain.
     * @return address The address of the corresponding local synthetic token.
     */
    function getSyntheticAddressByRemoteAddress(
        uint32 _eid,
        address _remoteAddress
    ) external view returns (address) {
        // Calculates the storage slot for the nested mapping `_syntheticAddressByRemoteAddress[eid][remoteAddress]`.
        bytes32 baseSlot = bytes32(uint256(SYNTHETIC_BY_REMOTE_MAP_SLOT)); // Base slot of the mapping
        bytes32 eidSlot = keccak256(abi.encode(_eid, baseSlot)); // Slot for the inner mapping: mapping(address => address)
        bytes32 finalSlot = keccak256(abi.encode(_remoteAddress, eidSlot)); // Slot for the final address value
        bytes32 data = getStorageSlotData(finalSlot);
        return address(uint160(uint256(data))); // Convert bytes32 to address
    }

    /**
     * @notice Gets the GatewayVault address for a specific endpoint ID (chain ID).
     * @dev Reads `_gatewayVaultByEid[eid]` from SyntheticTokenHub.
     * @param _eid The endpoint ID (chain ID).
     * @return address The address of the GatewayVault on the specified chain.
     */
    function getGatewayVaultByEid(uint32 _eid) external view returns (address) {
        // Calculates the storage slot for the mapping `_gatewayVaultByEid[eid]` and reads it.
        bytes32 slot = keccak256(abi.encode(_eid, GATEWAY_VAULT_MAP_SLOT));
        bytes32 data = getStorageSlotData(slot);
        return address(uint160(uint256(data))); // Convert bytes32 to address
    }

    /**
     * @notice Gets the accumulated bonus balance for a specific synthetic token on a specific chain (eid).
     * @dev Reads `_bonusBalance[tokenAddress][eid]` from SyntheticTokenHub.
     * @param _tokenAddress The address of the local synthetic token.
     * @param _eid The endpoint ID (chain ID).
     * @return uint256 The bonus balance amount.
     */
    function getBonusBalance(address _tokenAddress, uint32 _eid) external view returns (uint256) {
        // Calculates the storage slot for the nested mapping `_bonusBalance[tokenAddress][eid]`.
        // The order of hashing keys for nested mappings is important: innermost key first, then outer key with the result.
        // Slot for `_bonusBalance` is `BONUS_BALANCE_MAP_SLOT`.
        // Slot for `_bonusBalance[tokenAddress]` is `keccak256(abi.encode(_tokenAddress, BONUS_BALANCE_MAP_SLOT))`.
        // Slot for `_bonusBalance[tokenAddress][eid]` is `keccak256(abi.encode(_eid, keccak256(abi.encode(_tokenAddress, BONUS_BALANCE_MAP_SLOT))))`.
        bytes32 baseSlot = bytes32(
            uint256(
                keccak256(
                    abi.encode(_eid, keccak256(abi.encode(_tokenAddress, BONUS_BALANCE_MAP_SLOT)))
                )
            )
        );

        bytes32 data = getStorageSlotData(baseSlot);
        return uint256(data);
    }

    /**
     * @notice Returns comprehensive information about multiple synthetic tokens, including their remote counterparts.
     * @dev If `_tokenIndices` is an empty array, it attempts to fetch information for all registered synthetic tokens up to `syntheticTokenCount`.
     * Otherwise, it fetches information for the specified token indices.
     * This function iterates and calls `getSyntheticTokenInfo` for each token, potentially making many `staticcall`s.
     * @param _tokenIndices Array of token indices to get info for. If empty, returns all tokens based on `getSyntheticTokenCount()`.
     * @return SyntheticTokenView[] An array of `SyntheticTokenView` structs, each containing details of a synthetic token and its linked remote tokens.
     */
    function getSyntheticTokensInfo(
        uint256[] memory _tokenIndices
    ) external view returns (SyntheticTokenView[] memory) {
        // Get the total count of synthetic tokens if no specific indices are provided.
        uint256 syntheticTokenCount = uint256(
            getStorageSlotData(bytes32(SYNTHETIC_TOKEN_COUNT_SLOT))
        );
        // Determine the number of tokens to fetch.
        uint256 length = _tokenIndices.length > 0 ? _tokenIndices.length : syntheticTokenCount;
        SyntheticTokenView[] memory tokens = new SyntheticTokenView[](length);

        // Batch processing to potentially manage gas or call depth, though staticcalls are less of an issue here.
        // However, the main purpose of batching here is to structure the loop.
        uint256 batchSize = 10; // Defines how many tokens are processed notionally in one outer loop iteration.
        for (uint256 i = 0; i < length; i += batchSize) {
            uint256 currentBatchSize = i + batchSize > length ? length - i : batchSize;
            for (uint256 j = 0; j < currentBatchSize; j++) {
                // Determine the token index: either from the input array or by iterating from 1 to count.
                uint256 tokenIndex = _tokenIndices.length > 0 ? _tokenIndices[i + j] : i + j + 1; // Token indices are 1-based.
                tokens[i + j] = getSyntheticTokenInfo(tokenIndex);
            }
        }
        return tokens;
    }

    /**
     * @notice Returns comprehensive information about a specific synthetic token, including its remote counterparts.
     * @dev Reads various storage slots related to the `SyntheticTokenInfo` struct and its linked `RemoteTokenInfo` structs.
     * @param _tokenIndex The 1-based index of the synthetic token.
     * @return SyntheticTokenView A struct containing details of the synthetic token and its linked remote tokens.
     */
    function getSyntheticTokenInfo(
        uint256 _tokenIndex
    ) public view returns (SyntheticTokenView memory) {
        require(_tokenIndex > 0, "Invalid token index"); // Ensure token index is valid (1-based).

        // Calculate the base storage slot for the `SyntheticTokenInfo` struct in the `_syntheticTokens` mapping.
        // `_syntheticTokens` is at `SYNTHETIC_TOKENS_MAP_SLOT`.
        // Slot for `_syntheticTokens[tokenIndex]` is `keccak256(abi.encode(_tokenIndex, SYNTHETIC_TOKENS_MAP_SLOT))`.
        bytes32 baseSlot = keccak256(abi.encode(_tokenIndex, SYNTHETIC_TOKENS_MAP_SLOT));

        // Read the basic token information (address, symbol, decimals) from their respective storage slots/offsets.
        (address tokenAddress, string memory tokenSymbol, uint8 tokenDecimals) = _readTokenInfo(
            baseSlot
        );
        // Read the list of chain IDs where this token is supported/linked.
        uint32[] memory chainList = _readChainList(baseSlot);

        // Construct the SyntheticTokenInfo part of the view.
        SyntheticTokenInfo memory tokenInfo = SyntheticTokenInfo({
            tokenAddress: tokenAddress,
            tokenSymbol: tokenSymbol,
            tokenDecimals: tokenDecimals,
            chainList: chainList
        });

        // Prepare to fetch remote token information for each linked chain.
        uint256 batchSize = 5; // Batching for fetching remote token info.
        RemoteTokenView[] memory remoteTokens = new RemoteTokenView[](chainList.length);
        for (uint256 i = 0; i < chainList.length; i += batchSize) {
            uint256 currentBatchSize = i + batchSize > chainList.length
                ? chainList.length - i
                : batchSize;
            for (uint256 j = 0; j < currentBatchSize; j++) {
                uint32 eid = chainList[i + j];
                // Fetch remote token details for the current synthetic token on chain `eid`.
                RemoteTokenInfo memory remoteInfo = _getRemoteTokenInfo(tokenAddress, eid);
                remoteTokens[i + j] = RemoteTokenView({ eid: eid, remoteTokenInfo: remoteInfo });
            }
        }
        // Construct and return the complete SyntheticTokenView.
        return
            SyntheticTokenView({
                tokenIndex: _tokenIndex,
                syntheticTokenInfo: tokenInfo,
                remoteTokens: remoteTokens
            });
    }

    /**
     * @notice Gets the 1-based index of a synthetic token by its address.
     * @dev This is similar to `getTokenIndexByAddress` but includes a `require` to ensure the token is found.
     * @param _tokenAddress The address of the synthetic token.
     * @return uint256 The 1-based index of the token.
     * @custom:reverts if the token is not found (index is 0).
     */
    function getSyntheticTokenIndex(address _tokenAddress) external view returns (uint256) {
        // Calculate the storage slot for `_tokenIndexByAddress[tokenAddress]`.
        bytes32 indexData = getStorageSlotData(getTokenIndexSlot(_tokenAddress));
        uint256 index = uint256(indexData);
        require(index > 0, "Token not found"); // Ensure the token exists.
        return index;
    }

    /**
     * @notice Checks if a synthetic token is registered (i.e., has an index greater than 0).
     * @param _tokenAddress The address of the synthetic token.
     * @return bool True if the token is registered, false otherwise.
     */
    function isTokenRegistered(address _tokenAddress) external view returns (bool) {
        // Calculate the storage slot for `_tokenIndexByAddress[tokenAddress]`.
        bytes32 indexData = getStorageSlotData(getTokenIndexSlot(_tokenAddress));
        // A non-zero index means the token is registered.
        return uint256(indexData) > 0;
    }

    /**
     * @notice Gets the minimum bridge amount for a specific synthetic token on a specific chain (eid).
     * @dev Reads `minBridgeAmt` from the `RemoteTokenInfo` struct in SyntheticTokenHub.
     * @param _syntheticTokenAddress The address of the local synthetic token.
     * @param _eid The endpoint ID (chain ID).
     * @return uint256 The minimum bridge amount in synthetic token decimals.
     */
    function getMinBridgeAmount(
        address _syntheticTokenAddress,
        uint32 _eid
    ) external view returns (uint256) {
        RemoteTokenInfo memory remoteInfo = _getRemoteTokenInfo(_syntheticTokenAddress, _eid);
        return remoteInfo.minBridgeAmt;
    }

    // Helper functions to calculate storage slots

    /**
     * @dev Calculates the storage slot for an entry in the `_tokenIndexByAddress` mapping.
     * @param _tokenAddress The key for the mapping (synthetic token address).
     * @return bytes32 The calculated storage slot.
     */
    function getTokenIndexSlot(address _tokenAddress) internal pure returns (bytes32) {
        // Slot for `_tokenIndexByAddress[tokenAddress]` is `keccak256(abi.encode(key, mappingSlot))`
        return keccak256(abi.encode(_tokenAddress, TOKEN_INDEX_MAP_SLOT));
    }

    /**
     * @dev Converts a bytes32 value to a string.
     * @dev Assumes the string is left-aligned and null-terminated within the bytes32.
     * @param _bytes32 The bytes32 value to convert.
     * @return string memory The converted string.
     */
    function bytes32ToString(bytes32 _bytes32) internal pure returns (string memory) {
        uint8 i = 0;
        // Find the length of the string by looking for the first null byte or end of bytes32.
        while (i < 32 && _bytes32[i] != 0) {
            i++;
        }
        // Create a new bytes array of the exact length.
        bytes memory bytesArray = new bytes(i);
        // Copy non-null bytes to the new array.
        for (uint8 j = 0; j < i; j++) {
            bytesArray[j] = _bytes32[j];
        }
        return string(bytesArray); // Cast bytes array to string.
    }

    /**
     * @dev Internal low-level function to read a storage slot from the target `hub` contract.
     * @dev It makes a `staticcall` to the `getStorageSlotData(uint256)` function of the `hub` contract.
     * @param slot The storage slot (as bytes32, converted to uint256 for the call) to read from the `hub`.
     * @return bytes32 The data read from the storage slot.
     * @custom:reverts if the `staticcall` to the hub fails.
     */
    function getStorageSlotData(bytes32 slot) internal view returns (bytes32) {
        // Perform a staticcall to the hub's `getStorageSlotData` function.
        // This function in the hub is expected to use `sload` to read the slot.
        (bool success, bytes memory data) = hub.staticcall(
            abi.encodeWithSignature("getStorageSlotData(uint256)", uint256(slot))
        );
        require(success, "Failed to get storage data"); // Ensure the call was successful.
        // Decode the returned bytes (which should be a bytes32 value) into bytes32.
        return abi.decode(data, (bytes32));
    }

    /**
     * @dev Reads and decodes remote token information from the hub's storage.
     * @dev Assumes `RemoteTokenInfo` struct fields are `remoteAddress`, `decimalsDelta`, and `totalBalance`.
     * `remoteAddress` and `decimalsDelta` are packed into one slot, `totalBalance` is in the next.
     * @param tokenAddress The synthetic token address (key for the first level of `_remoteTokens` mapping).
     * @param eid The chain ID (key for the second level of `_remoteTokens` mapping).
     * @return RemoteTokenInfo memory A struct containing the decoded remote token information.
     */
    function _getRemoteTokenInfo(
        address tokenAddress,
        uint32 eid
    ) internal view returns (RemoteTokenInfo memory) {
        // Calculate the base storage slot for the `RemoteTokenInfo` struct.
        // `_remoteTokens` is at `REMOTE_TOKENS_MAP_SLOT`.
        // Slot for `_remoteTokens[tokenAddress]` is `keccak256(abi.encode(tokenAddress, REMOTE_TOKENS_MAP_SLOT))`.
        // Slot for `_remoteTokens[tokenAddress][eid]` is `keccak256(abi.encode(eid, keccak256(abi.encode(tokenAddress, REMOTE_TOKENS_MAP_SLOT))))`.
        bytes32 baseSlot = bytes32(
            uint256(
                keccak256(
                    abi.encode(eid, keccak256(abi.encode(tokenAddress, REMOTE_TOKENS_MAP_SLOT)))
                )
            )
        );

        // Read the first storage slot which contains `remoteAddress` and `decimalsDelta` packed together.
        bytes32 data1 = getStorageSlotData(baseSlot);
        uint256 rawValue1 = uint256(data1);

        // Extract fields based on the presumed packing order in SyntheticTokenHub's RemoteTokenInfo struct:
        // struct RemoteTokenInfo {
        //    address remoteAddress;      // 160 bits (20 bytes) - occupies bits 0-159
        //    int8 decimalsDelta;         // 8 bits (1 byte)   - occupies bits 160-167
        //    uint256 totalBalance;       // 256 bits (32 bytes) - stored entirely in the next slot (baseSlot + 1)
        //    uint256 minBridgeAmt;       // 256 bits (32 bytes) - stored entirely in the slot (baseSlot + 2)
        // }

        // 1. Extract `remoteAddress` (first 160 bits / 20 bytes of the slot).
        address remoteAddressVal = address(uint160(rawValue1)); // Lower 160 bits are the address.

        // 2. Extract `decimalsDelta` (next 8 bits, shifted right by 160 bits).
        // The value is masked with 0xFF to get the 8 bits, then cast to int8.
        int8 decimalsDeltaVal = int8(uint8((rawValue1 >> 160) & 0xFF));

        // 3. Extract `totalBalance` from the next consecutive storage slot.
        bytes32 data2 = getStorageSlotData(bytes32(uint256(baseSlot) + 1));
        uint256 totalBalanceVal = uint256(data2);

        // 4. Extract `minBridgeAmt` from the next consecutive storage slot (baseSlot + 2).
        bytes32 data3 = getStorageSlotData(bytes32(uint256(baseSlot) + 2));
        uint256 minBridgeAmtVal = uint256(data3);

        return
            RemoteTokenInfo({
                remoteAddress: remoteAddressVal,
                decimalsDelta: decimalsDeltaVal,
                totalBalance: totalBalanceVal,
                minBridgeAmt: minBridgeAmtVal
            });
    }

    /**
     * @dev Reads the `chainList` dynamic array from the `SyntheticTokenInfo` struct in storage.
     * @param baseSlot The base storage slot of the `SyntheticTokenInfo` struct for a specific token index.
     * @return uint32[] memory The list of chain IDs (eids) where the synthetic token is supported.
     * @custom:reverts if the decoded chain list length is unreasonably large (>=100) or if a chain ID is invalid (0 or >=100).
     */
    function _readChainList(bytes32 baseSlot) internal view returns (uint32[] memory) {
        // The `chainList` is a dynamic array. Its slot within the struct is `baseSlot + TOKEN_CHAIN_LIST_OFFSET`.
        // This slot (`arraySlot`) stores the length of the array.
        bytes32 arraySlot = bytes32(uint256(baseSlot) + TOKEN_CHAIN_LIST_OFFSET);
        bytes32 lengthData = getStorageSlotData(arraySlot);
        uint256 chainListLength = uint256(lengthData);

        // Sanity check for array length to prevent excessive memory allocation or reading garbage data.
        require(chainListLength < 100, "Invalid chain list length"); // Arbitrary limit, adjust if necessary.

        uint32[] memory chainList = new uint32[](chainListLength);
        if (chainListLength == 0) {
            return chainList; // Return empty array if length is zero.
        }

        // The actual data of a dynamic array starts at `keccak256(arraySlot)`.
        bytes32 dataSlotStart = keccak256(abi.encode(arraySlot));

        // Solidity packs array elements. uint32 takes 4 bytes. A storage slot is 32 bytes.
        // So, 32 / 4 = 8 `uint32` elements can fit into one storage slot.
        uint256 chainsPerSlot = 8;
        bytes32 currentChainDataSlotContent; // Holds the content of the current storage slot being read for chain data.

        for (uint256 i = 0; i < chainListLength; i++) {
            // If we've moved to a new slot for array data (or it's the first element)
            if (i % chainsPerSlot == 0) {
                // Calculate the actual storage slot for the current batch of chain IDs.
                uint256 currentDataPhysicalSlot = uint256(dataSlotStart) + (i / chainsPerSlot);
                currentChainDataSlotContent = getStorageSlotData(bytes32(currentDataPhysicalSlot));
            }

            // Extract the i-th chain ID from `currentChainDataSlotContent`.
            // Elements are packed from right to left (less significant bytes).
            // `(i % chainsPerSlot)` gives the index within the current slot (0 to 7).
            // `* 32` because each uint32 is 32 bits (4 bytes, but bitwise ops are on 256-bit words).
            // Shift right to bring the target uint32 to the rightmost position, then mask.
            uint256 shiftAmount = (i % chainsPerSlot) * 32; // bit shift amount
            uint32 chainId = uint32(
                (uint256(currentChainDataSlotContent) >> shiftAmount) & 0xFFFFFFFF
            ); // 0xFFFFFFFF is mask for uint32

            // Sanity check for chain ID validity.
            require(chainId > 0 && chainId < 100, "Invalid chain ID"); // Arbitrary limit, adjust if necessary.
            chainList[i] = chainId;
        }
        return chainList;
    }

    /**
     * @dev Reads basic token information (address, symbol, decimals) for a `SyntheticTokenInfo` struct from storage.
     * @param baseSlot The base storage slot of the `SyntheticTokenInfo` struct for a specific token index.
     * @return tokenAddress The address of the synthetic token contract.
     * @return tokenSymbol The symbol of the synthetic token.
     * @return tokenDecimals The decimals of the synthetic token.
     * @custom:reverts if the tokenAddress read is the zero address.
     */
    function _readTokenInfo(
        bytes32 baseSlot
    ) internal view returns (address tokenAddress, string memory tokenSymbol, uint8 tokenDecimals) {
        // Read `tokenAddress` from `baseSlot + TOKEN_ADDRESS_OFFSET` (offset is likely 0).
        bytes32 tokenData = getStorageSlotData(bytes32(uint256(baseSlot) + TOKEN_ADDRESS_OFFSET));
        tokenAddress = address(uint160(uint256(tokenData)));
        require(tokenAddress != address(0), "Token not found"); // Basic validation.

        // Read `tokenSymbol` from `baseSlot + TOKEN_SYMBOL_OFFSET`.
        // Strings up to 31 bytes (plus one length byte) can fit in a single slot.
        // If longer, only the first 31 bytes are here, or it's a pointer to bytes (not handled here, assumes short string).
        bytes32 symbolData = getStorageSlotData(bytes32(uint256(baseSlot) + TOKEN_SYMBOL_OFFSET));
        tokenSymbol = bytes32ToString(symbolData); // Convert bytes32 to string.

        // Read `tokenDecimals` from `baseSlot + TOKEN_DECIMALS_OFFSET`.
        // `uint8` fits comfortably in a slot.
        bytes32 decimalsData = getStorageSlotData(
            bytes32(uint256(baseSlot) + TOKEN_DECIMALS_OFFSET)
        );
        tokenDecimals = uint8(uint256(decimalsData)); // Lower 8 bits are the decimals.
    }
}
