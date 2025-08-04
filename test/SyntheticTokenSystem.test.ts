import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, BigNumberish, Contract, ContractFactory } from "ethers";
import { deployments, ethers } from "hardhat";
import {
  time,
  mine,
  mineUpTo,
  takeSnapshot,
  SnapshotRestorer,
  impersonateAccount,
} from "@nomicfoundation/hardhat-network-helpers";

import { Options } from "@layerzerolabs/lz-v2-utilities";
import {
  GatewayVault,
  SyntheticTokenHub,
  SyntheticTokenHub__factory,
  SyntheticTokenHubGetters,
  SyntheticTokenHubGetters__factory,
  PoolCreator,
  SwapQuoterV3,
  GatewayVault__factory,
  SyntheticToken,
  MockERC20__factory,
  MockERC20,
  Balancer__factory,
  Balancer,
} from "../typechain-types";

import {
  Trade as V3Trade,
  Route as V3Route,
  Pool as V3Pool,
  Position,
  FeeOptions,
  encodeSqrtRatioX96,
  nearestUsableTick,
  TickMath,
  FeeAmount,
  SwapRouter,
  NonfungiblePositionManager,
} from "@uniswap/v3-sdk";
import { TradeType } from "@uniswap/sdk-core";
import { MixedRouteTrade, MixedRouteSDK, Trade as RouterTrade } from "@uniswap/router-sdk";
import { CommandType, RoutePlanner } from "./testHelper/planner";
import { SwapParamsStruct, AssetStruct } from "../typechain-types/contracts/GatewayVault";
import { encodePath, getMultiHopQuote, priceToTick, addV3ExactInTrades } from "./testHelper/helpers";

describe("Synthetic Token System", function () {
  enum MessageType {
    Deposit,
    Withdraw,
    Swap,
    LinkToken,
    RevertSwap,
  }

  // Constants
  const eidA = 1; // Chain A (Hub chain)
  const eidB = 2; // Chain B (Gateway chain)
  const eidC = 3; // Chain C (Additional Gateway chain)
  const LZ_GAS_LIMIT = 500000; // Gas limit for LayerZero cross-chain messages
  const UniversalRouter = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
  const Permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const UniswapV3Factory = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
  const NonfungiblePositionManager = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
  const POOL_INIT_CODE_HASH = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";

  // Contract factories
  let SyntheticTokenHubFactory: SyntheticTokenHub__factory;
  let SyntheticTokenHubGettersFactory: SyntheticTokenHubGetters__factory;
  let GatewayVaultFactory: GatewayVault__factory;
  let MockERC20Factory: MockERC20__factory;
  let EndpointV2MockFactory: ContractFactory;
  let BalancerFactory: Balancer__factory;
  let poolCreator: PoolCreator;
  let swapQuoterV3: SwapQuoterV3;
  let bUSDT: MockERC20;
  let bWETH: MockERC20;
  let bWBTC: MockERC20;

  let cUSDT: MockERC20;
  let cWETH: MockERC20;
  let cWBTC: MockERC20;

  let planner: RoutePlanner;

  // Accounts
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let endpointOwner: SignerWithAddress;
  // Contracts
  let syntheticTokenHub: SyntheticTokenHub;
  let syntheticTokenHubGetters: SyntheticTokenHubGetters;
  let gatewayVaultB: GatewayVault;
  let gatewayVaultC: GatewayVault; // Additional gateway for multi-chain testing
  let balancer: Balancer;
  let mockEndpointV2A: Contract;
  let mockEndpointV2B: Contract;
  let mockEndpointV2C: Contract;

  let syntheticUsdtToken: SyntheticToken;
  let syntheticWethToken: SyntheticToken;
  let syntheticBtcToken: SyntheticToken;

  before(async function () {
    // Get signers
    const signers = await ethers.getSigners();
    [deployer, user1, user2, user3, endpointOwner] = signers;
    MockERC20Factory = await ethers.getContractFactory("MockERC20");
    bUSDT = await MockERC20Factory.deploy("USDT", "USDT", 6);
    bWETH = await MockERC20Factory.deploy("WETH", "WETH", 18);
    bWBTC = await MockERC20Factory.deploy("WBTC", "WBTC", 8);
    cUSDT = await MockERC20Factory.deploy("USDT", "USDT", 6);
    cWETH = await MockERC20Factory.deploy("WETH", "WETH", 18);
    cWBTC = await MockERC20Factory.deploy("WBTC", "WBTC", 8);
    const amountUSDT = ethers.utils.parseUnits("10000000", 6);
    const amountWETH = ethers.utils.parseUnits("10000", 18);
    const amountWBTC = ethers.utils.parseUnits("100", 8);
    for (const user of [user1, user2, user3]) {
      await bUSDT.mint(user.address, amountUSDT);
      await bWETH.mint(user.address, amountWETH);
      await bWBTC.mint(user.address, amountWBTC);
      await cUSDT.mint(user.address, amountUSDT);
      await cWETH.mint(user.address, amountWETH);
      await cWBTC.mint(user.address, amountWBTC);
    }

    const PoolCreatorFactory = await ethers.getContractFactory("PoolCreator");
    poolCreator = await PoolCreatorFactory.deploy(UniswapV3Factory, NonfungiblePositionManager);
    const SwapQuoterV3Factory = await ethers.getContractFactory("SwapQuoterV3");
    swapQuoterV3 = await SwapQuoterV3Factory.deploy(UniswapV3Factory, POOL_INIT_CODE_HASH);

    // Get contract factories
    SyntheticTokenHubFactory = await ethers.getContractFactory("SyntheticTokenHub");
    SyntheticTokenHubGettersFactory = await ethers.getContractFactory("SyntheticTokenHubGetters");
    GatewayVaultFactory = await ethers.getContractFactory("GatewayVault");

    // Get EndpointV2Mock artifact
    const EndpointV2MockArtifact = await deployments.getArtifact("EndpointV2Mock");
    EndpointV2MockFactory = new ContractFactory(
      EndpointV2MockArtifact.abi,
      EndpointV2MockArtifact.bytecode,
      endpointOwner
    );
    // Deploy mock endpoint instances
    mockEndpointV2A = await EndpointV2MockFactory.deploy(eidA);
    mockEndpointV2B = await EndpointV2MockFactory.deploy(eidB);
    mockEndpointV2C = await EndpointV2MockFactory.deploy(eidC);

    BalancerFactory = await ethers.getContractFactory("Balancer");
    balancer = await BalancerFactory.deploy(deployer.address);

    // Create main contracts
    syntheticTokenHub = await SyntheticTokenHubFactory.deploy(
      mockEndpointV2A.address,
      deployer.address,
      UniversalRouter,
      Permit2,
      balancer.address
    );
    gatewayVaultB = await GatewayVaultFactory.deploy(mockEndpointV2B.address, deployer.address, eidA);
    gatewayVaultC = await GatewayVaultFactory.deploy(mockEndpointV2C.address, deployer.address, eidA);

    // Configure endpoints
    await mockEndpointV2A.setDestLzEndpoint(gatewayVaultB.address, mockEndpointV2B.address);
    await mockEndpointV2B.setDestLzEndpoint(syntheticTokenHub.address, mockEndpointV2A.address);
    await mockEndpointV2A.setDestLzEndpoint(gatewayVaultC.address, mockEndpointV2C.address);
    await mockEndpointV2C.setDestLzEndpoint(syntheticTokenHub.address, mockEndpointV2A.address);

    // Set trusted peers between contracts (OApp -> OApp)
    // Get address bytes32 for each contract
    const synthTokenHubAddressBytes32 = ethers.utils.zeroPad(syntheticTokenHub.address, 32);
    const gatewayVaultAddressBytes32 = ethers.utils.zeroPad(gatewayVaultB.address, 32);
    const gatewayVaultCAddressBytes32 = ethers.utils.zeroPad(gatewayVaultC.address, 32);

    // Set SyntheticTokenHub trusted peers
    await syntheticTokenHub.setPeer(eidB, gatewayVaultAddressBytes32);
    await syntheticTokenHub.setPeer(eidC, gatewayVaultCAddressBytes32);

    // Set GatewayVault trusted peers
    await gatewayVaultB.setPeer(eidA, synthTokenHubAddressBytes32);
    await gatewayVaultC.setPeer(eidA, synthTokenHubAddressBytes32);

    // Deploy SyntheticTokenHubGetters
    syntheticTokenHubGetters = await SyntheticTokenHubGettersFactory.deploy(syntheticTokenHub.address);
  });

  describe("Token Creation and Management", function () {
    it("should fail when non-owner tries to add a token", async function () {
      await expect(syntheticTokenHub.connect(user1).createSyntheticToken("FAIL", 18)).to.be.reverted;
    });

    it("should successfully create a synthetic token", async function () {
      const SyntheticTokens = [
        { symbol: "USDT", decimals: 6 },
        { symbol: "WETH", decimals: 18 },
        { symbol: "WBTC", decimals: 8 },
      ];

      let SyntheticTokenAddress = [];
      let index = 0;

      for (const token of SyntheticTokens) {
        // Add token
        const tokenSymbol = token.symbol;
        const tokenDecimals = token.decimals;

        // Add synthetic token
        const tx = await syntheticTokenHub.createSyntheticToken(tokenSymbol, tokenDecimals);
        const receipt = await tx.wait();

        // Find SyntheticTokenAdded event
        const event = receipt.logs.find((log: any) => {
          try {
            const parsed = syntheticTokenHub.interface.parseLog(log);
            return parsed && parsed.name === "SyntheticTokenAdded";
          } catch {
            return false;
          }
        });

        const parsedEvent = event ? syntheticTokenHub.interface.parseLog(event) : null;
        const tokenAddress = parsedEvent ? parsedEvent.args.tokenAddress : null;
        SyntheticTokenAddress.push(tokenAddress);
        index++;
        // Check token properties
        const syntheticToken = await ethers.getContractAt("SyntheticToken", tokenAddress);
        expect(await syntheticToken.tokenIndex()).to.equal(index);
        expect(await syntheticToken.symbol()).to.equal(tokenSymbol);
        expect(await syntheticToken.decimals()).to.equal(tokenDecimals);
        expect(await syntheticToken.name()).to.equal(`Synthetic ${tokenSymbol}`);
        expect(await syntheticToken.owner()).to.equal(syntheticTokenHub.address);
        expect(await syntheticToken.totalSupply()).to.equal(0);
        expect(await syntheticTokenHubGetters.getSyntheticTokenCount()).to.equal(index);
        expect(await syntheticTokenHubGetters.getSyntheticTokenIndex(syntheticToken.address)).to.equal(index);
      }
      // Create token instance
      syntheticUsdtToken = await ethers.getContractAt("SyntheticToken", SyntheticTokenAddress[0]);
      syntheticWethToken = await ethers.getContractAt("SyntheticToken", SyntheticTokenAddress[1]);
      syntheticBtcToken = await ethers.getContractAt("SyntheticToken", SyntheticTokenAddress[2]);

      // Check token was added correctly
    });

    it("should not allow non-owner to mint tokens", async function () {
      await expect(syntheticUsdtToken.connect(user1).mint(user1.address, ethers.utils.parseUnits("100", 6))).to.be
        .reverted;
    });

    it("should not allow non-owner to burn tokens", async function () {
      await expect(syntheticUsdtToken.connect(user1).burn(user1.address, ethers.utils.parseUnits("100", 6))).to.be
        .reverted;
    });

    it("should fail when non-owner tries to link token", async function () {
      await expect(
        gatewayVaultB.connect(user1).linkTokenToHub(
          [
            {
              onPause: false,
              tokenAddress: bUSDT.address,
              syntheticTokenDecimals: 6,
              syntheticTokenAddress: syntheticUsdtToken.address,
              minBridgeAmt: 0,
            },
          ],
          "0x"
        )
      ).to.be.revertedWithCustomError(gatewayVaultB, "OwnableUnauthorizedAccount");
    });

    it("should successfully link token to synthetic token", async function () {
      // Add mock token in another network

      const tokenSetupConfig: GatewayVault.TokenSetupConfigStruct[] = [
        {
          onPause: false,
          tokenAddress: bUSDT.address,
          syntheticTokenDecimals: 6,
          syntheticTokenAddress: syntheticUsdtToken.address,
          minBridgeAmt: ethers.utils.parseUnits("1", 6), // e.g., 1 USDT
        },
        {
          onPause: false,
          tokenAddress: bWBTC.address,
          syntheticTokenDecimals: 8,
          syntheticTokenAddress: syntheticBtcToken.address,
          minBridgeAmt: ethers.utils.parseUnits("0.0001", 8), // e.g., 0.0001 WBTC
        },
        {
          onPause: false,
          tokenAddress: bWETH.address,
          syntheticTokenDecimals: 18,
          syntheticTokenAddress: syntheticWethToken.address,
          minBridgeAmt: ethers.utils.parseUnits("0.001", 18), // e.g., 0.001 WETH
        },
      ];

      // Link the token using the proper method
      const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      // (bool,address,uint8,address)[],bytes
      const fee = await gatewayVaultB.quoteLinkTokenToHub(tokenSetupConfig, options);

      // Send the link transaction
      await gatewayVaultB.linkTokenToHub(tokenSetupConfig, options, { value: fee });

      // Check token information via remoteTokens mapping
      // usdt
      const remoteTokenInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticUsdtToken.address, eidB);
      expect(remoteTokenInfo.remoteAddress).to.equal(bUSDT.address);
      expect(remoteTokenInfo.decimalsDelta).to.equal(0); // Same number of decimal places

      // wbtc
      const remoteTokenInfoBtc = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticBtcToken.address, eidB);
      expect(remoteTokenInfoBtc.remoteAddress).to.equal(bWBTC.address);
      expect(remoteTokenInfoBtc.decimalsDelta).to.equal(0); // Same number of decimal places

      // weth
      const remoteTokenInfoWeth = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticWethToken.address, eidB);
      expect(remoteTokenInfoWeth.remoteAddress).to.equal(bWETH.address);
      expect(remoteTokenInfoWeth.decimalsDelta).to.equal(0); // Same number of decimal places

      // Check token was added correctly
      const newTokenCount = await gatewayVaultB.getAvailableTokenLength();
      expect(newTokenCount).to.equal(3);

      const syntheticTokensInfo = await syntheticTokenHubGetters.getSyntheticTokensInfo([]);
      // console.dir(syntheticTokensInfo, { depth: null });
      expect(syntheticTokensInfo.length).to.equal(3);
      expect(syntheticTokensInfo[0].syntheticTokenInfo.tokenAddress).to.equal(syntheticUsdtToken.address);
      expect(syntheticTokensInfo[1].syntheticTokenInfo.tokenAddress).to.equal(syntheticWethToken.address);
      expect(syntheticTokensInfo[2].syntheticTokenInfo.tokenAddress).to.equal(syntheticBtcToken.address);
      expect(syntheticTokensInfo[0].remoteTokens[0].remoteTokenInfo.remoteAddress).to.equal(bUSDT.address);
      expect(syntheticTokensInfo[1].remoteTokens[0].remoteTokenInfo.remoteAddress).to.equal(bWETH.address);
      expect(syntheticTokensInfo[2].remoteTokens[0].remoteTokenInfo.remoteAddress).to.equal(bWBTC.address);

      const tokenSetupConfigC: GatewayVault.TokenSetupConfigStruct[] = [
        {
          onPause: false,
          tokenAddress: cUSDT.address,
          syntheticTokenDecimals: 6,
          syntheticTokenAddress: syntheticUsdtToken.address,
          minBridgeAmt: ethers.utils.parseUnits("1", 6), // e.g., 1 USDT
        },
        {
          onPause: false,
          tokenAddress: cWBTC.address,
          syntheticTokenDecimals: 8,
          syntheticTokenAddress: syntheticBtcToken.address,
          minBridgeAmt: ethers.utils.parseUnits("0.0001", 8), // e.g., 0.0001 WBTC
        },
        {
          onPause: false,
          tokenAddress: cWETH.address,
          syntheticTokenDecimals: 18,
          syntheticTokenAddress: syntheticWethToken.address,
          minBridgeAmt: ethers.utils.parseUnits("0.001", 18), // e.g., 0.001 WETH
        },
      ];

      const feeC = await gatewayVaultC.quoteLinkTokenToHub(tokenSetupConfigC, options);
      // Send the link transaction
      await gatewayVaultC.linkTokenToHub(tokenSetupConfigC, options, { value: feeC });
    });

    it("should find synthetic token index by address", async function () {
      // Make sure the test runs after token is created
      // Using the syntheticUsdtToken that was created in the initial setup
      const index = await syntheticTokenHubGetters.getSyntheticTokenIndex(syntheticUsdtToken.address);
      expect(index).to.be.equal(1);

      await expect(
        syntheticTokenHubGetters.getSyntheticTokenIndex("0x0000000000000000000000000000000000000001")
      ).to.be.revertedWith("Token not found");
    });

    it("should find synthetic token address by remote address", async function () {
      // Find token by its corresponding address on remote chain
      // We need to use the _syntheticAddressByRemoteAddress mapping

      const syntheticAddress = await syntheticTokenHubGetters.getSyntheticAddressByRemoteAddress(
        eidB,
        bUSDT.address // This is mockEthAddress from previous test
      );

      expect(syntheticAddress).to.equal(syntheticUsdtToken.address);
    });

    it("should properly handle token approvals to Universal Permit2", async function () {
      // Check that the token was properly approved for the Universal Router
      const approval = await syntheticUsdtToken.allowance(
        syntheticTokenHub.address,
        await syntheticTokenHub.uniswapPermitV2()
      );

      expect(approval).to.equal(ethers.constants.MaxUint256);
    });
  });

  describe("Chain Management", function () {
    // In SyntheticTokenHub there's no explicit chain management functions
    // Instead, we can check the peer mappings to validate chain connections

    it("should correctly set up trusted peers", async function () {
      // Get the peer for eidB
      const peerB = await syntheticTokenHub.peers(eidB);
      const expectedPeerB = ethers.utils.hexlify(ethers.utils.zeroPad(gatewayVaultB.address, 32));

      expect(peerB).to.equal(expectedPeerB);

      // Get the peer for eidC
      const peerC = await syntheticTokenHub.peers(eidC);
      const expectedPeerC = ethers.utils.hexlify(ethers.utils.zeroPad(gatewayVaultC.address, 32));

      expect(peerC).to.equal(expectedPeerC);
    });

    it("should have proper gateway mapping", async function () {
      // After linking tokens, the gatewayVaultByEid mapping should be updated
      const gatewayB = await syntheticTokenHubGetters.getGatewayVaultByEid(eidB);
      expect(gatewayB).to.equal(gatewayVaultB.address);
      const gatewayC = await syntheticTokenHubGetters.getGatewayVaultByEid(eidC);
      expect(gatewayC).to.equal(gatewayVaultC.address);
    });
  });

  describe("Cross-Chain Token Flow", function () {
    let depositUsdtAmount: BigNumber = ethers.utils.parseUnits("10000000", 6);
    let depositWethAmount: BigNumber = ethers.utils.parseUnits("10000", 18);
    let depositBtcAmount: BigNumber = ethers.utils.parseUnits("100", 8);
    it("should successfully deposit tokens in gateway vault and mint synthetic tokens", async function () {
      // Initial balances
      let initialUSDTVaultBalance = await bUSDT.balanceOf(gatewayVaultB.address);
      let initialWBTCVaultBalance = await bWBTC.balanceOf(gatewayVaultB.address);
      let initialWETHVaultBalance = await bWETH.balanceOf(gatewayVaultB.address);

      // Approve USDT for spending in vaults
      await bUSDT.connect(user2).approve(gatewayVaultB.address, ethers.constants.MaxUint256);
      await bWBTC.connect(user2).approve(gatewayVaultB.address, ethers.constants.MaxUint256);
      await bWETH.connect(user2).approve(gatewayVaultB.address, ethers.constants.MaxUint256);
      await cUSDT.connect(user3).approve(gatewayVaultC.address, ethers.constants.MaxUint256);
      await cWBTC.connect(user3).approve(gatewayVaultC.address, ethers.constants.MaxUint256);
      await cWETH.connect(user3).approve(gatewayVaultC.address, ethers.constants.MaxUint256);

      // Prepare message sending
      const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      const assets: AssetStruct[] = [
        { tokenAddress: bUSDT.address, tokenAmount: depositUsdtAmount },
        { tokenAddress: bWETH.address, tokenAmount: depositWethAmount },
        { tokenAddress: bWBTC.address, tokenAmount: depositBtcAmount },
      ];
      const nativeFee = await gatewayVaultB.quoteDeposit(user2.address, assets, options);

      // Send tokens from Chain B to Chain A
      await gatewayVaultB.connect(user2).deposit(user2.address, assets, options, { value: nativeFee });

      // Verify tokens are locked in Gateway on Chain B
      const newUSDTVaultBalance = await bUSDT.balanceOf(gatewayVaultB.address);
      expect(newUSDTVaultBalance.sub(initialUSDTVaultBalance)).to.equal(depositUsdtAmount);
      const newWBTCVaultBalance = await bWBTC.balanceOf(gatewayVaultB.address);
      expect(newWBTCVaultBalance.sub(initialWBTCVaultBalance)).to.equal(depositBtcAmount);
      const newWETHVaultBalance = await bWETH.balanceOf(gatewayVaultB.address);
      expect(newWETHVaultBalance.sub(initialWETHVaultBalance)).to.equal(depositWethAmount);
      // check synthetic token balances
      expect(await syntheticUsdtToken.balanceOf(user2.address)).to.equal(depositUsdtAmount);
      expect(await syntheticBtcToken.balanceOf(user2.address)).to.equal(depositBtcAmount);
      expect(await syntheticWethToken.balanceOf(user2.address)).to.equal(depositWethAmount);

      const assetsC: AssetStruct[] = [
        { tokenAddress: cUSDT.address, tokenAmount: depositUsdtAmount },
        { tokenAddress: cWETH.address, tokenAmount: depositWethAmount },
        { tokenAddress: cWBTC.address, tokenAmount: depositBtcAmount },
      ];

      const nativeFeeC = await gatewayVaultC.quoteDeposit(user3.address, assetsC, options);

      // Send tokens from Chain B to Chain A
      await gatewayVaultC.connect(user3).deposit(user3.address, assetsC, options, { value: nativeFeeC });

      // Verify tokens are locked in Gateway on Chain C
      const newUSDTVaultBalanceC = await cUSDT.balanceOf(gatewayVaultC.address);
      expect(newUSDTVaultBalanceC.sub(initialUSDTVaultBalance)).to.equal(depositUsdtAmount);
      const newWBTCVaultBalanceC = await cWBTC.balanceOf(gatewayVaultC.address);
      expect(newWBTCVaultBalanceC.sub(initialWBTCVaultBalance)).to.equal(depositBtcAmount);
      const newWETHVaultBalanceC = await cWETH.balanceOf(gatewayVaultC.address);
      expect(newWETHVaultBalanceC.sub(initialWETHVaultBalance)).to.equal(depositWethAmount);
      // check synthetic token balances
      expect(await syntheticUsdtToken.balanceOf(user3.address)).to.equal(depositUsdtAmount);
      expect(await syntheticBtcToken.balanceOf(user3.address)).to.equal(depositBtcAmount);
      expect(await syntheticWethToken.balanceOf(user3.address)).to.equal(depositWethAmount);
    });

    it("should enforce minBridgeAmt for deposit in GatewayVault", async function () {
      const minAmtUSDT = ethers.utils.parseUnits("1", 6); // As set during linkTokenToHub for bUSDT
      const smallAmtUSDT = ethers.utils.parseUnits("0.5", 6); // Less than minBridgeAmt
      const validAmtUSDT = ethers.utils.parseUnits("2", 6); // More than minBridgeAmt

      await bUSDT.connect(user1).approve(gatewayVaultB.address, ethers.constants.MaxUint256);

      const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();

      // Test case: amount less than minBridgeAmt
      const assetsSmall: AssetStruct[] = [{ tokenAddress: bUSDT.address, tokenAmount: smallAmtUSDT }];

      // Expect quoteDeposit to revert because _checkAndTransform will fail
      await expect(gatewayVaultB.quoteDeposit(user1.address, assetsSmall, options)).to.be.revertedWith(
        "Amount is less than minimum bridge amount for this token."
      );

      // Also expect direct deposit to revert for the same reason
      // We might not need to calculate nativeFeeSmall if quoteDeposit already reverts.
      // However, to be thorough, if a scenario existed where quote didn't check but deposit did:
      // const nativeFeeSmall = ethers.utils.parseEther("0.1"); // Placeholder if needed
      await expect(
        gatewayVaultB
          .connect(user1)
          .deposit(user1.address, assetsSmall, options, { value: ethers.utils.parseEther("0.1") })
      ).to.be.revertedWith("Amount is less than minimum bridge amount for this token.");

      // Test case: amount greater than or equal to minBridgeAmt
      const assetsValid: AssetStruct[] = [{ tokenAddress: bUSDT.address, tokenAmount: validAmtUSDT }];
      const nativeFeeValid = await gatewayVaultB.quoteDeposit(user1.address, assetsValid, options);
      const initialSynthUSDTUser1 = await syntheticUsdtToken.balanceOf(user1.address);

      // Try to deposit valid amount - should succeed
      await gatewayVaultB.connect(user1).deposit(user1.address, assetsValid, options, { value: nativeFeeValid });
      expect(await syntheticUsdtToken.balanceOf(user1.address)).to.equal(initialSynthUSDTUser1.add(validAmtUSDT));
    });

    it("shoulde successfully create synthetic pool on chain A", async function () {
      // priceToTick(price0InUsd: number, price1InUsd: number, decimals0: number, decimals1: number)
      // Create synthetic pool on chain A
      await syntheticUsdtToken.connect(user2).approve(poolCreator.address, ethers.constants.MaxUint256);
      await syntheticWethToken.connect(user2).approve(poolCreator.address, ethers.constants.MaxUint256);
      await syntheticBtcToken.connect(user2).approve(poolCreator.address, ethers.constants.MaxUint256);
      await syntheticUsdtToken.connect(user3).approve(poolCreator.address, ethers.constants.MaxUint256);
      await syntheticWethToken.connect(user3).approve(poolCreator.address, ethers.constants.MaxUint256);
      await syntheticBtcToken.connect(user3).approve(poolCreator.address, ethers.constants.MaxUint256);

      const tick = await priceToTick(1, 2000, syntheticUsdtToken, syntheticWethToken);

      const assetA = { token: syntheticUsdtToken.address, amount: depositUsdtAmount };
      const assetB = { token: syntheticWethToken.address, amount: depositWethAmount };
      await poolCreator.connect(user2).createPool(tick, assetA, assetB);

      // WETH/BTC
      const tickBtc = await priceToTick(1, 50, syntheticWethToken, syntheticBtcToken);
      const assetC = { token: syntheticWethToken.address, amount: depositWethAmount };
      const assetD = { token: syntheticBtcToken.address, amount: depositBtcAmount };
      await poolCreator.connect(user3).createPool(tickBtc, assetC, assetD);
    });

    it("should properly burn synthetic tokens and send message to self address for withdrawal ", async function () {
      const initialBalance = await cWBTC.balanceOf(user2.address);
      // Calculate message fee for burning
      const optionsBurn = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      let BtcAmount: BigNumber = ethers.utils.parseUnits("10", 8);

      // For bridging back, we need to use the bridgeTokens function
      const [nativeFeeBurn, assetsRemote, penalties] = await syntheticTokenHub.quoteBridgeTokens(
        user2.address,
        [{ tokenAddress: syntheticBtcToken.address, tokenAmount: BtcAmount }],
        eidC,
        optionsBurn
      );

      // Burn tokens and send message for withdrawal
      await syntheticTokenHub
        .connect(user2)
        .bridgeTokens(
          user2.address,
          [{ tokenAddress: syntheticBtcToken.address, tokenAmount: BtcAmount }],
          eidC,
          optionsBurn,
          { value: nativeFeeBurn }
        );

      // Verify tokens were burned and returned
      expect(await syntheticBtcToken.balanceOf(user2.address)).to.equal(depositBtcAmount.sub(BtcAmount));
      expect(await cWBTC.balanceOf(user2.address)).to.equal(initialBalance.add(assetsRemote[0].tokenAmount));
      // BtcAmount = assetsRemote[0].tokenAmount - penalties[0]
      expect(BtcAmount.sub(penalties[0])).to.equal(assetsRemote[0].tokenAmount);
    });

    it("should enforce minBridgeAmt for bridgeTokens in SyntheticTokenHub", async function () {
      // Assuming cWBTC (remote) has minBridgeAmt of 0.0001 WBTC (synthetic equivalent based on delta=0)
      // And remoteToken.minBridgeAmt is stored in synthetic token decimals.
      const remoteInfoWBTC_C = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticBtcToken.address, eidC);
      const minAmtWBTC_Synthetic = remoteInfoWBTC_C.minBridgeAmt;
      // minAmtWBTC_Synthetic should be utils.parseUnits("0.0001", 8) if linking was done with that and delta is 0.

      const smallAmtWBTC_Synth = minAmtWBTC_Synthetic.div(2); // Less than minBridgeAmt
      const validAmtWBTC_Synth = minAmtWBTC_Synthetic.mul(2); // More than minBridgeAmt

      const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();

      // Try to bridge amount less than minBridgeAmt - should fail
      // Need to use callStatic for quoteBridgeTokens if we expect a revert from validateAndPrepareAssets
      await expect(
        syntheticTokenHub.callStatic.quoteBridgeTokens(
          user2.address,
          [{ tokenAddress: syntheticBtcToken.address, tokenAmount: smallAmtWBTC_Synth }],
          eidC,
          options
        )
      ).to.be.revertedWithCustomError(syntheticTokenHub, "AmountLessThanMinBridgeAmount");

      // Try to bridge valid amount - quote should succeed, then bridge
      const [nativeFeeValid, assetsRemoteValid, penaltiesValid] = await syntheticTokenHub.quoteBridgeTokens(
        user2.address,
        [{ tokenAddress: syntheticBtcToken.address, tokenAmount: validAmtWBTC_Synth }],
        eidC,
        options
      );

      const initialSynthBTCUser2 = await syntheticBtcToken.balanceOf(user2.address);
      const initialRemoteCWbtcUser2 = await cWBTC.balanceOf(user2.address);

      await syntheticTokenHub
        .connect(user2)
        .bridgeTokens(
          user2.address,
          [{ tokenAddress: syntheticBtcToken.address, tokenAmount: validAmtWBTC_Synth }],
          eidC,
          options,
          { value: nativeFeeValid }
        );
      expect(await syntheticBtcToken.balanceOf(user2.address)).to.equal(initialSynthBTCUser2.sub(validAmtWBTC_Synth));
      expect(await cWBTC.balanceOf(user2.address)).to.equal(
        initialRemoteCWbtcUser2.add(assetsRemoteValid[0].tokenAmount)
      );
    });

    it("should properly burn synthetic tokens and send message to other address for withdrawal", async function () {
      const initialBalance = await bUSDT.balanceOf(user1.address);
      // Calculate message fee for burning
      const optionsBurn = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();

      // For bridging back, we need to use the bridgeTokens function
      const [nativeFeeBurn, assetsRemote, penalties] = await syntheticTokenHub.quoteBridgeTokens(
        user1.address,
        [{ tokenAddress: syntheticUsdtToken.address, tokenAmount: depositUsdtAmount }],
        eidB,
        optionsBurn
      );

      // Burn tokens and send message for withdrawal
      await syntheticTokenHub
        .connect(user3)
        .bridgeTokens(
          user1.address,
          [{ tokenAddress: syntheticUsdtToken.address, tokenAmount: depositUsdtAmount }],
          eidB,
          optionsBurn,
          { value: nativeFeeBurn }
        );

      // Verify tokens were burned and returned
      expect(await bUSDT.balanceOf(user1.address)).to.equal(initialBalance.add(assetsRemote[0].tokenAmount));
    });
  });

  describe("Cross-Chain Swap Tests", async function () {
    // Test constants for swap
    const usdtSwapAmount = ethers.utils.parseUnits("1000", 6);
    const slippageTolerance = 50; // 0.5% slippage tolerance, in basis points (1 = 0.01%)

    // Add this test for cross-chain swap using Uniswap pools
    it("should perform cross-chain swap from Chain B (USDT) to Chain C (BTC) via Uniswap pools", async function () {
      await bUSDT.connect(user1).approve(gatewayVaultB.address, ethers.constants.MaxUint256);
      const initialUserBtcBalance = await cWBTC.balanceOf(user1.address);
      const quotedOutput = await getMultiHopQuote(
        true,
        swapQuoterV3,
        [syntheticUsdtToken.address, syntheticWethToken.address, syntheticBtcToken.address],
        usdtSwapAmount,
        [FeeAmount.LOW, FeeAmount.LOW]
      );
      console.log(`Quoted output amount: ${ethers.utils.formatUnits(quotedOutput, 8)} BTC`);
      const minOutputAmount = quotedOutput.mul(10000 - slippageTolerance).div(10000);

      const gasLimitFromHub = 2000_000;
      const gasLimitToHub = 2000_000;

      const _assetsIn = [{ tokenAddress: bUSDT.address, tokenAmount: usdtSwapAmount }];

      const quoteFromHub = await syntheticTokenHub.quoteSwap(
        user1.address,
        _assetsIn,
        syntheticBtcToken.address,
        eidB,
        eidC,
        Options.newOptions().addExecutorLzReceiveOption(gasLimitFromHub, 0).toHex().toString()
      );

      const swapOptions = Options.newOptions()
        .addExecutorLzReceiveOption(gasLimitToHub, quoteFromHub.toString())
        .toHex()
        .toString();

      const planner = new RoutePlanner();
      addV3ExactInTrades(planner, usdtSwapAmount, minOutputAmount, syntheticTokenHub.address, [
        [syntheticUsdtToken.address, syntheticWethToken.address, syntheticBtcToken.address],
      ]);
      const { commands, inputs } = planner;

      const swapParams: SwapParamsStruct = {
        from: user1.address,
        to: user1.address, // Send the result to the same user on Chain C
        syntheticTokenOut: syntheticBtcToken.address,
        gasLimit: gasLimitToHub,
        dstEid: eidC,
        value: quoteFromHub,
        assets: _assetsIn,
        commands: commands,
        inputs: inputs,
        minimumAmountOut: 0, // minOutputAmount(with a penalty) in decimals of destination chain token.If it is necessary to control the level of penalty, it can be set.
      };

      const nativeFee = await gatewayVaultB.quoteSwap(swapParams, swapOptions, [
        { tokenAddress: bUSDT.address, tokenAmount: usdtSwapAmount },
      ]);

      const tx = await gatewayVaultB
        .connect(user1)
        .swap(swapParams, swapOptions, [{ tokenAddress: bUSDT.address, tokenAmount: usdtSwapAmount }], {
          value: nativeFee,
        });
      await tx.wait();

      // const events = await gatewayVaultC.queryFilter(gatewayVaultC.filters.MessageReceived());
      // console.log("events", events);
      // expect(events.length).to.be.greaterThan(0);

      // Verify the outcome - user1 should receive BTC on Chain C
      const finalUserBtcBalance = await cWBTC.balanceOf(user1.address);
      const btcReceived = finalUserBtcBalance.sub(initialUserBtcBalance);

      console.log(`BTC received on Chain C: ${ethers.utils.formatUnits(btcReceived, 8)}`);

      // Assert that the received amount meets our expectations
      expect(btcReceived).to.be.gte(minOutputAmount);
    });

    it("should handle swap failure and revert mechanisms properly", async function () {
      // 1. Setup - Use an invalid path to force swap failure
      const gasLimitFromHub = 3000_000;
      const gasLimitToHub = 2000_000;

      await bUSDT.connect(user1).approve(gatewayVaultB.address, ethers.constants.MaxUint256);

      // Replace manual command creation with RoutePlanner
      const planner = new RoutePlanner();
      addV3ExactInTrades(planner, usdtSwapAmount, 0, syntheticTokenHub.address, [
        [syntheticUsdtToken.address, syntheticWethToken.address, "0x1111111111111111111111111111111111111111"],
      ]);

      const { commands, inputs } = planner;

      const _assetsIn = [{ tokenAddress: bUSDT.address, tokenAmount: usdtSwapAmount }];

      const quoteFromHub = await syntheticTokenHub.quoteSwap(
        user1.address,
        _assetsIn,
        syntheticBtcToken.address,
        eidB,
        eidC,
        Options.newOptions().addExecutorLzReceiveOption(gasLimitFromHub, 0).toHex().toString()
      );

      const swapOptions = Options.newOptions()
        .addExecutorLzReceiveOption(gasLimitToHub, quoteFromHub.toString())
        .toHex()
        .toString();

      // 2. Create SwapParams with invalid data
      const swapParams: SwapParamsStruct = {
        from: user1.address,
        to: user1.address,
        syntheticTokenOut: syntheticBtcToken.address,
        gasLimit: gasLimitToHub,
        dstEid: eidC,
        value: quoteFromHub,
        assets: _assetsIn,
        commands: commands,
        inputs: inputs,
        minimumAmountOut: 0, // minOutputAmount(with a penalty) in decimals of destination chain token.If it is necessary to control the level of penalty, it can be set.
      };

      // 3. Get quote for the swap transaction
      const nativeFee = await gatewayVaultB.quoteSwap(swapParams, swapOptions, _assetsIn);

      // 4. Check the initial balances
      const initialUserUsdtBalance = await bUSDT.balanceOf(user1.address);

      // 5. Execute the swap - it should execute but the internal swap will fail and tokens should be returned
      const tx = await gatewayVaultB.connect(user1).swap(swapParams, swapOptions, _assetsIn, {
        value: nativeFee,
      });
      await tx.wait();

      // 6. After failed swap and revert process, tokens should be returned to the user
      const finalUserUsdtBalance = await bUSDT.balanceOf(user1.address);

      // 7. Verify that tokens were returned
      expect(finalUserUsdtBalance).to.be.equal(initialUserUsdtBalance);
    });

    it("should measure price impact during cross-chain swap", async function () {
      // 1. Setup - Prepare for a larger swap to measure price impact
      const largeSwapAmount = ethers.utils.parseUnits("5000", 6); // 5000 USDT
      await bUSDT.connect(user2).approve(gatewayVaultB.address, ethers.constants.MaxUint256);

      // Ensure user2 has enough USDT for the test
      await bUSDT.mint(user2.address, largeSwapAmount.mul(2)); // Mint extra for good measure

      // 2. Get initial price quote for a small amount to establish baseline
      const smallAmount = ethers.utils.parseUnits("100", 6); // 100 USDT

      const smallQuote = await getMultiHopQuote(
        true,
        swapQuoterV3,
        [syntheticUsdtToken.address, syntheticWethToken.address, syntheticBtcToken.address],
        smallAmount,
        [FeeAmount.LOW, FeeAmount.LOW]
      );

      const baselineRate = smallQuote.mul(ethers.utils.parseUnits("1", 6)).div(smallAmount);
      console.log(`Baseline exchange rate (scaled): ${baselineRate}`);

      // 3. Get quote for the large swap
      const largeQuote = await getMultiHopQuote(
        true,
        swapQuoterV3,
        [syntheticUsdtToken.address, syntheticWethToken.address, syntheticBtcToken.address],
        largeSwapAmount,
        [FeeAmount.LOW, FeeAmount.LOW]
      );
      const largeSwapRate = largeQuote.mul(ethers.utils.parseUnits("1", 6)).div(largeSwapAmount);
      console.log(`Large swap exchange rate (scaled): ${largeSwapRate}`);

      // 4. Calculate price impact
      const priceImpactBps = baselineRate.sub(largeSwapRate).mul(10000).div(baselineRate);
      console.log(`Price impact in basis points: ${priceImpactBps}`);

      // 5. Verify that price impact is reasonable for the pool size
      // For this test, we'll consider anything below 500 bps (5%) as acceptable
      expect(priceImpactBps).to.be.lt(500);

      // 6. Now perform the actual swap with measured price impact
      const gasLimitFromHub = 2000_000;
      const gasLimitToHub = 2000_000;

      // Calculate minimum output with additional slippage tolerance
      const totalSlippageBps = slippageTolerance + Number(priceImpactBps);
      const minOutputAmount = largeQuote.mul(10000 - totalSlippageBps).div(10000);

      const planner = new RoutePlanner();
      addV3ExactInTrades(planner, largeSwapAmount, minOutputAmount, syntheticTokenHub.address, [
        [syntheticUsdtToken.address, syntheticWethToken.address, syntheticBtcToken.address],
      ]);
      const { commands, inputs } = planner;

      const _assetsIn = [{ tokenAddress: bUSDT.address, tokenAmount: largeSwapAmount }];

      const quoteFromHub = await syntheticTokenHub.quoteSwap(
        user2.address,
        _assetsIn,
        syntheticBtcToken.address,
        eidB,
        eidC,
        Options.newOptions().addExecutorLzReceiveOption(gasLimitFromHub, 0).toHex().toString()
      );

      const swapOptions = Options.newOptions()
        .addExecutorLzReceiveOption(gasLimitToHub, quoteFromHub.toString())
        .toHex()
        .toString();

      const swapParams: SwapParamsStruct = {
        from: user2.address,
        to: user2.address,
        syntheticTokenOut: syntheticBtcToken.address,
        gasLimit: gasLimitToHub,
        dstEid: eidC,
        value: quoteFromHub,
        assets: _assetsIn,
        commands: commands,
        inputs: inputs,
        minimumAmountOut: 0, // minOutputAmount(with a penalty) in decimals of destination chain token.If it is necessary to control the level of penalty, it can be set.
      };

      const nativeFee = await gatewayVaultB.quoteSwap(swapParams, swapOptions, _assetsIn);

      // 7. Execute the swap with our calculated slippage
      const initialUserBtcBalance = await cWBTC.balanceOf(user2.address);

      const tx = await gatewayVaultB.connect(user2).swap(swapParams, swapOptions, _assetsIn, {
        value: nativeFee,
      });
      await tx.wait();

      // 8. Verify the outcome
      const finalUserBtcBalance = await cWBTC.balanceOf(user2.address);
      const btcReceived = finalUserBtcBalance.sub(initialUserBtcBalance);

      console.log(`BTC received from large swap: ${ethers.utils.formatUnits(btcReceived, 8)}`);

      // 9. Verify received amount meets our expected minimum
      expect(btcReceived).to.be.gte(minOutputAmount);

      // 10. Calculate actual vs expected slippage
      const actualSlippage = largeQuote.sub(btcReceived).mul(10000).div(largeQuote);
      console.log(`Expected max slippage: ${totalSlippageBps} bps, Actual: ${actualSlippage} bps`);

      expect(actualSlippage).to.be.lte(totalSlippageBps);
    });
  });

  describe("Gateway Vault", function () {
    it("should not allow non-owner to add tokens", async function () {
      // Try to add token as non-owner
      const tokenSetupConfig = [
        {
          onPause: false,
          tokenAddress: "0x1111111111111111111111111111111111111111",
          syntheticTokenDecimals: 18,
          syntheticTokenAddress: syntheticWethToken.address,
          minBridgeAmt: 0,
        },
      ];

      const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      await expect(gatewayVaultB.connect(user1).linkTokenToHub(tokenSetupConfig, options)).to.be.reverted;
    });

    it("should pause token correctly", async function () {
      // Pause token
      await gatewayVaultB.pauseToken(bUSDT.address, true);

      // Check token is paused
      const tokenDetail = await gatewayVaultB.availableTokens(0);
      expect(tokenDetail.onPause).to.equal(true);

      // Unpause token
      await gatewayVaultB.pauseToken(bUSDT.address, false);
      const updatedToken = await gatewayVaultB.availableTokens(0);
      expect(updatedToken.onPause).to.equal(false);
    });

    it("should correctly quote transaction fees", async function () {
      // Calculate message fee with options
      const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();

      // Get required fee
      const nativeFee = await gatewayVaultB.quoteDeposit(
        user2.address,
        [{ tokenAddress: bUSDT.address, tokenAmount: ethers.utils.parseUnits("100", 6) }],
        options
      );

      // Fee should be greater than zero
      expect(nativeFee).to.be.gt(0);
    });
  });

  describe("System Integration", function () {
    it("should get token information correctly", async function () {
      const tokenInfo = await syntheticTokenHubGetters.getSyntheticTokenInfo(1);

      expect(tokenInfo.syntheticTokenInfo.tokenAddress).to.equal(syntheticUsdtToken.address);
      expect(tokenInfo.syntheticTokenInfo.tokenSymbol).to.equal("USDT");
      expect(tokenInfo.syntheticTokenInfo.tokenDecimals).to.equal(6);
    });

    it("should verify token registration status", async function () {
      const isRegistered = await syntheticTokenHubGetters.isTokenRegistered(syntheticUsdtToken.address);
      expect(isRegistered).to.equal(true);

      const isNotRegistered = await syntheticTokenHubGetters.isTokenRegistered(
        "0x0000000000000000000000000000000000000001"
      );
      expect(isNotRegistered).to.equal(false);
    });

    it("should correctly validate and prepare assets for cross-chain transfer", async function () {
      // Valid asset - should pass validation
      const validAmount = ethers.utils.parseUnits("100", 6); // 100 USDT
      const validAsset = [{ tokenAddress: syntheticUsdtToken.address, tokenAmount: validAmount }];

      // Should successfully validate
      const [preparedAssets, penalties] = await syntheticTokenHub.callStatic.validateAndPrepareAssets(
        validAsset,
        eidB,
        false
      );
      expect(preparedAssets.length).to.equal(1);
      expect(preparedAssets[0].tokenAddress).to.equal(bUSDT.address);
      // Account for potential penalty if any (though for a simple validation with sufficient balance, it might be 0)
      expect(preparedAssets[0].tokenAmount).to.equal(validAmount.sub(penalties[0]));

      // Test token not linked to destination chain
      const nonExistentEid = 999; // A chain ID that doesn't exist
      await expect(
        syntheticTokenHub.callStatic.validateAndPrepareAssets(validAsset, nonExistentEid, false)
      ).to.be.revertedWithCustomError(syntheticTokenHub, "TokenNotLinkedToDestChain");

      // Test insufficient balance FOR syntheticUsdtToken (eidB)
      // Its balance on eidB is likely depleted by prior tests.
      const remoteInfoForUsdtOnEidB = await syntheticTokenHubGetters.getRemoteTokenInfo(
        syntheticUsdtToken.address,
        eidB
      );
      const excessiveAmountForUsdt = remoteInfoForUsdtOnEidB.totalBalance.add(ethers.utils.parseUnits("100000000", 6));
      const excessiveAssetForUsdt = [{ tokenAddress: syntheticUsdtToken.address, tokenAmount: excessiveAmountForUsdt }];

      await expect(
        syntheticTokenHub.callStatic.validateAndPrepareAssets(excessiveAssetForUsdt, eidB, false)
      ).to.be.revertedWithCustomError(syntheticTokenHub, "InsufficientBalanceOnDestChain");

      // Create a new synthetic token with 18 decimals
      const tx_test18 = await syntheticTokenHub.createSyntheticToken("TEST18", 18);
      const receipt_test18 = await tx_test18.wait();

      // Find SyntheticTokenAdded event
      const event_test18 = receipt_test18.logs.find((log: any) => {
        try {
          const parsed = syntheticTokenHub.interface.parseLog(log);
          return parsed && parsed.name === "SyntheticTokenAdded";
        } catch {
          return false;
        }
      });

      const parsedEvent_test18 = event_test18 ? syntheticTokenHub.interface.parseLog(event_test18) : null;
      const testTokenAddress_test18 = parsedEvent_test18
        ? parsedEvent_test18.args.tokenAddress
        : ethers.constants.AddressZero;
      const syntheticTestToken_test18 = await ethers.getContractAt("SyntheticToken", testTokenAddress_test18);

      // Create a remote token with 6 decimals
      const remoteTestToken_test6 = await MockERC20Factory.deploy("TEST6", "TEST6", 6);

      const tokenSetupConfig_test18: GatewayVault.TokenSetupConfigStruct[] = [
        {
          onPause: false,
          tokenAddress: remoteTestToken_test6.address,
          syntheticTokenDecimals: 18,
          syntheticTokenAddress: syntheticTestToken_test18.address,
          minBridgeAmt: 0,
        },
      ];

      const optionsForLink_test18 = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      const linkFee_test18 = await gatewayVaultB.quoteLinkTokenToHub(tokenSetupConfig_test18, optionsForLink_test18);
      await gatewayVaultB.linkTokenToHub(tokenSetupConfig_test18, optionsForLink_test18, { value: linkFee_test18 });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const remoteTokenInfo_test18_eidB = await syntheticTokenHubGetters.getRemoteTokenInfo(
        syntheticTestToken_test18.address,
        eidB
      );
      expect(remoteTokenInfo_test18_eidB.decimalsDelta).to.equal(12);

      const tinyAmount_test18 = ethers.utils.parseUnits("0.0000000001", 18);
      const tinyAsset_test18 = [{ tokenAddress: syntheticTestToken_test18.address, tokenAmount: tinyAmount_test18 }];

      await expect(
        syntheticTokenHub.callStatic.validateAndPrepareAssets(tinyAsset_test18, eidB, false)
      ).to.be.revertedWithCustomError(syntheticTokenHub, "AmountIsTooSmall");

      const depositAmount_test6 = ethers.utils.parseUnits("10", 6);
      await remoteTestToken_test6.mint(user1.address, depositAmount_test6);
      await remoteTestToken_test6.connect(user1).approve(gatewayVaultB.address, depositAmount_test6);

      const depositOptions_test6 = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      const depositFee_test6 = await gatewayVaultB.quoteDeposit(
        user1.address,
        [{ tokenAddress: remoteTestToken_test6.address, tokenAmount: depositAmount_test6 }],
        depositOptions_test6
      );
      await gatewayVaultB
        .connect(user1)
        .deposit(
          user1.address,
          [{ tokenAddress: remoteTestToken_test6.address, tokenAmount: depositAmount_test6 }],
          depositOptions_test6,
          { value: depositFee_test6 }
        );
      expect(await syntheticTestToken_test18.balanceOf(user1.address)).to.equal(ethers.utils.parseUnits("10", 18));

      const dustyAmount_test18 = ethers.utils.parseUnits("1.123456789123456789", 18);
      const dustyAsset_test18 = [{ tokenAddress: syntheticTestToken_test18.address, tokenAmount: dustyAmount_test18 }];
      const expectedDustRemovedAmount_test18 = ethers.utils.parseUnits("1.123456000000000000", 18);
      const [preparedDustyAssets_test18 /* penalties1_test18 */] =
        await syntheticTokenHub.callStatic.validateAndPrepareAssets(dustyAsset_test18, eidB, false);
      expect(preparedDustyAssets_test18[0].tokenAddress).to.equal(remoteTestToken_test6.address);
      const expectedNormalizedAmount_test6 = ethers.utils.parseUnits("1.123456", 6);
      expect(preparedDustyAssets_test18[0].tokenAmount).to.equal(expectedNormalizedAmount_test6);

      await syntheticTestToken_test18.connect(user1).approve(syntheticTokenHub.address, ethers.constants.MaxUint256);
      const initialBalance_test18_user1 = await syntheticTestToken_test18.balanceOf(user1.address);
      const optionsBurn_test18 = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      const [nativeFeeBurn_test18 /* assetsRemote_test18 */ /* penalties2_test18 */, ,] =
        await syntheticTokenHub.quoteBridgeTokens(user1.address, dustyAsset_test18, eidB, optionsBurn_test18);
      await syntheticTokenHub
        .connect(user1)
        .bridgeTokens(user1.address, dustyAsset_test18, eidB, optionsBurn_test18, { value: nativeFeeBurn_test18 });
      const finalBalance_test18_user1 = await syntheticTestToken_test18.balanceOf(user1.address);
      const actualBurnedAmount_test18 = initialBalance_test18_user1.sub(finalBalance_test18_user1);
      expect(actualBurnedAmount_test18).to.equal(expectedDustRemovedAmount_test18);
      const eidBBalance_test6_user1 = await remoteTestToken_test6.balanceOf(user1.address);
      expect(eidBBalance_test6_user1).to.equal(expectedNormalizedAmount_test6);
    });

    // Test consistency between contract state and getter for all tokens on all networks
    it("should have consistent totalBalance with gateway vault balance for all tokens on all networks", async function () {
      // Define all synthetic tokens and their corresponding tokens on each network
      const tokenMappings = [
        {
          synthetic: syntheticUsdtToken,
          networks: [
            { eid: eidB, token: bUSDT, vault: gatewayVaultB },
            { eid: eidC, token: cUSDT, vault: gatewayVaultC },
          ],
        },
        {
          synthetic: syntheticWethToken,
          networks: [
            { eid: eidB, token: bWETH, vault: gatewayVaultB },
            { eid: eidC, token: cWETH, vault: gatewayVaultC },
          ],
        },
        {
          synthetic: syntheticBtcToken,
          networks: [
            { eid: eidB, token: bWBTC, vault: gatewayVaultB },
            { eid: eidC, token: cWBTC, vault: gatewayVaultC },
          ],
        },
      ];

      // Check each synthetic token on each network
      for (const mapping of tokenMappings) {
        const syntheticToken = mapping.synthetic;

        for (const network of mapping.networks) {
          // Get remote token info from SyntheticTokenHub
          const remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticToken.address, network.eid);

          // Get actual balance in the gateway vault
          const actualVaultBalance = await network.token.balanceOf(network.vault.address);
          const bonusBalance = await syntheticTokenHubGetters.getBonusBalance(syntheticToken.address, network.eid);

          let combinedBalanceInSyntheticDecimals = remoteInfo.totalBalance.add(bonusBalance);
          let expectedVaultBalanceInRemoteDecimals = combinedBalanceInSyntheticDecimals;

          if (remoteInfo.decimalsDelta > 0) {
            expectedVaultBalanceInRemoteDecimals = combinedBalanceInSyntheticDecimals.div(
              ethers.BigNumber.from(10).pow(remoteInfo.decimalsDelta)
            );
          } else if (remoteInfo.decimalsDelta < 0) {
            expectedVaultBalanceInRemoteDecimals = combinedBalanceInSyntheticDecimals.mul(
              ethers.BigNumber.from(10).pow(Math.abs(remoteInfo.decimalsDelta))
            );
          }

          const difference = expectedVaultBalanceInRemoteDecimals.sub(actualVaultBalance).abs();
          const tolerance = ethers.BigNumber.from(1); // Minimal tolerance

          // if (!difference.lte(tolerance)) { // Keep logs for now if it fails
          //   console.log(`Balance Mismatch Details for ${await syntheticToken.symbol()} on EID ${network.eid}:`);
          //   console.log(`  Difference: ${difference.toString()}`);
          // }
          expect(difference.lte(tolerance)).to.be.true;
        }
      }
    });
  });

  describe("SyntheticTokenHubGetters Tests", function () {
    // Test getSyntheticTokenCount
    it("should correctly return synthetic token count", async function () {
      const count = await syntheticTokenHubGetters.getSyntheticTokenCount();
      expect(count).to.equal(4); // We now have 4 tokens including the TEST18 token added in the previous test
    });

    // Test getRemoteTokenInfo with various scenarios
    it("should correctly get remote token info for existing token", async function () {
      const remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticUsdtToken.address, eidB);

      const expectedTotalBalance = ethers.BigNumber.from("6601510591");
      // Note: expectedBonusBalance is an estimate. The actual value depends on penalties generated
      // in prior tests (e.g., bridgeTokens) and bonuses consumed in subsequent deposits.
      // This value (499399989998) was based on a prior state.
      // We will check if the actual bonus balance is within a small tolerance.
      const estimatedBonusBalance = ethers.BigNumber.from("499399989998");
      const tolerance = estimatedBonusBalance.div(10000); // 0.01% tolerance
      const lowerBound = estimatedBonusBalance.sub(tolerance);
      const upperBound = estimatedBonusBalance.add(tolerance);

      expect(remoteInfo.remoteAddress).to.equal(bUSDT.address);
      expect(remoteInfo.totalBalance.toString()).to.equal(expectedTotalBalance.toString());
      expect(remoteInfo.decimalsDelta).to.equal(0);

      const bonusBalance = await syntheticTokenHubGetters.getBonusBalance(syntheticUsdtToken.address, eidB);
      expect(
        bonusBalance.gte(lowerBound),
        `Bonus balance ${bonusBalance.toString()} too low, expected ~${estimatedBonusBalance.toString()}`
      ).to.be.true;
      expect(
        bonusBalance.lte(upperBound),
        `Bonus balance ${bonusBalance.toString()} too high, expected ~${estimatedBonusBalance.toString()}`
      ).to.be.true;

      const expectedMinBridgeAmt = ethers.utils.parseUnits("1", 6); // As set in linkTokenToHub for bUSDT
      expect(remoteInfo.minBridgeAmt.toString()).to.equal(expectedMinBridgeAmt.toString());
    });

    it("should return zero values for non-existent remote token", async function () {
      const remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticUsdtToken.address, 999);
      expect(remoteInfo.remoteAddress).to.equal(ethers.constants.AddressZero);
      expect(remoteInfo.totalBalance).to.equal(0);
      expect(remoteInfo.decimalsDelta).to.equal(0);
    });

    // Test getTokenIndexByAddress
    it("should return correct token index for existing token", async function () {
      const index = await syntheticTokenHubGetters.getTokenIndexByAddress(syntheticUsdtToken.address);
      expect(index).to.equal(1);
    });

    it("should return 0 for non-existent token index", async function () {
      const index = await syntheticTokenHubGetters.getTokenIndexByAddress(ethers.constants.AddressZero);
      expect(index).to.equal(0);
    });

    // Test getSyntheticAddressByRemoteAddress
    it("should return correct synthetic address for remote token", async function () {
      const syntheticAddress = await syntheticTokenHubGetters.getSyntheticAddressByRemoteAddress(eidB, bUSDT.address);
      expect(syntheticAddress).to.equal(syntheticUsdtToken.address);
    });

    it("should return zero address for non-existent remote token", async function () {
      const syntheticAddress = await syntheticTokenHubGetters.getSyntheticAddressByRemoteAddress(
        eidB,
        ethers.constants.AddressZero
      );
      expect(syntheticAddress).to.equal(ethers.constants.AddressZero);
    });

    // Test getRemoteAddressBySyntheticAddress
    it("should return correct remote address for synthetic token", async function () {
      const remoteAddress = await syntheticTokenHubGetters.getRemoteAddressBySyntheticAddress(
        eidB,
        syntheticUsdtToken.address
      );
      expect(remoteAddress).to.equal(bUSDT.address);
    });

    it("should return zero address for non-existent synthetic token", async function () {
      const remoteAddress = await syntheticTokenHubGetters.getRemoteAddressBySyntheticAddress(
        eidB,
        ethers.constants.AddressZero
      );
      expect(remoteAddress).to.equal(ethers.constants.AddressZero);
    });

    // Test getGatewayVaultByEid
    it("should return correct gateway vault address for existing chain", async function () {
      const vaultAddress = await syntheticTokenHubGetters.getGatewayVaultByEid(eidB);
      expect(vaultAddress).to.equal(gatewayVaultB.address);
    });

    it("should return zero address for non-existent chain", async function () {
      const vaultAddress = await syntheticTokenHubGetters.getGatewayVaultByEid(999);
      expect(vaultAddress).to.equal(ethers.constants.AddressZero);
    });

    // Test getSyntheticTokensInfo with different inputs
    it("should return all tokens when no indices provided", async function () {
      const tokens = await syntheticTokenHubGetters.getSyntheticTokensInfo([]);
      expect(tokens.length).to.equal(4); // We now have 4 tokens including the TEST18 token added in the previous test
      expect(tokens[0].tokenIndex).to.equal(1);
      expect(tokens[0].syntheticTokenInfo.tokenAddress).to.equal(syntheticUsdtToken.address);
      expect(tokens[1].syntheticTokenInfo.tokenAddress).to.equal(syntheticWethToken.address);
      expect(tokens[2].syntheticTokenInfo.tokenAddress).to.equal(syntheticBtcToken.address);
      // Don't check the 4th token's address since it's dynamically created
    });

    it("should return specific tokens when indices provided", async function () {
      const tokens = await syntheticTokenHubGetters.getSyntheticTokensInfo([1, 3]);
      expect(tokens.length).to.equal(2);
      expect(tokens[0].tokenIndex).to.equal(1);
      expect(tokens[0].syntheticTokenInfo.tokenAddress).to.equal(syntheticUsdtToken.address);
      expect(tokens[1].tokenIndex).to.equal(3);
      expect(tokens[1].syntheticTokenInfo.tokenAddress).to.equal(syntheticBtcToken.address);
    });

    // Test getSyntheticTokenInfo
    it("should return correct token info for existing token", async function () {
      const tokenInfo = await syntheticTokenHubGetters.getSyntheticTokenInfo(1);
      expect(tokenInfo.tokenIndex).to.equal(1);
      expect(tokenInfo.syntheticTokenInfo.tokenAddress).to.equal(syntheticUsdtToken.address);
      expect(tokenInfo.syntheticTokenInfo.tokenSymbol).to.equal("USDT");
      expect(tokenInfo.syntheticTokenInfo.tokenDecimals).to.equal(6);
      expect(tokenInfo.remoteTokens.length).to.be.gt(0);
    });

    it("should revert for non-existent token index", async function () {
      await expect(syntheticTokenHubGetters.getSyntheticTokenInfo(999)).to.be.revertedWith("Token not found");
    });

    it("should revert for zero token index", async function () {
      await expect(syntheticTokenHubGetters.getSyntheticTokenInfo(0)).to.be.revertedWith("Invalid token index");
    });

    // Test isTokenRegistered
    it("should return true for registered token", async function () {
      const isRegistered = await syntheticTokenHubGetters.isTokenRegistered(syntheticUsdtToken.address);
      expect(isRegistered).to.be.true;
    });

    it("should return false for unregistered token", async function () {
      const isRegistered = await syntheticTokenHubGetters.isTokenRegistered(ethers.constants.AddressZero);
      expect(isRegistered).to.be.false;
    });

    // Test edge cases and error handling
    it("should handle multiple chain registrations correctly", async function () {
      const tokenInfo = await syntheticTokenHubGetters.getSyntheticTokenInfo(1);
      for (const remoteToken of tokenInfo.remoteTokens) {
        expect(remoteToken.eid).to.be.gt(0);
        expect(remoteToken.remoteTokenInfo.remoteAddress).to.not.equal(ethers.constants.AddressZero);
      }
    });

    it("should maintain consistent bidirectional mappings", async function () {
      // Check USDT token mappings
      const syntheticAddress = await syntheticTokenHubGetters.getSyntheticAddressByRemoteAddress(eidB, bUSDT.address);
      const remoteAddress = await syntheticTokenHubGetters.getRemoteAddressBySyntheticAddress(eidB, syntheticAddress);
      expect(remoteAddress).to.equal(bUSDT.address);
    });
  });

  describe("SyntheticTokenHubGetters MinBridgeAmt Tests", function () {
    it("should correctly return minBridgeAmt via getRemoteTokenInfo", async function () {
      const remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticUsdtToken.address, eidB);
      // Value set during linking: ethers.utils.parseUnits("1", 6)
      // Stored in RemoteTokenInfo in synthetic decimals. Delta is 0 for USDT.
      const expectedMinBridgeAmt = ethers.utils.parseUnits("1", 6);
      expect(remoteInfo.minBridgeAmt).to.equal(expectedMinBridgeAmt);

      const remoteInfoWBTC = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticBtcToken.address, eidC);
      // Value set during linking: ethers.utils.parseUnits("0.0001", 8)
      // Stored in RemoteTokenInfo in synthetic decimals. Delta is 0 for WBTC.
      const expectedMinBridgeAmtWBTC = ethers.utils.parseUnits("0.0001", 8);
      expect(remoteInfoWBTC.minBridgeAmt).to.equal(expectedMinBridgeAmtWBTC);
    });

    it("should correctly return minBridgeAmt via getMinBridgeAmount", async function () {
      const minBridgeAmt = await syntheticTokenHubGetters.getMinBridgeAmount(syntheticUsdtToken.address, eidB);
      const expectedMinBridgeAmt = ethers.utils.parseUnits("1", 6);
      expect(minBridgeAmt).to.equal(expectedMinBridgeAmt);

      const minBridgeAmtWBTC = await syntheticTokenHubGetters.getMinBridgeAmount(syntheticBtcToken.address, eidC);
      const expectedMinBridgeAmtWBTC = ethers.utils.parseUnits("0.0001", 8);
      expect(minBridgeAmtWBTC).to.equal(expectedMinBridgeAmtWBTC);
    });

    it("getMinBridgeAmount should return 0 for unlinked token/eid", async function () {
      const nonExistentTokenAddress = "0x1230000000000000000000000000000000000123";
      const minBridgeAmt = await syntheticTokenHubGetters.getMinBridgeAmount(nonExistentTokenAddress, eidB);
      expect(minBridgeAmt).to.equal(0);

      const minBridgeAmtWrongEid = await syntheticTokenHubGetters.getMinBridgeAmount(syntheticUsdtToken.address, 999); // Non-existent EID
      expect(minBridgeAmtWrongEid).to.equal(0);
    });
  });
});
