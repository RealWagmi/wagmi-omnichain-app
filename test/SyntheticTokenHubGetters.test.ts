import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { deployments, ethers } from "hardhat";
import { Options } from "@layerzerolabs/lz-v2-utilities";

import {
  SyntheticTokenHub,
  SyntheticTokenHub__factory,
  SyntheticTokenHubGetters,
  SyntheticTokenHubGetters__factory,
  MockERC20__factory,
  MockERC20,
  SyntheticToken,
  GatewayVault,
  GatewayVault__factory,
  Balancer__factory,
  Balancer,
} from "../typechain-types";

const NUM_SYNTHETIC_TOKENS = 20;
const NUM_REMOTE_CHAINS = 9;

describe("SyntheticTokenHubGetters", function () {
  const eidA = 1;
  const UniversalRouter = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
  const Permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const LZ_GAS_LIMIT = 500000;

  let SyntheticTokenHubFactory: SyntheticTokenHub__factory;
  let SyntheticTokenHubGettersFactory: SyntheticTokenHubGetters__factory;
  let MockERC20Factory: MockERC20__factory;
  let GatewayVaultFactory: GatewayVault__factory;
  let BalancerFactory: Balancer__factory;
  let EndpointV2MockFactory: ContractFactory;

  let syntheticTokenHub: SyntheticTokenHub;
  let syntheticTokenHubGetters: SyntheticTokenHubGetters;
  let mockEndpointV2A: Contract;
  let balancer: Balancer;
  let gatewayVaults: { [key: number]: GatewayVault } = {};
  let mockEndpoints: { [key: number]: Contract } = {};

  let syntheticTokens: SyntheticToken[] = [];
  let mockTokens: { [key: number]: MockERC20[] } = {};
  let tokenSymbols = [
    "USDT",
    "WETH",
    "WBTC",
    "USDC",
    "DAI",
    "LINK",
    "UNI",
    "AAVE",
    "SNX",
    "MKR",
    "COMP",
    "YFI",
    "SUSHI",
    "CRV",
    "BAL",
    "REN",
    "LRC",
    "KNC",
    "BNT",
    "ANT",
  ];
  let tokenDecimals = [6, 18, 8, 6, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18];

  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let endpointOwner: SignerWithAddress;

  before(async function () {
    console.log(
      `--- Setting up test environment: ${NUM_SYNTHETIC_TOKENS} tokens, ${NUM_REMOTE_CHAINS} remote chains, please wait... ---`
    );
    this.timeout(200000);

    const signers = await ethers.getSigners();
    [deployer, user1, endpointOwner] = signers;

    SyntheticTokenHubFactory = await ethers.getContractFactory("SyntheticTokenHub");
    SyntheticTokenHubGettersFactory = await ethers.getContractFactory("SyntheticTokenHubGetters");
    MockERC20Factory = await ethers.getContractFactory("MockERC20");
    GatewayVaultFactory = await ethers.getContractFactory("GatewayVault");

    const EndpointV2MockArtifact = await deployments.getArtifact("EndpointV2Mock");
    EndpointV2MockFactory = new ContractFactory(
      EndpointV2MockArtifact.abi,
      EndpointV2MockArtifact.bytecode,
      endpointOwner
    );

    mockEndpointV2A = await EndpointV2MockFactory.deploy(eidA);
    await mockEndpointV2A.deployed();

    BalancerFactory = await ethers.getContractFactory("Balancer");
    balancer = await BalancerFactory.deploy(deployer.address);

    syntheticTokenHub = await SyntheticTokenHubFactory.deploy(
      mockEndpointV2A.address,
      deployer.address,
      UniversalRouter,
      Permit2,
      balancer.address
    );
    await syntheticTokenHub.deployed();

    syntheticTokenHubGetters = await SyntheticTokenHubGettersFactory.deploy(syntheticTokenHub.address);
    await syntheticTokenHubGetters.deployed();

    for (let i = 0; i < NUM_SYNTHETIC_TOKENS; i++) {
      const tx = await syntheticTokenHub.createSyntheticToken(tokenSymbols[i], tokenDecimals[i]);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = syntheticTokenHub.interface.parseLog(log);
          return parsed && parsed.name === "SyntheticTokenAdded";
        } catch {
          return false;
        }
      });
      const parsedEvent = event ? syntheticTokenHub.interface.parseLog(event) : null;
      const tokenAddress = parsedEvent ? parsedEvent.args.tokenAddress : ethers.constants.AddressZero;
      const syntheticToken = await ethers.getContractAt("SyntheticToken", tokenAddress);
      syntheticTokens.push(syntheticToken);
    }

    for (let i = 0; i < NUM_REMOTE_CHAINS; i++) {
      const remoteChainId = 2 + i;
      const mockEndpoint = await EndpointV2MockFactory.deploy(remoteChainId);
      await mockEndpoint.deployed();
      mockEndpoints[remoteChainId] = mockEndpoint;

      const gatewayVault = await GatewayVaultFactory.deploy(mockEndpoint.address, deployer.address, eidA);
      await gatewayVault.deployed();
      gatewayVaults[remoteChainId] = gatewayVault;

      await mockEndpointV2A.setDestLzEndpoint(gatewayVault.address, mockEndpoint.address);
      await mockEndpoint.setDestLzEndpoint(syntheticTokenHub.address, mockEndpointV2A.address);

      const synthTokenHubAddressBytes32 = ethers.utils.zeroPad(syntheticTokenHub.address, 32);
      const gatewayVaultAddressBytes32 = ethers.utils.zeroPad(gatewayVault.address, 32);
      await syntheticTokenHub.setPeer(remoteChainId, gatewayVaultAddressBytes32);
      await gatewayVault.setPeer(eidA, synthTokenHubAddressBytes32);

      mockTokens[remoteChainId] = [];
      for (let j = 0; j < NUM_SYNTHETIC_TOKENS; j++) {
        const token = await MockERC20Factory.deploy(tokenSymbols[j], tokenSymbols[j], tokenDecimals[j]);
        await token.deployed();
        mockTokens[remoteChainId].push(token);
      }
    }
  });

  describe(`Multi Token (${NUM_SYNTHETIC_TOKENS}), Multi Chain (${NUM_REMOTE_CHAINS}) Linking Test`, function () {
    beforeEach(async function () {
      this.timeout(NUM_SYNTHETIC_TOKENS * NUM_REMOTE_CHAINS * 5000 + 70000);

      const firstSyntheticToken = syntheticTokens[0];
      const firstRemoteChainId = 2;
      const remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(
        firstSyntheticToken.address,
        firstRemoteChainId
      );

      if (remoteInfo.remoteAddress === ethers.constants.AddressZero) {
        for (let i = 0; i < NUM_SYNTHETIC_TOKENS; i++) {
          const syntheticToken = syntheticTokens[i];
          for (let j = 0; j < NUM_REMOTE_CHAINS; j++) {
            const remoteChainIdToLink = 2 + j;
            const gatewayVault = gatewayVaults[remoteChainIdToLink];
            const mockToken = mockTokens[remoteChainIdToLink][i];

            const tokenSetupConfigs: GatewayVault.TokenSetupConfigStruct[] = [
              {
                onPause: false,
                tokenAddress: mockToken.address,
                syntheticTokenDecimals: await syntheticToken.decimals(),
                syntheticTokenAddress: syntheticToken.address,
                minBridgeAmt: 0,
              },
            ];

            const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex();
            const fee = await gatewayVault.quoteLinkTokenToHub(tokenSetupConfigs, options);
            const tx = await gatewayVault.linkTokenToHub(tokenSetupConfigs, options, { value: fee });
            await tx.wait();
          }
          for (let k = 0; k < 2; k++) {
            await ethers.provider.send("evm_mine", []);
          }
        }
      } else {
        console.log(`Tokens appear to be already linked. Skipping linking in beforeEach.`);
      }
    });

    it("should correctly reflect all linked chains for all tokens", async function () {
      this.timeout(NUM_SYNTHETIC_TOKENS * NUM_REMOTE_CHAINS * 2000 + 10000);

      for (let i = 0; i < NUM_SYNTHETIC_TOKENS; i++) {
        const syntheticToken = syntheticTokens[i];
        const tokenIndex = i + 1;

        const tokenInfo = await syntheticTokenHubGetters.getSyntheticTokenInfo(tokenIndex);

        expect(tokenInfo.syntheticTokenInfo.tokenAddress.toLowerCase()).to.equal(syntheticToken.address.toLowerCase());
        expect(
          tokenInfo.syntheticTokenInfo.chainList.length,
          `Chain list length mismatch for token ${tokenSymbols[i]}`
        ).to.equal(NUM_REMOTE_CHAINS);

        for (let j = 0; j < NUM_REMOTE_CHAINS; j++) {
          const linkedChainId = 2 + j;
          expect(
            tokenInfo.syntheticTokenInfo.chainList,
            `Chain list for token ${tokenSymbols[i]} should include ${linkedChainId}`
          ).to.include(linkedChainId);

          const mockToken = mockTokens[linkedChainId][i];
          const remoteTokenData = tokenInfo.remoteTokens.find((rt) => rt.eid === linkedChainId);
          expect(remoteTokenData, `Remote token data for chain ${linkedChainId} not found for token ${tokenSymbols[i]}`)
            .to.not.be.undefined;
          expect(
            remoteTokenData!.remoteTokenInfo.remoteAddress.toLowerCase(),
            `Remote address mismatch on chain ${linkedChainId} for token ${tokenSymbols[i]}`
          ).to.equal(mockToken.address.toLowerCase());
        }
      }
    });
  });

  describe("Extended Getter Tests", function () {
    it("should correctly return synthetic token count", async function () {
      this.timeout(5000);
      expect(await syntheticTokenHubGetters.getSyntheticTokenCount()).to.equal(NUM_SYNTHETIC_TOKENS);
    });

    it("should handle large token list retrieval with getSyntheticTokensInfo([])", async function () {
      this.timeout(20000);
      const allTokens = await syntheticTokenHubGetters.getSyntheticTokensInfo([]);
      expect(allTokens.length).to.equal(NUM_SYNTHETIC_TOKENS);

      for (let i = 0; i < NUM_SYNTHETIC_TOKENS; i++) {
        const token = allTokens[i];
        expect(token.syntheticTokenInfo.tokenAddress.toLowerCase()).to.equal(syntheticTokens[i].address.toLowerCase());
        expect(token.syntheticTokenInfo.chainList.length).to.equal(NUM_REMOTE_CHAINS);
        for (let j = 0; j < NUM_REMOTE_CHAINS; j++) {
          const remoteChainId = 2 + j;
          expect(token.syntheticTokenInfo.chainList).to.include(remoteChainId);
        }
      }
    });

    it("should handle partial token list retrieval with getSyntheticTokensInfo([indices])", async function () {
      this.timeout(20000);
      const indices = [1, 3, 5];
      if (NUM_SYNTHETIC_TOKENS < 5) this.skip();

      const partialTokens = await syntheticTokenHubGetters.getSyntheticTokensInfo(indices);
      expect(partialTokens.length).to.equal(indices.length);

      for (let i = 0; i < indices.length; i++) {
        const tokenIndexInAll = indices[i] - 1;
        expect(partialTokens[i].tokenIndex).to.equal(indices[i]);
        expect(partialTokens[i].syntheticTokenInfo.tokenAddress.toLowerCase()).to.equal(
          syntheticTokens[tokenIndexInAll].address.toLowerCase()
        );
        expect(partialTokens[i].syntheticTokenInfo.chainList.length).to.equal(NUM_REMOTE_CHAINS);
      }
    });

    it("should handle remote token info for all chains for all tokens", async function () {
      this.timeout(NUM_SYNTHETIC_TOKENS * NUM_REMOTE_CHAINS * 1000 + 10000);
      for (let i = 0; i < NUM_SYNTHETIC_TOKENS; i++) {
        const syntheticToken = syntheticTokens[i];
        for (let j = 0; j < NUM_REMOTE_CHAINS; j++) {
          const remoteChainId = 2 + j;
          const mockToken = mockTokens[remoteChainId][i];
          const remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticToken.address, remoteChainId);
          expect(remoteInfo.remoteAddress.toLowerCase()).to.equal(mockToken.address.toLowerCase());
        }
      }
    });

    it("should handle bidirectional address lookups for all tokens and chains", async function () {
      this.timeout(NUM_SYNTHETIC_TOKENS * NUM_REMOTE_CHAINS * 1000 + 10000);
      for (let i = 0; i < NUM_SYNTHETIC_TOKENS; i++) {
        const syntheticToken = syntheticTokens[i];
        for (let j = 0; j < NUM_REMOTE_CHAINS; j++) {
          const remoteChainId = 2 + j;
          const mockToken = mockTokens[remoteChainId][i];

          const derivedSyntheticAddress = await syntheticTokenHubGetters.getSyntheticAddressByRemoteAddress(
            remoteChainId,
            mockToken.address
          );
          expect(derivedSyntheticAddress.toLowerCase()).to.equal(syntheticToken.address.toLowerCase());

          const derivedRemoteAddress = await syntheticTokenHubGetters.getRemoteAddressBySyntheticAddress(
            remoteChainId,
            syntheticToken.address
          );
          expect(derivedRemoteAddress.toLowerCase()).to.equal(mockToken.address.toLowerCase());
        }
      }
    });

    it("should handle gateway vault lookups for all linked chains", async function () {
      this.timeout(NUM_REMOTE_CHAINS * 1000 + 5000);
      for (let i = 0; i < NUM_REMOTE_CHAINS; i++) {
        const remoteChainId = 2 + i;
        const vaultAddress = await syntheticTokenHubGetters.getGatewayVaultByEid(remoteChainId);
        expect(vaultAddress.toLowerCase()).to.equal(gatewayVaults[remoteChainId].address.toLowerCase());
      }
    });
  });

  describe("Detailed Field Validation Tests", function () {
    it("should correctly return all fields in getSyntheticTokenInfo", async function () {
      this.timeout(10000);
      // Test for a specific token, e.g., the first one
      const tokenIndex = 1;
      const syntheticToken = syntheticTokens[tokenIndex - 1];

      const tokenInfo = await syntheticTokenHubGetters.getSyntheticTokenInfo(tokenIndex);

      // Verify token index
      expect(tokenInfo.tokenIndex).to.equal(tokenIndex);

      // Verify synthetic token info fields
      expect(tokenInfo.syntheticTokenInfo.tokenAddress).to.equal(syntheticToken.address);
      expect(tokenInfo.syntheticTokenInfo.tokenSymbol).to.equal(tokenSymbols[tokenIndex - 1]);
      expect(tokenInfo.syntheticTokenInfo.tokenDecimals).to.equal(tokenDecimals[tokenIndex - 1]);

      // Verify the chain list is complete
      expect(tokenInfo.syntheticTokenInfo.chainList.length).to.equal(NUM_REMOTE_CHAINS);

      // Verify remote tokens array
      expect(tokenInfo.remoteTokens.length).to.equal(NUM_REMOTE_CHAINS);

      // Check a specific remote token entry
      const remoteChainId = 2; // First remote chain
      const remoteTokenEntry = tokenInfo.remoteTokens.find((rt) => rt.eid === remoteChainId);
      expect(remoteTokenEntry).to.not.be.undefined;
      expect(remoteTokenEntry!.remoteTokenInfo.remoteAddress).to.equal(
        mockTokens[remoteChainId][tokenIndex - 1].address
      );
    });

    it("should correctly return all fields in getRemoteTokenInfo", async function () {
      this.timeout(10000);
      // Test for a specific token and chain
      const tokenIndex = 1;
      const syntheticToken = syntheticTokens[tokenIndex - 1];
      const remoteChainId = 2;

      const remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticToken.address, remoteChainId);

      // Verify remote token address
      expect(remoteInfo.remoteAddress).to.equal(mockTokens[remoteChainId][tokenIndex - 1].address);

      // Verify decimalsDelta
      // In this test setup, all tokens have the same decimals on both sides, so decimalsDelta should be 0
      expect(remoteInfo.decimalsDelta).to.equal(0);

      // Verify totalBalance (should be 0 as we haven't deposited any tokens yet)
      expect(remoteInfo.totalBalance).to.equal(0);
    });

    it("should handle tokens with different decimals correctly (decimalsDelta)", async function () {
      this.timeout(20000);

      // Create a new synthetic token with 12 decimals
      const newTokenSymbol = "DIFF";
      const newTokenDecimals = 12;

      const tx = await syntheticTokenHub.createSyntheticToken(newTokenSymbol, newTokenDecimals);
      const receipt = await tx.wait();

      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = syntheticTokenHub.interface.parseLog(log);
          return parsed && parsed.name === "SyntheticTokenAdded";
        } catch {
          return false;
        }
      });

      const parsedEvent = event ? syntheticTokenHub.interface.parseLog(event) : null;
      const syntheticTokenAddress = parsedEvent ? parsedEvent.args.tokenAddress : ethers.constants.AddressZero;

      // Create a remote token with 6 decimals for positive decimalsDelta (12-6=6)
      const remoteChainId = 2;
      const remoteDecimals1 = 6;

      const remoteToken6Decimals = await MockERC20Factory.deploy(newTokenSymbol, newTokenSymbol, remoteDecimals1);
      await remoteToken6Decimals.deployed();

      // Create a remote token with 18 decimals for negative decimalsDelta (12-18=-6)
      const remoteChainId2 = 3;
      const remoteDecimals2 = 18;

      const remoteToken18Decimals = await MockERC20Factory.deploy(newTokenSymbol, newTokenSymbol, remoteDecimals2);
      await remoteToken18Decimals.deployed();

      const tokenSetupConfig1: GatewayVault.TokenSetupConfigStruct[] = [
        {
          onPause: false,
          tokenAddress: remoteToken6Decimals.address,
          syntheticTokenDecimals: newTokenDecimals,
          syntheticTokenAddress: syntheticTokenAddress,
          minBridgeAmt: 0,
        },
      ];

      const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex();

      // Link on first chain (positive decimalsDelta)
      const fee1 = await gatewayVaults[remoteChainId].quoteLinkTokenToHub(tokenSetupConfig1, options);

      await gatewayVaults[remoteChainId].linkTokenToHub(tokenSetupConfig1, options, { value: fee1 });

      // Link the token with 18 decimals on remote chain for negative decimalsDelta test

      const tokenSetupConfig2: GatewayVault.TokenSetupConfigStruct[] = [
        {
          onPause: false,
          tokenAddress: remoteToken18Decimals.address,
          syntheticTokenDecimals: newTokenDecimals,
          syntheticTokenAddress: syntheticTokenAddress,
          minBridgeAmt: 0,
        },
      ];

      const fee2 = await gatewayVaults[remoteChainId2].quoteLinkTokenToHub(tokenSetupConfig2, options);

      await gatewayVaults[remoteChainId2].linkTokenToHub(tokenSetupConfig2, options, { value: fee2 });

      // Mine a few blocks to ensure the message has been processed
      for (let i = 0; i < 10; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // Verify positive decimalsDelta (synthetic: 12, remote: 6) -> 12-6=6
      const remoteInfo1 = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticTokenAddress, remoteChainId);
      expect(remoteInfo1.decimalsDelta).to.equal(6);

      // Verify negative decimalsDelta (synthetic: 12, remote: 18) -> 12-18=-6
      const remoteInfo2 = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticTokenAddress, remoteChainId2);
      expect(remoteInfo2.decimalsDelta).to.equal(-6);
    });

    it("should track totalBalance correctly after deposits and withdrawals", async function () {
      this.timeout(20000);

      // Create and link a new token for this test to avoid state conflicts
      const testTokenSymbol = "TEST";
      const testTokenDecimals = 18;

      // Create synthetic token
      const tx = await syntheticTokenHub.createSyntheticToken(testTokenSymbol, testTokenDecimals);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = syntheticTokenHub.interface.parseLog(log);
          return parsed && parsed.name === "SyntheticTokenAdded";
        } catch {
          return false;
        }
      });
      const parsedEvent = event ? syntheticTokenHub.interface.parseLog(event) : null;
      const syntheticTokenAddress = parsedEvent ? parsedEvent.args.tokenAddress : ethers.constants.AddressZero;
      const syntheticToken = await ethers.getContractAt("SyntheticToken", syntheticTokenAddress);

      // Create remote token with same decimals
      const remoteChainId = 2;
      const remoteToken = await MockERC20Factory.deploy(testTokenSymbol, testTokenSymbol, testTokenDecimals);
      await remoteToken.deployed();

      // Link token
      const tokenSetupConfig: GatewayVault.TokenSetupConfigStruct[] = [
        {
          onPause: false,
          tokenAddress: remoteToken.address,
          syntheticTokenDecimals: testTokenDecimals,
          syntheticTokenAddress: syntheticTokenAddress,
          minBridgeAmt: 0,
        },
      ];

      const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex();
      const fee = await gatewayVaults[remoteChainId].quoteLinkTokenToHub(tokenSetupConfig, options);
      await gatewayVaults[remoteChainId].linkTokenToHub(tokenSetupConfig, options, { value: fee });

      // Mine a few blocks to ensure the message has been processed
      for (let i = 0; i < 10; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      // Initial balance should be 0
      let remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticTokenAddress, remoteChainId);
      expect(remoteInfo.totalBalance).to.equal(0);

      // Mint tokens to user for the test
      const depositAmount = ethers.utils.parseUnits("100", testTokenDecimals);
      await remoteToken.mint(user1.address, depositAmount);

      // Approve tokens for spending by the vault
      await remoteToken.connect(user1).approve(gatewayVaults[remoteChainId].address, depositAmount);

      // Prepare deposit options
      const depositOptions = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();

      // Get quote for deposit
      const depositFee = await gatewayVaults[remoteChainId].quoteDeposit(
        user1.address,
        [{ tokenAddress: remoteToken.address, tokenAmount: depositAmount }],
        depositOptions
      );

      // Execute deposit
      await gatewayVaults[remoteChainId]
        .connect(user1)
        .deposit(user1.address, [{ tokenAddress: remoteToken.address, tokenAmount: depositAmount }], depositOptions, {
          value: depositFee,
        });

      // Check token balances after deposit
      expect(await syntheticToken.balanceOf(user1.address)).to.equal(depositAmount);

      // Check totalBalance after deposit
      remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticTokenAddress, remoteChainId);
      expect(remoteInfo.totalBalance).to.equal(depositAmount);

      // Now test withdraw/bridge process
      // Approve synthetic tokens for burning
      await syntheticToken.connect(user1).approve(syntheticTokenHub.address, depositAmount);

      // Get quote for withdraw
      const withdrawOptions = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      const [withdrawFee, assetsRemote, penalties] = await syntheticTokenHub.quoteBridgeTokens(
        user1.address,
        [{ tokenAddress: syntheticTokenAddress, tokenAmount: depositAmount }],
        remoteChainId,
        withdrawOptions
      );

      // Execute withdrawal (bridge tokens back)
      await syntheticTokenHub
        .connect(user1)
        .bridgeTokens(
          user1.address,
          [{ tokenAddress: syntheticTokenAddress, tokenAmount: depositAmount }],
          remoteChainId,
          withdrawOptions,
          { value: withdrawFee }
        );

      // Check synthetic token balance is zero
      expect(await syntheticToken.balanceOf(user1.address)).to.equal(0);

      // Check totalBalance after withdrawal
      remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticTokenAddress, remoteChainId);
      expect(remoteInfo.totalBalance).to.equal(0);

      // Check native token was returned
      expect(await remoteToken.balanceOf(user1.address)).to.equal(depositAmount);
    });

    it("should correctly track bonusBalance after penalty-inducing withdrawal", async function () {
      this.timeout(30000); // Increased timeout for multi-step test

      // Create and link a new token for this test to avoid state conflicts
      const bonusTestTokenSymbol = "BONUS_TEST";
      const bonusTestTokenDecimals = 18;

      // Create synthetic token
      const txCreate = await syntheticTokenHub.createSyntheticToken(bonusTestTokenSymbol, bonusTestTokenDecimals);
      const receiptCreate = await txCreate.wait();
      const eventCreate = receiptCreate.logs.find((log: any) => {
        try {
          const parsed = syntheticTokenHub.interface.parseLog(log);
          return parsed && parsed.name === "SyntheticTokenAdded";
        } catch {
          return false;
        }
      });
      const parsedEventCreate = eventCreate ? syntheticTokenHub.interface.parseLog(eventCreate) : null;
      const syntheticBonusTokenAddress = parsedEventCreate
        ? parsedEventCreate.args.tokenAddress
        : ethers.constants.AddressZero;
      const syntheticBonusToken = await ethers.getContractAt("SyntheticToken", syntheticBonusTokenAddress);

      // Create remote token with same decimals
      const remoteChainIdForBonus = 2; // Use one of the existing remote chains
      const remoteBonusToken = await MockERC20Factory.deploy(
        bonusTestTokenSymbol,
        bonusTestTokenSymbol,
        bonusTestTokenDecimals
      );
      await remoteBonusToken.deployed();

      // --- Setup for multi-chain to inflate total supply ---
      const dummyRemoteChainIdForSupply = NUM_REMOTE_CHAINS + 2; // Ensure a new EID
      const mockEndpointDummy = await EndpointV2MockFactory.deploy(dummyRemoteChainIdForSupply);
      await mockEndpointDummy.deployed();
      const gatewayVaultDummy = await GatewayVaultFactory.deploy(mockEndpointDummy.address, deployer.address, eidA);
      await gatewayVaultDummy.deployed();
      gatewayVaults[dummyRemoteChainIdForSupply] = gatewayVaultDummy; // Store for potential cleanup or later use
      mockEndpoints[dummyRemoteChainIdForSupply] = mockEndpointDummy;

      await mockEndpointV2A.setDestLzEndpoint(gatewayVaultDummy.address, mockEndpointDummy.address);
      await mockEndpointDummy.setDestLzEndpoint(syntheticTokenHub.address, mockEndpointV2A.address);

      const synthTokenHubAddressBytes32 = ethers.utils.zeroPad(syntheticTokenHub.address, 32);
      const gatewayVaultDummyAddressBytes32 = ethers.utils.zeroPad(gatewayVaultDummy.address, 32);
      await syntheticTokenHub.setPeer(dummyRemoteChainIdForSupply, gatewayVaultDummyAddressBytes32);
      await gatewayVaultDummy.setPeer(eidA, synthTokenHubAddressBytes32);

      const remoteBonusTokenDummy = await MockERC20Factory.deploy(
        bonusTestTokenSymbol,
        bonusTestTokenSymbol,
        bonusTestTokenDecimals
      );
      await remoteBonusTokenDummy.deployed();

      const tokenSetupConfigDummy: GatewayVault.TokenSetupConfigStruct[] = [
        {
          onPause: false,
          tokenAddress: remoteBonusTokenDummy.address,
          syntheticTokenDecimals: bonusTestTokenDecimals,
          syntheticTokenAddress: syntheticBonusTokenAddress,
          minBridgeAmt: 0,
        },
      ];
      const linkOptionsDummy = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex();
      const linkFeeDummy = await gatewayVaultDummy.quoteLinkTokenToHub(tokenSetupConfigDummy, linkOptionsDummy);
      await gatewayVaultDummy.linkTokenToHub(tokenSetupConfigDummy, linkOptionsDummy, { value: linkFeeDummy });
      // --- End of multi-chain setup ---

      // Configure Balancer for this specific token to ensure penalty generation
      const BPS = ethers.BigNumber.from(10).pow(6); // 1e6 from Balancer contract
      // const chainLengthForBonusToken = 1; // This will now be 2 after linking to dummy chain
      await balancer.setTokenConfig(
        syntheticBonusTokenAddress,
        remoteChainIdForBonus, // We are interested in penalties on this specific chain
        BPS.div(10), // Target for this chain is 10% of total supply (BPS / num_effective_chains_for_calc)
        10 // Higher curve flattener: 10 (max is 11)
      );

      // Link token
      const tokenSetupConfigBonus: GatewayVault.TokenSetupConfigStruct[] = [
        {
          onPause: false,
          tokenAddress: remoteBonusToken.address,
          syntheticTokenDecimals: bonusTestTokenDecimals,
          syntheticTokenAddress: syntheticBonusTokenAddress,
          minBridgeAmt: 0,
        },
      ];

      const linkOptions = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex();
      const linkFee = await gatewayVaults[remoteChainIdForBonus].quoteLinkTokenToHub(
        tokenSetupConfigBonus,
        linkOptions
      );
      await gatewayVaults[remoteChainIdForBonus].linkTokenToHub(tokenSetupConfigBonus, linkOptions, { value: linkFee });

      for (let i = 0; i < 10; i++) {
        // Ensure linking messages are processed
        await ethers.provider.send("evm_mine", []);
      }

      // --- Deposit to dummy chain to inflate total supply ---
      const largeDepositToDummyChain = ethers.utils.parseUnits("1000", bonusTestTokenDecimals);
      await remoteBonusTokenDummy.mint(deployer.address, largeDepositToDummyChain); // Mint to deployer
      await remoteBonusTokenDummy.connect(deployer).approve(gatewayVaultDummy.address, largeDepositToDummyChain);
      const depositOptionsDummy = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      const depositFeeDummy = await gatewayVaultDummy.quoteDeposit(
        deployer.address, // recipient on hub chain
        [{ tokenAddress: remoteBonusTokenDummy.address, tokenAmount: largeDepositToDummyChain }],
        depositOptionsDummy
      );
      await gatewayVaultDummy.connect(deployer).deposit(
        deployer.address, // recipient on hub chain
        [{ tokenAddress: remoteBonusTokenDummy.address, tokenAmount: largeDepositToDummyChain }],
        depositOptionsDummy,
        { value: depositFeeDummy }
      );
      // Now syntheticBonusTokenAddress.totalSupply() should be ~1000

      // Initial bonus balance on test chain should be 0
      let initialBonus = await syntheticTokenHubGetters.getBonusBalance(
        syntheticBonusTokenAddress,
        remoteChainIdForBonus
      );
      expect(initialBonus).to.equal(0);

      // --- Deposit tokens first ---
      const depositAmountBonus = ethers.utils.parseUnits("200", bonusTestTokenDecimals);
      await remoteBonusToken.mint(user1.address, depositAmountBonus);
      await remoteBonusToken.connect(user1).approve(gatewayVaults[remoteChainIdForBonus].address, depositAmountBonus);

      const depositOptionsBonus = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      const depositFeeBonus = await gatewayVaults[remoteChainIdForBonus].quoteDeposit(
        user1.address,
        [{ tokenAddress: remoteBonusToken.address, tokenAmount: depositAmountBonus }],
        depositOptionsBonus
      );
      await gatewayVaults[remoteChainIdForBonus]
        .connect(user1)
        .deposit(
          user1.address,
          [{ tokenAddress: remoteBonusToken.address, tokenAmount: depositAmountBonus }],
          depositOptionsBonus,
          {
            value: depositFeeBonus,
          }
        );

      // --- Perform a withdrawal that incurs a penalty ---
      // Withdraw a portion that is likely to cause a penalty
      const withdrawAmountBonus = ethers.utils.parseUnits("150", bonusTestTokenDecimals); // Increased from 10 to 150
      await syntheticBonusToken.connect(user1).approve(syntheticTokenHub.address, withdrawAmountBonus);

      const withdrawOptionsBonus = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      const [withdrawFeeBonus, , penaltiesBonus] = await syntheticTokenHub.quoteBridgeTokens(
        user1.address,
        [{ tokenAddress: syntheticBonusTokenAddress, tokenAmount: withdrawAmountBonus }],
        remoteChainIdForBonus,
        withdrawOptionsBonus
      );

      // Expect penalty to be greater than 0 for this test to be meaningful
      // Note: The exact penalty depends on balancer logic and current state,
      // but for a significant withdrawal from a freshly topped-up pool, a penalty is expected.
      // We will check that the bonus balance equals this penalty.
      expect(penaltiesBonus[0]).to.be.gt(0);

      await syntheticTokenHub
        .connect(user1)
        .bridgeTokens(
          user1.address,
          [{ tokenAddress: syntheticBonusTokenAddress, tokenAmount: withdrawAmountBonus }],
          remoteChainIdForBonus,
          withdrawOptionsBonus,
          { value: withdrawFeeBonus }
        );

      // Check bonus balance after withdrawal
      const finalBonus = await syntheticTokenHubGetters.getBonusBalance(
        syntheticBonusTokenAddress,
        remoteChainIdForBonus
      );
      expect(finalBonus).to.equal(penaltiesBonus[0]);

      // --- Perform another deposit to see if bonus is used ---
      const secondDepositAmount = ethers.utils.parseUnits("5", bonusTestTokenDecimals); // Smaller amount
      await remoteBonusToken.mint(user1.address, secondDepositAmount);
      await remoteBonusToken.connect(user1).approve(gatewayVaults[remoteChainIdForBonus].address, secondDepositAmount);

      const initialSynthBalanceBeforeSecondDeposit = await syntheticBonusToken.balanceOf(user1.address);

      const secondDepositOptions = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex().toString();
      const secondDepositFee = await gatewayVaults[remoteChainIdForBonus].quoteDeposit(
        user1.address,
        [{ tokenAddress: remoteBonusToken.address, tokenAmount: secondDepositAmount }],
        secondDepositOptions
      );
      await gatewayVaults[remoteChainIdForBonus]
        .connect(user1)
        .deposit(
          user1.address,
          [{ tokenAddress: remoteBonusToken.address, tokenAmount: secondDepositAmount }],
          secondDepositOptions,
          {
            value: secondDepositFee,
          }
        );

      const finalSynthBalanceAfterSecondDeposit = await syntheticBonusToken.balanceOf(user1.address);
      const mintedAmount = finalSynthBalanceAfterSecondDeposit.sub(initialSynthBalanceBeforeSecondDeposit);

      // User should receive the deposit amount + the bonus that was available
      // We need to calculate the expected bonus based on the current state using Balancer's logic
      // This part is complex as it mirrors Balancer's internal logic.
      // For simplicity here, we check if more than deposited amount was received if bonus was available.
      // A more precise check would involve calling balancer.getBonus()
      if (penaltiesBonus[0].gt(0)) {
        expect(mintedAmount).to.be.gt(secondDepositAmount);
      }

      // Bonus balance should be reduced or zeroed out after being used
      const bonusAfterSecondDeposit = await syntheticTokenHubGetters.getBonusBalance(
        syntheticBonusTokenAddress,
        remoteChainIdForBonus
      );
      expect(bonusAfterSecondDeposit).to.be.lt(finalBonus); // Should be less than before if bonus was applied
    });

    it("should return correct token index via getTokenIndexByAddress", async function () {
      // Test for all synthetic tokens
      for (let i = 0; i < NUM_SYNTHETIC_TOKENS; i++) {
        const expectedIndex = i + 1; // Token indices start at 1
        const tokenAddress = syntheticTokens[i].address;
        const actualIndex = await syntheticTokenHubGetters.getTokenIndexByAddress(tokenAddress);
        expect(actualIndex).to.equal(expectedIndex);
      }

      // Test for non-existent token address (should return 0)
      const randomAddress = ethers.Wallet.createRandom().address;
      const indexForNonExistentToken = await syntheticTokenHubGetters.getTokenIndexByAddress(randomAddress);
      expect(indexForNonExistentToken).to.equal(0);
    });

    it("should handle zero address appropriately in lookups", async function () {
      // Test getSyntheticAddressByRemoteAddress with zero address
      const remoteChainId = 2;
      const syntheticAddress = await syntheticTokenHubGetters.getSyntheticAddressByRemoteAddress(
        remoteChainId,
        ethers.constants.AddressZero
      );
      expect(syntheticAddress).to.equal(ethers.constants.AddressZero);

      // Test getRemoteAddressBySyntheticAddress with zero address
      const remoteAddress = await syntheticTokenHubGetters.getRemoteAddressBySyntheticAddress(
        remoteChainId,
        ethers.constants.AddressZero
      );
      expect(remoteAddress).to.equal(ethers.constants.AddressZero);

      // Test getRemoteTokenInfo with zero address
      const remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(ethers.constants.AddressZero, remoteChainId);
      expect(remoteInfo.remoteAddress).to.equal(ethers.constants.AddressZero);
      expect(remoteInfo.decimalsDelta).to.equal(0);
      expect(remoteInfo.totalBalance).to.equal(0);
    });

    it("should handle non-existent chain IDs appropriately", async function () {
      const nonExistentChainId = 999;
      const syntheticToken = syntheticTokens[0];

      // Test getGatewayVaultByEid with non-existent chain ID
      const gatewayVault = await syntheticTokenHubGetters.getGatewayVaultByEid(nonExistentChainId);
      expect(gatewayVault).to.equal(ethers.constants.AddressZero);

      // Test getRemoteTokenInfo with non-existent chain ID
      const remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(syntheticToken.address, nonExistentChainId);
      expect(remoteInfo.remoteAddress).to.equal(ethers.constants.AddressZero);
      expect(remoteInfo.decimalsDelta).to.equal(0);
      expect(remoteInfo.totalBalance).to.equal(0);
    });

    it("should validate all fields in getSyntheticTokensInfo for multiple tokens", async function () {
      this.timeout(15000);

      // Get first 3 tokens or all if less than 3
      const numTokensToTest = Math.min(3, NUM_SYNTHETIC_TOKENS);
      const tokenIndices = Array.from({ length: numTokensToTest }, (_, i) => i + 1);

      const tokensInfo = await syntheticTokenHubGetters.getSyntheticTokensInfo(tokenIndices);
      expect(tokensInfo.length).to.equal(numTokensToTest);

      for (let i = 0; i < numTokensToTest; i++) {
        const tokenInfo = tokensInfo[i];
        const syntheticToken = syntheticTokens[i];

        // Validate token index
        expect(tokenInfo.tokenIndex).to.equal(i + 1);

        // Validate synthetic token info
        expect(tokenInfo.syntheticTokenInfo.tokenAddress).to.equal(syntheticToken.address);
        expect(tokenInfo.syntheticTokenInfo.tokenSymbol).to.equal(tokenSymbols[i]);
        expect(tokenInfo.syntheticTokenInfo.tokenDecimals).to.equal(tokenDecimals[i]);

        // Validate chain list
        expect(tokenInfo.syntheticTokenInfo.chainList.length).to.equal(NUM_REMOTE_CHAINS);
        for (let j = 0; j < NUM_REMOTE_CHAINS; j++) {
          const remoteChainId = j + 2; // Remote chains start at ID 2
          expect(tokenInfo.syntheticTokenInfo.chainList).to.include(remoteChainId);
        }

        // Validate remote tokens array
        expect(tokenInfo.remoteTokens.length).to.equal(NUM_REMOTE_CHAINS);

        // Validate specific remote token entries
        for (let j = 0; j < NUM_REMOTE_CHAINS; j++) {
          const remoteChainId = j + 2;
          const remoteTokenEntry = tokenInfo.remoteTokens.find((rt) => rt.eid === remoteChainId);
          expect(remoteTokenEntry).to.not.be.undefined;
          expect(remoteTokenEntry!.remoteTokenInfo.remoteAddress).to.equal(mockTokens[remoteChainId][i].address);
          // In our setup, decimalsDelta should be 0 since we use same decimals
          expect(remoteTokenEntry!.remoteTokenInfo.decimalsDelta).to.equal(0);
          // totalBalance should be 0 by default
          expect(remoteTokenEntry!.remoteTokenInfo.totalBalance).to.equal(0);
        }
      }
    });

    it("should return all tokens when requesting getSyntheticTokensInfo with empty array", async function () {
      // The contract is designed to return all tokens when an empty array is passed
      // Let's verify this behavior

      // Get the current token count
      const totalTokenCount = await syntheticTokenHubGetters.getSyntheticTokenCount();

      expect(totalTokenCount).to.be.eq(NUM_SYNTHETIC_TOKENS + 3); //+TEST, DIFF and BONUS_TEST tokens
      // Call with empty array
      const emptyIndicesArray: number[] = [];
      const tokensInfo = await syntheticTokenHubGetters.getSyntheticTokensInfo(emptyIndicesArray);
      //console.dir(tokensInfo, { depth: null });
      // Should return all tokens
      expect(tokensInfo.length).to.equal(totalTokenCount);

      // Verify the data is valid
      for (let i = 0; i < totalTokenCount.toNumber() - 3; i++) {
        // -TEST, DIFF and BONUS_TEST tokens
        expect(tokensInfo[i].tokenIndex).to.equal(i + 1); // Token indices are 1-based
        expect(tokensInfo[i].syntheticTokenInfo.tokenAddress).to.not.equal(ethers.constants.AddressZero);
        expect(tokensInfo[i].syntheticTokenInfo.tokenSymbol).to.not.equal("");
        expect(tokensInfo[i].remoteTokens.length).to.equal(NUM_REMOTE_CHAINS);
      }

      // Verify requesting an invalid token index will properly revert
      await expect(syntheticTokenHubGetters.getSyntheticTokensInfo([999])).to.be.revertedWith("Token not found");
    });

    it("should validate chainList in getSyntheticTokenInfo is sorted and contains no duplicates", async function () {
      // This test verifies that the chainList array is properly maintained

      // Test for a specific token (e.g., first token)
      const tokenIndex = 1;
      const tokenInfo = await syntheticTokenHubGetters.getSyntheticTokenInfo(tokenIndex);

      // Get chainList
      const chainList = tokenInfo.syntheticTokenInfo.chainList;

      // Verify it has the expected number of entries
      expect(chainList.length).to.equal(NUM_REMOTE_CHAINS);

      // Verify entries are unique
      const uniqueChains = [...new Set(chainList)];
      expect(uniqueChains.length).to.equal(chainList.length);

      // Verify all expected chain IDs are present
      for (let i = 0; i < NUM_REMOTE_CHAINS; i++) {
        const remoteChainId = i + 2; // Remote chains start at ID 2
        expect(chainList).to.include(remoteChainId);
      }

      // Verify sorting (should be in ascending order)
      const sortedChainList = [...chainList].sort((a, b) => a - b);
      // Compare each element
      for (let i = 0; i < chainList.length; i++) {
        expect(chainList[i]).to.equal(sortedChainList[i]);
      }
    });
  });

  describe("Error Cases and Edge Conditions", function () {
    it("should revert for non-existent token indices via getSyntheticTokenInfo", async function () {
      // Get the current token count so we can use a value beyond it
      const totalTokenCount = await syntheticTokenHubGetters.getSyntheticTokenCount();
      const nonExistentIndex = totalTokenCount.add(100).toNumber(); // Use an index that's way beyond current tokens

      // This should revert with the specific error message
      await expect(syntheticTokenHubGetters.getSyntheticTokenInfo(nonExistentIndex)).to.be.revertedWith(
        "Token not found"
      );
    });

    it("should return zero values for non-existent chain IDs via getRemoteTokenInfo", async function () {
      if (syntheticTokens.length === 0) this.skip();
      const nonExistentChainId = NUM_REMOTE_CHAINS + 100;
      const remoteInfo = await syntheticTokenHubGetters.getRemoteTokenInfo(
        syntheticTokens[0].address,
        nonExistentChainId
      );
      expect(remoteInfo.remoteAddress).to.equal(ethers.constants.AddressZero);
    });

    it("should return zero address for non-existent remote addresses via getSyntheticAddressByRemoteAddress", async function () {
      const remoteChainId = 2;
      const syntheticAddress = await syntheticTokenHubGetters.getSyntheticAddressByRemoteAddress(
        remoteChainId,
        ethers.constants.AddressZero
      );
      expect(syntheticAddress).to.equal(ethers.constants.AddressZero);
    });

    it("should handle token registration checks", async function () {
      for (let i = 0; i < NUM_SYNTHETIC_TOKENS; i++) {
        expect(await syntheticTokenHubGetters.isTokenRegistered(syntheticTokens[i].address)).to.be.true;
        expect(await syntheticTokenHubGetters.getSyntheticTokenIndex(syntheticTokens[i].address)).to.equal(i + 1);
      }
      const nonExistentTokenAddress = ethers.Wallet.createRandom().address;
      expect(await syntheticTokenHubGetters.isTokenRegistered(nonExistentTokenAddress)).to.be.false;
      await expect(syntheticTokenHubGetters.getSyntheticTokenIndex(nonExistentTokenAddress)).to.be.revertedWith(
        "Token not found"
      );
    });
  });
});
