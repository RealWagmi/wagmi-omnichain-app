// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

interface ISyntheticTokenHubGetters {
    struct SyntheticTokenInfo {
        address tokenAddress;
        string tokenSymbol;
        uint8 tokenDecimals;
        uint32[] chainList;
    }

    struct RemoteTokenInfo {
        address remoteAddress;
        int8 decimalsDelta;
        uint256 totalBalance;
        uint256 minBridgeAmt; // Minimum amount for bridging this token (in synthetic token decimals)
    }

    struct RemoteTokenView {
        uint32 eid;
        RemoteTokenInfo remoteTokenInfo;
    }

    struct SyntheticTokenView {
        uint256 tokenIndex;
        SyntheticTokenInfo syntheticTokenInfo;
        RemoteTokenView[] remoteTokens;
    }

    function getSyntheticTokenCount() external view returns (uint256);

    function getRemoteTokenInfo(
        address _tokenAddress,
        uint32 _eid
    ) external view returns (RemoteTokenInfo memory);

    function getTokenIndexByAddress(address _tokenAddress) external view returns (uint256);

    function getSyntheticAddressByRemoteAddress(
        uint32 _eid,
        address _remoteAddress
    ) external view returns (address);

    function getRemoteAddressBySyntheticAddress(
        uint32 _eid,
        address _syntheticAddress
    ) external view returns (address);

    function getGatewayVaultByEid(uint32 _eid) external view returns (address);

    function getSyntheticTokensInfo(
        uint256[] memory _tokenIndices
    ) external view returns (SyntheticTokenView[] memory);

    function getSyntheticTokenInfo(
        uint256 _tokenIndex
    ) external view returns (SyntheticTokenView memory);

    function getSyntheticTokenIndex(address _tokenAddress) external view returns (uint256);

    function isTokenRegistered(address _tokenAddress) external view returns (bool);

    function getBonusBalance(address _tokenAddress, uint32 _eid) external view returns (uint256);

    function getMinBridgeAmount(
        address _syntheticTokenAddress,
        uint32 _eid
    ) external view returns (uint256);
}
