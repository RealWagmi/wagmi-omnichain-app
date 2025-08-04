// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { TransferHelper } from "./libraries/TransferHelper.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { OApp, MessagingFee, Origin } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import { MessagingReceipt } from "@layerzerolabs/oapp-evm/contracts/oapp/OAppSender.sol";
import { OAppOptionsType3 } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OAppOptionsType3.sol";
import { MessageType, Asset, SwapParams, AvailableToken } from "./interfaces/ICommonStructs.sol";

// import { console } from "hardhat/console.sol";

/**
 * @title GatewayVault
 * @notice This contract acts as a gateway for users to deposit assets on a source chain,
 * which are then represented as synthetic tokens on a destination chain (via SyntheticTokenHub).
 * It handles locking of original tokens and messaging to the SyntheticTokenHub.
 * @dev Inherits from OApp for LayerZero messaging capabilities and Ownable for access control.
 */
contract GatewayVault is OApp, OAppOptionsType3 {
    using TransferHelper for address;

    /**
     * @dev Configuration structure used when linking new tokens.
     * @param onPause Whether the token is initially paused for operations.
     * @param tokenAddress The address of the original token on the source chain.
     * @param syntheticTokenDecimals The decimals of the corresponding synthetic token on the destination chain.
     * @param syntheticTokenAddress The address of the corresponding synthetic token on the destination chain.
     * @param minBridgeAmt Minimum amount for bridging this token (in original token decimals)
     */
    struct TokenSetupConfig {
        bool onPause;
        address tokenAddress; // token address on the source chain
        uint8 syntheticTokenDecimals; // decimals of the token on the destination chain
        address syntheticTokenAddress; // address of the synthetic token on the destination chain
        uint256 minBridgeAmt; // Minimum amount for bridging this token (in original token decimals)
    }

    /**
     * @dev Detailed information about an available (linked) token.
     * @param onPause Whether operations for this token are currently paused.
     * @param decimalsDelta The difference in decimals (syntheticTokenDecimals - originalTokenDecimals).
     * @param syntheticTokenAddress The address of the corresponding synthetic token on the destination chain.
     * @param tokenAddress The address of the original token on this (source) chain.
     * @param tokenDecimals The decimals of the original token on this chain.
     * @param tokenSymbol The symbol of the original token on this chain.
     * @param tokenBalance The current balance of this original token held by the GatewayVault.
     */
    struct TokenDetail {
        bool onPause;
        int8 decimalsDelta;
        address syntheticTokenAddress;
        address tokenAddress;
        uint8 tokenDecimals;
        string tokenSymbol;
        uint256 tokenBalance;
    }

    uint32 public immutable DST_EID; // Endpoint ID of the destination chain where the SyntheticTokenHub resides.
    AvailableToken[] public availableTokens; // Array storing information about tokens available for deposit/swap.
    mapping(address => uint256) private _tokenIndexPlusOne; // Mapping from original token address to its index in `availableTokens` + 1 (0 means not found).

    /**
     * @notice Constructor for the GatewayVault.
     * @param _endpoint The LayerZero endpoint address for this chain.
     * @param _delegate The owner of this contract, typically an EOA or a multisig.
     * @param _dstEid The LayerZero endpoint ID of the destination chain (where SyntheticTokenHub is).
     */
    constructor(
        address _endpoint,
        address _delegate,
        uint32 _dstEid
    ) OApp(_endpoint, _delegate) Ownable(_delegate) {
        DST_EID = _dstEid;
    }

    /**
     * @dev Emitted when a token's pause status is changed.
     * @param tokenAddress The address of the token.
     * @param onPause The new pause status (true if paused, false if unpaused).
     */
    event TokenPaused(address tokenAddress, bool onPause);
    /**
     * @dev Emitted when a cross-chain message (deposit or swap) is sent.
     * @param messageType The type of message (Deposit or Swap).
     * @param guid The LayerZero global unique identifier for the message.
     * @param from The original sender of the assets on this chain.
     * @param to The intended recipient on the destination chain.
     * @param assets Array of assets being transferred.
     */
    event MessageSent(
        MessageType messageType,
        bytes32 guid,
        address from,
        address to,
        Asset[] assets
    );
    /**
     * @dev Emitted when a cross-chain message (withdraw or swap confirmation) is received from SyntheticTokenHub.
     * @param messageType The type of message received (Withdraw or Swap).
     * @param srcEid The source endpoint ID (should be DST_EID of this vault).
     * @param guid The LayerZero global unique identifier for the message.
     * @param from The original sender on the SyntheticTokenHub chain.
     * @param to The final recipient of the assets on this chain.
     * @param assets Array of assets being released.
     */
    event MessageReceived(
        MessageType messageType,
        uint32 srcEid,
        bytes32 guid,
        address from,
        address to,
        Asset[] assets
    );
    /**
     * @dev Emitted when a revert message for a swap is received from SyntheticTokenHub.
     * @param messageType The type of message (should be RevertSwap).
     * @param guid The LayerZero GUID of the original swap message that was reverted.
     * @param from The original initiator of the swap.
     * @param reason The reason for the swap revert.
     */
    event ReceivedRevert(MessageType messageType, bytes32 guid, address from, string reason);
    /**
     * @dev Emitted when new tokens are successfully linked to the SyntheticTokenHub.
     * @param guid The LayerZero GUID of the linkTokenToHub message.
     * @param newTokens Array of tokens that were linked.
     */
    event AddNewTokens(bytes32 guid, AvailableToken[] newTokens);

    /**
     * @notice Gets the number of currently available (linked) tokens.
     * @return uint256 The count of tokens in the `availableTokens` array.
     */
    function getAvailableTokenLength() public view returns (uint256) {
        return availableTokens.length;
    }

    /**
     * @notice Retrieves detailed information for all available tokens.
     * @return TokenDetail[] An array of `TokenDetail` structs.
     */
    function getAllAvailableTokens() public view returns (TokenDetail[] memory) {
        TokenDetail[] memory availableTokenDetails = new TokenDetail[](availableTokens.length);
        for (uint256 i = 0; i < availableTokens.length; i++) {
            availableTokenDetails[i] = _getAllAvailableTokenByIndex(i);
        }
        return availableTokenDetails;
    }

    /**
     * @notice Retrieves detailed information for a specific available token by its address.
     * @param _tokenAddress The address of the original token on this chain.
     * @return TokenDetail A `TokenDetail` struct for the specified token.
     * @custom:reverts if the token is not found.
     */
    function getAllAvailableTokenByAddress(
        address _tokenAddress
    ) public view returns (TokenDetail memory) {
        uint256 _index = getTokenIndex(_tokenAddress);
        return _getAllAvailableTokenByIndex(_index);
    }

    /**
     * @notice Gets the internal index of a token in the `availableTokens` array.
     * @param _tokenAddress The address of the original token.
     * @return uint256 The 0-based index of the token.
     * @custom:reverts if the token is not found (i.e., not registered).
     */
    function getTokenIndex(address _tokenAddress) public view returns (uint256) {
        require(_tokenIndexPlusOne[_tokenAddress] > 0, "Token not found");
        return _tokenIndexPlusOne[_tokenAddress] - 1;
    }

    /**
     * @notice Pauses or unpauses operations for a specific token.
     * @dev Only callable by the owner.
     * @param _tokenAddress The address of the token to pause/unpause.
     * @param _onPause True to pause, false to unpause.
     * @custom:reverts if the token is not found.
     */
    function pauseToken(address _tokenAddress, bool _onPause) external onlyOwner {
        uint256 _index = getTokenIndex(_tokenAddress);
        availableTokens[_index].onPause = _onPause;
        emit TokenPaused(_tokenAddress, _onPause);
    }

    /**
     * @notice Links new tokens to the SyntheticTokenHub on the destination chain.
     * @dev Only callable by the owner. This sends a LayerZero message to the hub.
     * @param _tokensConfig Array of `TokenSetupConfig` structs detailing the tokens to link.
     * @param _options LayerZero messaging options (e.g., for gas payment).
     * @custom:reverts if any token in `_tokensConfig` refers to a token address that cannot provide decimals or symbol (e.g., non-ERC20Metadata).
     */
    function linkTokenToHub(
        TokenSetupConfig[] calldata _tokensConfig,
        bytes calldata _options
    ) external payable onlyOwner {
        AvailableToken[] memory newTokens = _setupConfigToAvailableToken(_tokensConfig);
        for (uint256 i = 0; i < newTokens.length; i++) {
            availableTokens.push(newTokens[i]);
            _tokenIndexPlusOne[newTokens[i].tokenAddress] = availableTokens.length;
        }
        bytes memory msgData = abi.encode(newTokens);
        bytes memory payload = abi.encode(MessageType.LinkToken, msgData);
        MessagingReceipt memory receipt = _lzSend(
            DST_EID,
            payload,
            _options,
            MessagingFee(msg.value, 0),
            payable(msg.sender)
        );
        emit AddNewTokens(receipt.guid, newTokens);
    }

    /**
     * @notice Deposits assets to be bridged to the destination chain.
     * @dev User must have approved this contract to spend their tokens.
     * Tokens are transferred to this contract, and a LayerZero message is sent to SyntheticTokenHub.
     * @param _recepient The recipient address on the destination chain.
     * @param _assets Array of `Asset` structs specifying tokens and amounts to deposit.
     * @param _options LayerZero messaging options.
     * @return MessagingReceipt The receipt for the LayerZero message.
     * @custom:reverts if any token is paused, amount is too small after dust removal, or token not found.
     */
    function deposit(
        address _recepient,
        Asset[] calldata _assets,
        bytes calldata _options
    ) external payable returns (MessagingReceipt memory) {
        Asset[] memory assets = _checkAndTransform(_assets);
        bytes memory msgData = abi.encode(msg.sender, _recepient, assets);
        bytes memory payload = abi.encode(MessageType.Deposit, msgData);
        return _sendCrossChainMessage(payload, _options, _recepient, assets);
    }

    /**
     * @notice Initiates a cross-chain swap.
     * @dev User must have approved this contract to spend their tokens.
     * Tokens are transferred to this contract. A LayerZero message containing swap parameters and assets
     * is sent to the SyntheticTokenHub for processing.
     * @param _swapParams Parameters for the swap (recipient, destination EID, commands, inputs, etc.).
     * @param _options LayerZero messaging options.
     * @param _assets Array of `Asset` structs specifying input tokens and amounts for the swap.
     * @return MessagingReceipt The receipt for the LayerZero message.
     * @custom:reverts if any token is paused, amount is too small after dust removal, or token not found.
     */
    function swap(
        SwapParams memory _swapParams,
        bytes calldata _options,
        Asset[] calldata _assets
    ) external payable returns (MessagingReceipt memory) {
        Asset[] memory assets = _checkAndTransform(_assets);
        _swapParams.from = msg.sender;
        _swapParams.assets = assets;
        bytes memory msgData = abi.encode(_swapParams);
        bytes memory payload = abi.encode(MessageType.Swap, msgData);
        return _sendCrossChainMessage(payload, _options, _swapParams.to, assets);
    }

    /**
     * @notice Quotes the LayerZero messaging fee for linking new tokens.
     * @param _tokensConfigs Array of `TokenSetupConfig` for tokens to be linked.
     * @param _options LayerZero messaging options.
     * @return nativeFee The estimated native gas fee for the LayerZero message.
     */
    function quoteLinkTokenToHub(
        TokenSetupConfig[] calldata _tokensConfigs,
        bytes calldata _options
    ) public view returns (uint256 nativeFee) {
        AvailableToken[] memory newTokens = _setupConfigToAvailableToken(_tokensConfigs);
        bytes memory msgData = abi.encode(newTokens);
        bytes memory payload = abi.encode(MessageType.LinkToken, msgData);
        nativeFee = (_quote(DST_EID, payload, _options, false)).nativeFee;
    }

    /**
     * @notice Quotes the LayerZero messaging fee for a deposit operation.
     * @param _recepient The recipient address on the destination chain.
     * @param _assets Array of `Asset` structs for the deposit.
     * @param _options LayerZero messaging options.
     * @return nativeFee The estimated native gas fee for the LayerZero message.
     */
    function quoteDeposit(
        address _recepient,
        Asset[] calldata _assets,
        bytes calldata _options
    ) public view returns (uint256 nativeFee) {
        Asset[] memory assets = _checkAndTransform(_assets);
        bytes memory msgData = abi.encode(_recepient, _recepient, assets);
        bytes memory payload = abi.encode(MessageType.Deposit, msgData);
        nativeFee = (_quote(DST_EID, payload, _options, false)).nativeFee;
    }

    /**
     * @notice Quotes the LayerZero messaging fee for a swap operation.
     * @param _swapParams Parameters for the swap.
     * @param _options LayerZero messaging options.
     * @param _assets Array of `Asset` structs for the swap input.
     * @return nativeFee The estimated native gas fee for the LayerZero message.
     */
    function quoteSwap(
        SwapParams memory _swapParams,
        bytes calldata _options,
        Asset[] calldata _assets
    ) public view returns (uint256 nativeFee) {
        _swapParams.assets = _checkAndTransform(_assets);
        bytes memory msgData = abi.encode(_swapParams);
        bytes memory payload = abi.encode(MessageType.Swap, msgData);
        nativeFee = (_quote(DST_EID, payload, _options, false)).nativeFee;
    }

    /**
     * @dev Converts an array of `TokenSetupConfig` to `AvailableToken` structs.
     * Fetches token decimals and calculates `decimalsDelta`.
     * @param _tokensConfig Input array of token configurations.
     * @return _availableTokens Array of `AvailableToken` structs.
     * @custom:reverts if a token address does not support IERC20Metadata (cannot fetch decimals).
     */
    function _setupConfigToAvailableToken(
        TokenSetupConfig[] calldata _tokensConfig
    ) internal view returns (AvailableToken[] memory _availableTokens) {
        _availableTokens = new AvailableToken[](_tokensConfig.length);

        for (uint256 i = 0; i < _tokensConfig.length; i++) {
            uint8 tokenDecimals = IERC20Metadata(_tokensConfig[i].tokenAddress).decimals();
            AvailableToken memory _availableToken = AvailableToken({
                onPause: _tokensConfig[i].onPause,
                tokenAddress: _tokensConfig[i].tokenAddress,
                syntheticTokenAddress: _tokensConfig[i].syntheticTokenAddress,
                decimalsDelta: int8(_tokensConfig[i].syntheticTokenDecimals) - int8(tokenDecimals),
                minBridgeAmt: _tokensConfig[i].minBridgeAmt
            });
            _availableTokens[i] = _availableToken;
        }
    }

    /**
     * @dev Internal function to transfer assets from user and send a LayerZero message.
     * @param _payload The already encoded LayerZero message payload.
     * @param _options LayerZero messaging options.
     * @param _recepient The recipient address on the destination chain (for event emission).
     * @param _assets Array of assets being transferred (after processing, for event and transfer).
     * @return receipt The LayerZero messaging receipt.
     */
    function _sendCrossChainMessage(
        bytes memory _payload,
        bytes memory _options,
        address _recepient,
        Asset[] memory _assets
    ) internal returns (MessagingReceipt memory receipt) {
        _transferBatch(_assets);
        receipt = _lzSend(
            DST_EID,
            _payload,
            _options,
            MessagingFee(msg.value, 0),
            payable(msg.sender)
        );
        emit MessageSent(MessageType.Swap, receipt.guid, msg.sender, _recepient, _assets);
    }

    /**
     * @dev Internal LayerZero message receiving function.
     * Handles incoming messages from the paired SyntheticTokenHub.
     * @param _origin Details of the LayerZero message origin.
     * @param _guid The unique identifier of the LayerZero message.
     * @param _payload The raw payload of the LayerZero message.
     * @custom:reverts if the message source EID is not the configured `DST_EID` (i.e., not from the expected hub).
     */
    function _lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _payload,
        address /*_executor*/,
        bytes calldata /*_extraData*/
    ) internal override {
        require(_origin.srcEid == DST_EID, "!DST_EID");

        (MessageType messageType, bytes memory payload) = abi.decode(
            _payload,
            (MessageType, bytes)
        );

        if (messageType == MessageType.Withdraw || messageType == MessageType.Swap) {
            _processMessage(messageType, payload, _guid, _origin.srcEid);
        } else if (messageType == MessageType.RevertSwap) {
            _processMessageRevertSwap(messageType, payload);
        }
    }

    /**
     * @dev Processes a RevertSwap message from the SyntheticTokenHub.
     * This means a swap initiated by a user failed on the hub, and the original assets are being returned.
     * @param messageType The type of message (should be `MessageType.RevertSwap`).
     * @param _payload The decoded payload specific to RevertSwap.
     */
    function _processMessageRevertSwap(MessageType messageType, bytes memory _payload) internal {
        (
            address _from,
            address _to,
            Asset[] memory _assets,
            bytes32 _guid,
            string memory _reason
        ) = abi.decode(_payload, (address, address, Asset[], bytes32, string));

        for (uint256 i = 0; i < _assets.length; i++) {
            Asset memory _asset = _assets[i];
            _asset.tokenAddress.safeTransfer(_to, _asset.tokenAmount);
        }
        emit ReceivedRevert(messageType, _guid, _from, _reason);
    }

    /**
     * @dev Processes Withdraw or Swap (confirmation) messages from the SyntheticTokenHub.
     * These messages indicate that assets should be released from this vault to a recipient.
     * @param messageType The type of message (`MessageType.Withdraw` or `MessageType.Swap`).
     * @param _payload The decoded payload containing from, to, and assets.
     * @param _guid The LayerZero GUID of the incoming message.
     * @param _srcEid The source EID of the message (should be `DST_EID`).
     */
    function _processMessage(
        MessageType messageType,
        bytes memory _payload,
        bytes32 _guid,
        uint32 _srcEid
    ) internal {
        (address _from, address _to, Asset[] memory _assets) = abi.decode(
            _payload,
            (address, address, Asset[])
        );

        for (uint256 i = 0; i < _assets.length; i++) {
            Asset memory _asset = _assets[i];
            _asset.tokenAddress.safeTransfer(_to, _asset.tokenAmount);
        }
        emit MessageReceived(messageType, _srcEid, _guid, _from, _to, _assets);
    }

    /**
     * @dev Transfers a batch of assets from the `msg.sender` to this contract.
     * @param _assets Array of `Asset` structs specifying tokens and amounts to transfer.
     * @custom:reverts if any token transfer fails (e.g., insufficient allowance or balance).
     */
    function _transferBatch(Asset[] memory _assets) internal {
        for (uint256 i = 0; i < _assets.length; i++) {
            Asset memory _asset = _assets[i];
            _asset.tokenAddress.safeTransferFrom(msg.sender, address(this), _asset.tokenAmount);
        }
    }

    /**
     * @dev Removes dust from a token amount based on the decimals delta.
     * This is used to ensure that when an amount is bridged or processed,
     * it doesn't create an amount on the destination with more precision than intended,
     * effectively truncating to the coarser decimal representation if `_decimalsDelta` is negative.
     * @param _amount The original amount.
     * @param _decimalsDelta The difference: synthetic token decimals - original token decimals.
     *                       A negative delta means the original token has more decimals than the synthetic.
     * @return uint256 The amount after dust removal. If `_decimalsDelta` is non-negative, returns original amount.
     */
    function _removeDust(uint256 _amount, int8 _decimalsDelta) internal pure returns (uint256) {
        if (_decimalsDelta < 0) {
            uint8 absDecimalsDelta = uint8(-_decimalsDelta);
            uint256 divisor = 10 ** absDecimalsDelta;
            return (_amount / divisor) * divisor;
        }
        return _amount;
    }

    /**
     * @dev Internal view function to get detailed information for a token by its index in `availableTokens`.
     * @param _index The 0-based index of the token in the `availableTokens` array.
     * @return TokenDetail A `TokenDetail` struct populated with information.
     */
    function _getAllAvailableTokenByIndex(
        uint256 _index
    ) private view returns (TokenDetail memory) {
        AvailableToken memory avToken = availableTokens[_index];
        address tokenAddress = avToken.tokenAddress;

        return
            TokenDetail({
                onPause: avToken.onPause,
                decimalsDelta: avToken.decimalsDelta,
                syntheticTokenAddress: avToken.syntheticTokenAddress,
                tokenAddress: tokenAddress,
                tokenDecimals: IERC20Metadata(tokenAddress).decimals(),
                tokenSymbol: IERC20Metadata(tokenAddress).symbol(),
                tokenBalance: IERC20(tokenAddress).balanceOf(address(this))
            });
    }

    /**
     * @dev Internal view function to check token status (not paused), remove dust from amounts,
     * and transform input `Asset` array for further processing.
     * @param _assets Array of `Asset` structs (calldata) with user-provided amounts.
     * @return assets Array of `Asset` structs (memory) with original token addresses and dust-removed amounts.
     * @custom:reverts if a token is not found, is paused, or if amount becomes zero after dust removal.
     */
    function _checkAndTransform(
        Asset[] calldata _assets
    ) internal view returns (Asset[] memory assets) {
        assets = new Asset[](_assets.length);

        for (uint256 i = 0; i < _assets.length; i++) {
            Asset calldata _assetEntry = _assets[i];
            uint256 _index = getTokenIndex(_assetEntry.tokenAddress);
            AvailableToken memory _availableToken = availableTokens[_index];
            require(!_availableToken.onPause, "Token is paused");

            if (_assetEntry.tokenAmount < _availableToken.minBridgeAmt) {
                revert("Amount is less than minimum bridge amount for this token.");
            }

            uint256 _amount = _removeDust(_assetEntry.tokenAmount, _availableToken.decimalsDelta);
            require(_amount > 0, "Amount is too small");

            assets[i] = Asset({ tokenAddress: _availableToken.tokenAddress, tokenAmount: _amount });
        }
    }
}
