// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import { TransferHelper } from "./libraries/TransferHelper.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { OApp, MessagingFee, Origin } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import { MessagingReceipt } from "@layerzerolabs/oapp-evm/contracts/oapp/OAppSender.sol";
import { OAppOptionsType3 } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OAppOptionsType3.sol";
import { ISyntheticToken } from "./interfaces/ISyntheticToken.sol";
import { SyntheticToken } from "./SyntheticToken.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import { IBalancer } from "./interfaces/IBalancer.sol";
import { MessageType, Asset, SwapParams, AvailableToken } from "./interfaces/ICommonStructs.sol";

// import { console } from "hardhat/console.sol";

/**
 * @title SyntheticTokenHub
 * @notice Central contract managing synthetic tokens for cross-chain interaction
 * @dev This contract receives deposits from other networks via GatewayVault and mints synthetic tokens
 */
contract SyntheticTokenHub is OApp, OAppOptionsType3 {
    using TransferHelper for address;
    using OptionsBuilder for bytes;

    /**
     * @dev Represents an asset entry with token index and amount.
     */
    struct AssetEntry {
        uint256 tokenIndex; // Index of the token
        uint256 tokenAmount; // Amount of the token
    }

    /**
     * @dev Stores information about a synthetic token.
     */
    struct SyntheticTokenInfo {
        address tokenAddress; // Address of the synthetic token contract
        string tokenSymbol; // Symbol of the synthetic token
        uint8 tokenDecimals; // Decimals of the synthetic token
        uint32[] chainList; // List of supported chains for this synthetic token
    }

    /**
     * @dev Stores information about a remote token linked to a synthetic token.
     */
    struct RemoteTokenInfo {
        address remoteAddress; // Address of the token on the remote chain
        int8 decimalsDelta; // Difference in decimals between the synthetic token and the remote token
        uint256 totalBalance; // Total balance of this token on the remote chain, from the perspective of this hub
        uint256 minBridgeAmt; // Minimum amount for bridging this token (in synthetic token decimals)
    }

    address public immutable uniswapUniversalRouter; // Address of the Uniswap Universal Router
    address public immutable uniswapPermitV2; // Address of the Uniswap Permit2 contract
    address public balancer; // Address of the Balancer contract for penalty/bonus calculations

    // Synthetic tokens registry
    // @dev Mapping from token index to synthetic token information.
    mapping(uint256 => SyntheticTokenInfo) private _syntheticTokens;
    // @dev Mapping from local synthetic token address to its remote token information per endpoint ID (eid).
    mapping(address => mapping(uint32 => RemoteTokenInfo)) private _remoteTokens; // token address => eid => RemoteTokenInfo
    uint256 private _syntheticTokenCount; // Counter for the number of synthetic tokens created

    // Mapping for token lookup: tokenAddress => tokenIndex + 1 (0 means not found)
    // @dev Mapping from synthetic token address to its index.
    mapping(address => uint256) private _tokenIndexByAddress;

    // Mapping for token lookup by network and remote address
    // @dev Mapping from endpoint ID (eid) and remote token address to the corresponding local synthetic token address.
    mapping(uint32 => mapping(address => address)) private _syntheticAddressByRemoteAddress; // eid => remote address => token address
    // Mapping for token lookup by network and synthetic address
    // @dev Mapping from endpoint ID (eid) and local synthetic token address to the corresponding remote token address.
    mapping(uint32 => mapping(address => address)) private _remoteAddressBySyntheticAddress; // eid => token address => remote address
    // @dev Mapping from endpoint ID (eid) to the GatewayVault contract address on that chain.
    mapping(uint32 => address) private _gatewayVaultByEid; // eid => gateway vault address
    // @dev Mapping from synthetic token address and endpoint ID (eid) to the bonus balance accumulated.
    mapping(address => mapping(uint32 => uint256)) private _bonusBalance; // token address => eid => bonus balance

    // Add constant for the base token name
    string public constant TOKEN_NAME_PREFIX = "Synthetic "; // Prefix for synthetic token names
    uint256 public constant MAX_PENALTY_BP = 500; // Maximum penalty in basis points (5%)
    uint256 public constant BP = 10000; // Basis points denominator

    // Events
    /**
     * @dev Emitted when a new synthetic token is added.
     * @param tokenIndex The index of the newly added synthetic token.
     * @param tokenAddress The address of the newly added synthetic token.
     * @param symbol The symbol of the newly added synthetic token.
     * @param decimals The decimals of the newly added synthetic token.
     */
    event SyntheticTokenAdded(
        uint256 indexed tokenIndex,
        address tokenAddress,
        string symbol,
        uint8 decimals
    );
    /**
     * @dev Emitted when remote tokens are linked to synthetic tokens.
     * @param availableTokens Array of available tokens that were linked.
     * @param gatewayVault The address of the GatewayVault contract on the remote chain.
     * @param eid The endpoint ID of the remote chain.
     */
    event RemoteTokenLinked(AvailableToken[] availableTokens, address gatewayVault, uint32 eid);
    /**
     * @dev Emitted when synthetic tokens are minted.
     * @param tokenIndex The index of the synthetic token minted.
     * @param recipient The address that received the minted tokens.
     * @param amount The amount of tokens minted.
     * @param sourceEid The endpoint ID of the source chain from which the deposit originated.
     */
    event TokenMinted(
        uint256 indexed tokenIndex,
        address recipient,
        uint256 amount,
        uint32 sourceEid
    );
    /**
     * @dev Emitted when synthetic tokens are burned for bridging.
     * @param dstEid The destination endpoint ID.
     * @param assets Array of assets (token addresses and amounts) that were burned.
     */
    event TokenBurned(uint32 dstEid, Asset[] assets);
    /**
     * @dev Emitted when a LayerZero message is sent.
     * @param dstEid The destination endpoint ID.
     * @param guid The LayerZero message GUID.
     * @param from The address initiating the message.
     * @param to The recipient address on the destination chain.
     * @param assets Array of assets being transferred.
     * @param penalties Array of penalties applied to each asset.
     */
    event MessageSent(
        uint32 dstEid,
        bytes32 guid,
        address from,
        address to,
        Asset[] assets,
        uint256[] penalties
    );
    /**
     * @dev Emitted when a LayerZero message is received and processed.
     * @param guid The LayerZero message GUID.
     * @param from The original sender address from the source chain.
     * @param to The recipient address on the current chain.
     * @param assets Array of assets received.
     * @param srcEid The source endpoint ID from which the message originated.
     */
    event MessageReceived(bytes32 guid, address from, address to, Asset[] assets, uint32 srcEid);

    constructor(
        address _endpoint,
        address _owner,
        address _uniswapUniversalRouter,
        address _uniswapPermitV2,
        address _balancer
    ) OApp(_endpoint, _owner) Ownable(_owner) {
        uniswapUniversalRouter = _uniswapUniversalRouter;
        uniswapPermitV2 = _uniswapPermitV2;
        balancer = _balancer;
    }

    // Custom Errors
    error Permit2ApprovalFailed();
    error SyntheticTokenNotFound();
    error RemoteTokenAlreadyLinked(
        address syntheticToken,
        uint32 eid,
        address attemptedRemoteToken
    );
    error InvalidLzReceiveSender(address actualSender, address expectedSender);
    error InvalidMessageType();
    error InsufficientValue(uint256 provided, uint256 required);
    error TokenNotLinkedToDestChain(address syntheticToken, uint32 dstEid);
    error AmountIsTooSmall();
    error InsufficientBalanceOnDestChain(
        address syntheticToken,
        uint32 dstEid,
        uint256 amountRequired,
        uint256 currentBalance
    );
    error InvalidSwapSender();
    error SwapFailed(string reason);
    error AmountLessThanMinBridgeAmount(
        address tokenAddress,
        uint32 eid,
        uint256 amount,
        uint256 minAmount
    );

    /**
     * @notice Sets the balancer address
     * @param _balancer Balancer address
     */
    function setBalancer(address _balancer) external onlyOwner {
        balancer = _balancer;
    }

    /**
     * @notice Creates and adds a new synthetic token
     * @param _symbol Token symbol
     * @param _decimals Token decimals
     */
    function createSyntheticToken(string memory _symbol, uint8 _decimals) external onlyOwner {
        // Deploy new synthetic token
        string memory tokenName = string(abi.encodePacked(TOKEN_NAME_PREFIX, _symbol));

        // Create token (hub will automatically be the owner)
        ++_syntheticTokenCount;
        uint256 tokenIndex = _syntheticTokenCount;
        SyntheticToken syntheticToken = new SyntheticToken(
            tokenName,
            _symbol,
            _decimals,
            tokenIndex
        );
        address tokenAddress = address(syntheticToken);

        SyntheticTokenInfo storage tokenInfo = _syntheticTokens[tokenIndex];
        tokenInfo.tokenAddress = tokenAddress;
        tokenInfo.tokenSymbol = _symbol;
        tokenInfo.tokenDecimals = _decimals;

        // Add token to lookup mapping
        _tokenIndexByAddress[tokenAddress] = tokenIndex;

        tokenAddress.safeApprove(uniswapPermitV2, type(uint256).max);

        (bool success, ) = uniswapPermitV2.call(
            abi.encodeWithSignature(
                "approve(address,address,uint160,uint48)",
                tokenAddress,
                uniswapUniversalRouter,
                type(uint160).max, // amount (does not decrease)
                type(uint48).max // deadline
            )
        );
        if (!success) {
            revert Permit2ApprovalFailed();
        }

        emit SyntheticTokenAdded(tokenIndex, tokenAddress, _symbol, _decimals);
    }

    /**
     * @notice Burns multiple synthetic tokens and sends the corresponding tokens to the specified network
     * @param _recipient Recipient address in the destination network
     * @param _assets Array of token indices and amounts to burn
     * @param _dstEid Destination network identifier
     * @param _options LayerZero transaction options
     */
    function bridgeTokens(
        address _recipient,
        Asset[] memory _assets,
        uint32 _dstEid,
        bytes calldata _options
    ) external payable returns (MessagingReceipt memory receipt) {
        // Validate and prepare assets (view operation)
        (Asset[] memory assetsRemote, uint256[] memory penalties) = validateAndPrepareAssets(
            _assets,
            _dstEid,
            false // Enforce minBridgeAmt check for regular bridge
        );

        for (uint256 i = 0; i < assetsRemote.length; i++) {
            address syntheticTokenAddress = _assets[i].tokenAddress;
            _bonusBalance[syntheticTokenAddress][_dstEid] += penalties[i];
        }

        // Burn tokens and update balances (state-changing operation)
        _burnTokens(_assets, _dstEid, msg.sender);

        // Encode data for sending
        bytes memory msgData = abi.encode(msg.sender, _recipient, assetsRemote);
        bytes memory payload = abi.encode(MessageType.Withdraw, msgData);

        // Send message
        receipt = _lzSend(
            _dstEid,
            payload,
            _options,
            MessagingFee(msg.value, 0),
            payable(msg.sender)
        );

        emit MessageSent(_dstEid, receipt.guid, msg.sender, _recipient, _assets, penalties);

        return receipt;
    }

    /**
     * @notice Calculates the cost of sending a message for multiple token burning
     * @param _recipient Recipient address
     * @param _assets Array of token indices and amounts
     * @param _dstEid Destination network
     * @param _options LayerZero transaction options
     * @return nativeFee Cost in native currency
     * @return assetsRemote Array of assets to send
     * @return penalties Array of penalties
     */
    function quoteBridgeTokens(
        address _recipient,
        Asset[] memory _assets,
        uint32 _dstEid,
        bytes calldata _options
    )
        public
        view
        returns (uint256 nativeFee, Asset[] memory assetsRemote, uint256[] memory penalties)
    {
        (assetsRemote, penalties) = validateAndPrepareAssets(_assets, _dstEid, false); // Enforce minBridgeAmt check for quote

        bytes memory msgData = abi.encode(_recipient, _recipient, assetsRemote);
        bytes memory payload = abi.encode(MessageType.Withdraw, msgData);
        nativeFee = (_quote(_dstEid, payload, _options, false)).nativeFee;
    }

    /**
     * @notice Quotes the LayerZero messaging fee for a swap operation.
     * @dev This function estimates the fee required for both the swap execution message and a potential revert message.
     * @param _recipient The final recipient address on the destination chain.
     * @param _assetsIn Array of assets being swapped in on the source chain.
     * @param syntheticTokenOut The synthetic token being swapped out on this hub (destination of swap).
     * @param srcEid The source endpoint ID where the swap originates.
     * @param dstEid The destination endpoint ID where the swapped tokens are sent after processing on this hub.
     * @param options LayerZero messaging options.
     * @return The maximum of the fee for the swap message and the revert message.
     */
    function quoteSwap(
        address _recipient,
        Asset[] calldata _assetsIn,
        address syntheticTokenOut,
        uint32 srcEid,
        uint32 dstEid,
        bytes calldata options
    ) public view returns (uint256) {
        bytes32 _guid = bytes32(uint256(uint160(_recipient)));

        // Prepare payload for a potential revert message
        bytes memory msgDataRevert = abi.encode(
            _recipient, // from
            _recipient, // to
            _assetsIn,
            _guid,
            "THIS_IS_FAKE_ERROR_MESSAGE" // Mock error message
        );
        bytes memory payloadRevert = abi.encode(MessageType.RevertSwap, msgDataRevert);

        // Prepare payload for the swap message
        Asset[] memory _assetsOut = new Asset[](1);
        _assetsOut[0] = Asset({ tokenAddress: syntheticTokenOut, tokenAmount: 1 }); // Mock amount, actual amount determined during swap
        bytes memory msgDataSwap = abi.encode(_recipient, _recipient, _assetsOut); // Note: _recipient is used twice as per original logic
        bytes memory payloadSwap = abi.encode(MessageType.Swap, msgDataSwap);

        // Quote fees for both scenarios
        uint256 feeRevert = (_quote(dstEid, payloadRevert, options, false)).nativeFee;
        uint256 feeSwap = (_quote(srcEid, payloadSwap, options, false)).nativeFee; // Fee for message from hub to srcEid for swap execution
        return feeRevert > feeSwap ? feeRevert : feeSwap; // Return the higher fee
    }

    /**
     * @notice Calculates potential bonuses for a batch of assets from a source chain.
     * @param _assets Array of assets from the source chain (remote token addresses and amounts).
     * @param _srcEid The source network identifier.
     * @return bonuses Array of bonus amounts for each asset.
     */
    function calculateBonuses(
        Asset[] memory _assets,
        uint32 _srcEid
    ) external view returns (uint256[] memory bonuses) {
        uint256 length = _assets.length;
        bonuses = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            Asset memory asset = _assets[i];
            address syntheticTokenAddress = _syntheticAddressByRemoteAddress[_srcEid][
                asset.tokenAddress
            ];
            if (syntheticTokenAddress == address(0)) {
                revert SyntheticTokenNotFound();
            }
            RemoteTokenInfo memory remoteToken = _remoteTokens[syntheticTokenAddress][_srcEid]; // Read into memory

            uint256 normalizedAmountIn = _normalizeAmount(
                asset.tokenAmount,
                remoteToken.decimalsDelta
            );
            bonuses[i] = _checkBonus(
                syntheticTokenAddress,
                _srcEid,
                normalizedAmountIn,
                remoteToken.totalBalance
            );
        }
        return bonuses;
    }

    /**
     * @dev Validates tokens and prepares asset array for bridging.
     * It checks if tokens are linked, if there's sufficient balance on the destination chain,
     * removes dust, and calculates penalties.
     * @param _assets Array of assets (local synthetic token addresses and amounts) to be bridged.
     * @param _dstEid Destination network identifier.
     * @param _skipMinBridgeAmtCheck Whether to skip the minBridgeAmt check
     * @return assets Array of prepared assets with remote token addresses and normalized amounts.
     * @return penalties Array of penalties calculated for each asset.
     */
    function validateAndPrepareAssets(
        Asset[] memory _assets,
        uint32 _dstEid,
        bool _skipMinBridgeAmtCheck
    ) public view returns (Asset[] memory assets, uint256[] memory penalties) {
        uint256 inputLength = _assets.length;
        assets = new Asset[](inputLength);
        penalties = new uint256[](inputLength);

        for (uint256 i = 0; i < inputLength; i++) {
            Asset memory _asset = _assets[i];
            address syntheticTokenAddress = _asset.tokenAddress;
            uint256 amount = _asset.tokenAmount;

            RemoteTokenInfo memory remoteToken = _remoteTokens[syntheticTokenAddress][_dstEid];
            if (remoteToken.remoteAddress == address(0)) {
                revert TokenNotLinkedToDestChain(syntheticTokenAddress, _dstEid);
            }

            // Check minBridgeAmt (in synthetic token decimals) if not skipping
            if (!_skipMinBridgeAmtCheck && amount < remoteToken.minBridgeAmt) {
                revert AmountLessThanMinBridgeAmount(
                    syntheticTokenAddress,
                    _dstEid,
                    amount,
                    remoteToken.minBridgeAmt
                );
            }

            amount = _removeDust(amount, -remoteToken.decimalsDelta);
            _assets[i].tokenAmount = amount; // update amount
            if (amount == 0) {
                revert AmountIsTooSmall();
            }
            // Check balance against the amount *after* dust removal, as this is what would be burned/affect balance
            if (remoteToken.totalBalance < amount) {
                revert InsufficientBalanceOnDestChain(
                    syntheticTokenAddress,
                    _dstEid,
                    amount,
                    remoteToken.totalBalance
                );
            }

            uint256 penalty = _checkPenalty(
                syntheticTokenAddress,
                _dstEid,
                amount,
                remoteToken.totalBalance
            );

            if (penalty > 0) {
                amount -= penalty;
                amount = _removeDust(amount, -remoteToken.decimalsDelta);
                penalties[i] = _assets[i].tokenAmount - amount;
            } else {
                penalties[i] = 0;
            }

            // For the message payload, use the normalized amount
            uint256 normalizedAmount = _normalizeAmount(amount, -remoteToken.decimalsDelta);

            assets[i] = Asset({
                tokenAddress: remoteToken.remoteAddress,
                tokenAmount: normalizedAmount
            });
        }
    }

    /**
     * @notice Processes a swap message received from a remote chain via LayerZero.
     * @dev This function is called internally by `_lzReceive` when a `MessageType.Swap` is received.
     * It mints incoming synthetic tokens, executes a swap on Uniswap, burns the resulting synthetic tokens,
     * and prepares a message to send the swapped assets to the final destination chain.
     * If the swap fails, it prepares a revert message.
     * @param params The swap parameters including assets, recipient, destination EID, etc.
     * @param _srcEid The source endpoint ID from which the swap message originated.
     * @return payload The encoded LayerZero message payload to be sent (either a swap confirmation or a revert message).
     */
    function processSwapMessage(
        SwapParams memory params,
        uint32 _srcEid
    ) external returns (bytes memory payload) {
        if (msg.sender != address(this)) revert InvalidSwapSender();
        address[] memory syntheticTokensIn = new address[](params.assets.length);

        uint256 length = params.assets.length;
        for (uint256 i = 0; i < length; i++) {
            Asset memory asset = params.assets[i];
            address syntheticTokenAddress = _syntheticAddressByRemoteAddress[_srcEid][
                asset.tokenAddress
            ];
            if (syntheticTokenAddress == address(0)) revert SyntheticTokenNotFound();
            syntheticTokensIn[i] = syntheticTokenAddress;
            RemoteTokenInfo storage remoteToken = _remoteTokens[syntheticTokenAddress][_srcEid];

            // Normalize amount
            uint256 normalizedAmount = _normalizeAmount(
                asset.tokenAmount,
                remoteToken.decimalsDelta
            );

            uint256 bonus = _checkBonus(
                syntheticTokenAddress,
                _srcEid,
                normalizedAmount,
                remoteToken.totalBalance
            );
            _bonusBalance[syntheticTokenAddress][_srcEid] -= bonus;
            // Add bonus
            normalizedAmount += bonus;

            // Increase source network balance
            remoteToken.totalBalance += normalizedAmount;

            // Mint synthetic token
            ISyntheticToken(syntheticTokenAddress).mint(address(this), normalizedAmount);
        }

        (bool success, bytes memory returndata) = uniswapUniversalRouter.call(
            abi.encodeWithSignature("execute(bytes,bytes[])", params.commands, params.inputs)
        );

        if (success) {
            Asset[] memory assetsToBurn = new Asset[](1);
            assetsToBurn[0] = Asset({
                tokenAddress: params.syntheticTokenOut,
                tokenAmount: ISyntheticToken(params.syntheticTokenOut).balanceOf(address(this))
            });
            // If validateAndPrepareAssets fails, it will revert.
            (Asset[] memory assetsToSend, uint256[] memory penalties) = validateAndPrepareAssets(
                assetsToBurn,
                params.dstEid,
                true // Skip minBridgeAmt check for the tokenOut of a swap
            );
            if (assetsToSend[0].tokenAmount < params.minimumAmountOut) {
                revert SwapFailed("Insufficient amount out");
            }

            _bonusBalance[params.syntheticTokenOut][params.dstEid] += penalties[0]; // only one asset in assetsToBurn

            _burnTokens(assetsToBurn, params.dstEid, address(this)); // Assumes assetsToBurn amounts are correct for burning logic
            bytes memory msgData = abi.encode(params.from, params.to, assetsToSend);
            payload = abi.encode(MessageType.Swap, msgData);
        } else {
            revert SwapFailed(
                returndata.length > 0 ? string(returndata) : "Uniswap execution failed"
            );
        }
        _collectDust(syntheticTokensIn, params.syntheticTokenOut, params.from);
        return payload;
    }

    /**
     * @dev Burns synthetic tokens and updates the total balance for the destination chain.
     * This function is called internally after validations and penalty calculations.
     * @param _assets Array of assets (local synthetic token addresses and amounts) to burn.
     * @param _dstEid Destination network identifier for which to update the balance.
     * @param from The address from which the tokens are burned (original owner or this contract for swaps).
     */
    function _burnTokens(Asset[] memory _assets, uint32 _dstEid, address from) private {
        for (uint256 i = 0; i < _assets.length; i++) {
            Asset memory _asset = _assets[i];
            address syntheticTokenAddress = _asset.tokenAddress;
            uint256 amount = _asset.tokenAmount;
            RemoteTokenInfo storage remoteToken = _remoteTokens[syntheticTokenAddress][_dstEid];
            // Burn the synthetic token
            ISyntheticToken(syntheticTokenAddress).burn(from, amount);

            // Decrease the target chain balance
            remoteToken.totalBalance -= amount;
        }
    }

    /**
     * @dev Internal LayerZero message receiving function.
     * Routes messages based on `MessageType`.
     * @param _origin Details of the LayerZero message origin.
     * @param _guid The unique identifier of the LayerZero message.
     * @param _payload The raw payload of the LayerZero message.
     */
    function _lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _payload,
        address /*_executor*/,
        bytes calldata /*_extraData*/
    ) internal override {
        (MessageType messageType, bytes memory payload) = abi.decode(
            _payload,
            (MessageType, bytes)
        );
        if (messageType == MessageType.Deposit) {
            _processDepositMessage(payload, _guid, _origin.srcEid);
        } else if (messageType == MessageType.Swap) {
            SwapParams memory params = abi.decode(payload, (SwapParams));
            if (msg.value < params.value) {
                revert InsufficientValue(msg.value, params.value);
            }
            bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(
                params.gasLimit,
                0
            );
            try this.processSwapMessage(params, _origin.srcEid) returns (bytes memory payloadData) {
                _lzSend(
                    params.dstEid,
                    payloadData,
                    options,
                    MessagingFee(msg.value, 0),
                    payable(params.from)
                );
            } catch (bytes memory reason) {
                bytes memory msgData = abi.encode(
                    params.from,
                    params.to,
                    params.assets,
                    _guid,
                    string(reason)
                );
                payload = abi.encode(MessageType.RevertSwap, msgData);

                _lzSend(
                    _origin.srcEid,
                    payload,
                    options,
                    MessagingFee(msg.value, 0),
                    payable(params.from)
                );
            }
        } else if (messageType == MessageType.LinkToken) {
            _processLinkTokenMessage(
                payload,
                address(uint160(uint256(_origin.sender))),
                _origin.srcEid
            );
        } else {
            revert InvalidMessageType();
        }
    }

    /**
     * @notice Links a synthetic token with a remote token in another network.
     * @dev This function is called internally by `_lzReceive` when a `MessageType.LinkToken` is received.
     * It updates mappings for token linking and emits a `RemoteTokenLinked` event.
     * @param _payload Encoded payload containing an array of `AvailableToken` structs.
     * @param _sender The address of the GatewayVault contract on the source chain.
     * @param _srcEid The source network identifier from which the link message originated.
     */
    function _processLinkTokenMessage(
        bytes memory _payload,
        address _sender,
        uint32 _srcEid
    ) internal {
        AvailableToken[] memory _availableTokens = abi.decode(_payload, (AvailableToken[]));
        if (_gatewayVaultByEid[_srcEid] != _sender) {
            _gatewayVaultByEid[_srcEid] = _sender;
        }

        for (uint256 i = 0; i < _availableTokens.length; i++) {
            address syntheticTokenAddress = _availableTokens[i].syntheticTokenAddress;
            address remoteTokenAddress = _availableTokens[i].tokenAddress;
            uint256 _tokenIndex = _tokenIndexByAddress[syntheticTokenAddress];
            if (_tokenIndex == 0) {
                revert SyntheticTokenNotFound();
            }

            RemoteTokenInfo storage remoteToken = _remoteTokens[syntheticTokenAddress][_srcEid];
            if (remoteToken.remoteAddress != address(0)) {
                revert RemoteTokenAlreadyLinked(
                    syntheticTokenAddress,
                    _srcEid,
                    remoteToken.remoteAddress
                );
            }

            remoteToken.remoteAddress = remoteTokenAddress;
            remoteToken.decimalsDelta = _availableTokens[i].decimalsDelta;
            // minBridgeAmt from AvailableToken is in original token decimals.
            // Need to normalize it to synthetic token decimals before storing in RemoteTokenInfo.
            uint256 minBridgeAmtSynthetic = _normalizeAmount(
                _availableTokens[i].minBridgeAmt,
                _availableTokens[i].decimalsDelta
            );
            remoteToken.minBridgeAmt = minBridgeAmtSynthetic;

            SyntheticTokenInfo storage tokenInfo = _syntheticTokens[_tokenIndex];
            tokenInfo.chainList.push(_srcEid);

            _syntheticAddressByRemoteAddress[_srcEid][remoteTokenAddress] = syntheticTokenAddress;
            _remoteAddressBySyntheticAddress[_srcEid][syntheticTokenAddress] = remoteTokenAddress;
        }

        emit RemoteTokenLinked(_availableTokens, _sender, _srcEid);
    }

    /**
     * @dev Collects any dust tokens remaining in this contract after a swap and sends them to the recipient.
     * This includes the output synthetic token and all input synthetic tokens.
     * @param syntheticTokensIn Array of input synthetic token addresses used in the swap.
     * @param syntheticTokenOut The output synthetic token address from the swap.
     * @param recipient The address to receive any dust tokens.
     */
    function _collectDust(
        address[] memory syntheticTokensIn,
        address syntheticTokenOut,
        address recipient
    ) private {
        uint256 balance = syntheticTokenOut.getBalanceOf(address(this));
        if (balance > 0) {
            syntheticTokenOut.safeTransfer(recipient, balance);
        }
        for (uint256 i = 0; i < syntheticTokensIn.length; i++) {
            address token = syntheticTokensIn[i];
            balance = token.getBalanceOf(address(this));
            if (balance > 0) {
                token.safeTransfer(recipient, balance);
            }
        }
    }

    /**
     * @dev Processes a deposit message received from a remote chain via LayerZero.
     * This function is called internally by `_lzReceive` when a `MessageType.Deposit` is received.
     * It mints synthetic tokens to the recipient, updates balances, and applies bonuses.
     * @param _payload Encoded payload containing sender, recipient, and assets.
     * @param _guid The LayerZero message GUID.
     * @param _srcEid The source network identifier from which the deposit originated.
     */
    function _processDepositMessage(bytes memory _payload, bytes32 _guid, uint32 _srcEid) internal {
        (address _from, address _to, Asset[] memory _assets) = abi.decode(
            _payload,
            (address, address, Asset[])
        );

        for (uint256 i = 0; i < _assets.length; i++) {
            Asset memory asset = _assets[i];
            address syntheticTokenAddress = _syntheticAddressByRemoteAddress[_srcEid][
                asset.tokenAddress
            ];
            if (syntheticTokenAddress == address(0)) revert SyntheticTokenNotFound();

            RemoteTokenInfo storage remoteToken = _remoteTokens[syntheticTokenAddress][_srcEid];

            // Normalize amount
            uint256 normalizedAmount = _normalizeAmount(
                asset.tokenAmount,
                remoteToken.decimalsDelta
            );

            uint256 bonus = _checkBonus(
                syntheticTokenAddress,
                _srcEid,
                normalizedAmount,
                remoteToken.totalBalance
            );
            _bonusBalance[syntheticTokenAddress][_srcEid] -= bonus;

            // Add bonus
            normalizedAmount += bonus;

            // Increase source network balance
            remoteToken.totalBalance += normalizedAmount;

            // Mint synthetic token
            ISyntheticToken(syntheticTokenAddress).mint(_to, normalizedAmount);

            // Update asset for event
            _assets[i].tokenAmount = normalizedAmount;
            _assets[i].tokenAddress = syntheticTokenAddress;
        }

        emit MessageReceived(_guid, _from, _to, _assets, _srcEid);
    }

    /**
     * @dev Calculates the penalty for withdrawing a certain amount of a synthetic token.
     * The penalty is determined by the Balancer contract and capped by `MAX_PENALTY_BP`.
     * @param _syntheticTokenAddress The address of the synthetic token.
     * @param _dstEid The destination network ID.
     * @param _amountOut The amount of the synthetic token to be withdrawn.
     * @param _currentBalance The current total balance of the synthetic token on the destination network.
     * @return The penalty amount.
     */
    function _checkPenalty(
        address _syntheticTokenAddress,
        uint32 _dstEid,
        uint256 _amountOut,
        uint256 _currentBalance
    ) private view returns (uint256) {
        uint256 _tokenIndex = _tokenIndexByAddress[_syntheticTokenAddress];
        SyntheticTokenInfo memory tokenInfo = _syntheticTokens[_tokenIndex];

        uint256 penalty = IBalancer(balancer).getPenalty(
            _syntheticTokenAddress,
            _dstEid,
            _currentBalance, // current balance of the synthetic token on the destination network
            _amountOut,
            tokenInfo.chainList.length
        );
        if (penalty == 0) {
            return 0;
        }
        uint256 _maxPenalty = (_amountOut * MAX_PENALTY_BP) / BP;
        if (penalty > _maxPenalty) {
            penalty = _maxPenalty;
        }

        return penalty;
    }

    /**
     * @dev Gets the bonus for depositing a given synthetic token and amount.
     * The bonus is determined by the Balancer contract and capped by the available bonus balance.
     * @param _syntheticTokenAddress The address of the synthetic token.
     * @param _srcEid The source network ID.
     * @param _amountIn The amount of the synthetic token being deposited/minted.
     * @param _currentBalance The current total balance of the synthetic token on the source network.
     * @return The bonus amount.
     */
    function _checkBonus(
        address _syntheticTokenAddress,
        uint32 _srcEid,
        uint256 _amountIn,
        uint256 _currentBalance
    ) private view returns (uint256) {
        uint256 _totalBonusBalance = _bonusBalance[_syntheticTokenAddress][_srcEid];
        if (_totalBonusBalance == 0) {
            return 0;
        }
        uint256 _tokenIndex = _tokenIndexByAddress[_syntheticTokenAddress];
        SyntheticTokenInfo memory tokenInfo = _syntheticTokens[_tokenIndex];
        uint256 bonus = IBalancer(balancer).getBonus(
            _syntheticTokenAddress,
            _srcEid,
            _totalBonusBalance,
            _currentBalance, // current balance of the synthetic token on the source network
            _amountIn,
            tokenInfo.chainList.length
        );
        if (bonus > _totalBonusBalance) {
            bonus = _totalBonusBalance;
        }
        return bonus;
    }

    /**
     * @dev Normalizes token amount considering decimal places difference.
     * If `_decimalsDelta` is negative, it means the remote token has fewer decimals than the synthetic token, so we divide.
     * If `_decimalsDelta` is positive, it means the remote token has more decimals, so we multiply.
     * @param _amount The amount to normalize.
     * @param _decimalsDelta The difference in decimal places (syntheticDecimals - remoteDecimals).
     * @return The normalized amount.
     */
    function _normalizeAmount(
        uint256 _amount,
        int8 _decimalsDelta
    ) internal pure returns (uint256) {
        if (_decimalsDelta < 0) {
            return _amount / 10 ** uint8(-_decimalsDelta);
        } else {
            return _amount * 10 ** uint8(_decimalsDelta);
        }
    }

    /**
     * @dev Removes dust from a token amount when converting from a token with more decimals
     * to one with fewer decimals. Ensures that the amount is a multiple of the precision difference.
     * Only applies if `_decimalsDelta` is negative (synthetic token has more decimals than remote).
     * @param _amount The amount to remove dust from.
     * @param _decimalsDelta The difference in decimal places (syntheticDecimals - remoteDecimals).
     * @return The amount with dust removed, or the original amount if no adjustment is needed.
     */
    function _removeDust(uint256 _amount, int8 _decimalsDelta) internal pure returns (uint256) {
        if (_decimalsDelta < 0) {
            uint256 dustNormalizer = 10 ** uint8(-_decimalsDelta);
            return (_amount / dustNormalizer) * dustNormalizer;
        }
        return _amount;
    }

    /**
     * @dev Gets the storage slot data.
     * @param slot The storage slot to get data from.
     * @return The data in the storage slot.
     */
    function getStorageSlotData(uint256 slot) external view returns (bytes32) {
        assembly {
            mstore(0x00, sload(slot))
            return(0x00, 0x20)
        }
    }
}
