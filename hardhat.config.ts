import "dotenv/config";
import "hardhat-deploy";
import "hardhat-contract-sizer";
import "hardhat-storage-layout";
import "@nomiclabs/hardhat-ethers";
import "@layerzerolabs/toolbox-hardhat";
import { HardhatUserConfig } from "hardhat/types";
import "@typechain/hardhat";
import "@nomicfoundation/hardhat-chai-matchers";

import { EndpointId } from "@layerzerolabs/lz-definitions";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
    only: ["GatewayVault", "SyntheticTokenHub"],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    artifacts: "./artifacts",
    cache: "./cache",
  },
  solidity: {
    compilers: [
      {
        version: "0.8.23",
        settings: {
          viaIR: true,
          evmVersion: "paris",
          optimizer: {
            enabled: true,
            runs: 999,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      chainId: 1,
      forking: {
        url: process.env.RPC_URL ?? "",
        blockNumber: 17329500,
      },
      allowBlocksWithSameTimestamp: true,
      allowUnlimitedContractSize: true,
      blockGasLimit: 40000000,
      gas: 40000000,
      gasPrice: "auto",
      loggingEnabled: false,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 5,
        accountsBalance: "1000000000000000000000000000000000",
        passphrase: "",
      },
    },
    kava: {
      eid: EndpointId.KAVA_V2_MAINNET,
      url: "https://evm.kava.io", // public infura endpoint
      chainId: 2222,
      gas: "auto",
      gasMultiplier: 1.2,
      gasPrice: "auto",
      accounts: [`${process.env.PRIVATE_KEY}`],
    },
    metis: {
      eid: EndpointId.METIS_V2_MAINNET,
      url: "https://andromeda.metis.io/?owner=1088", // public endpoint
      chainId: 1088,
      gas: "auto",
      gasMultiplier: 1.2,
      gasPrice: "auto",
      accounts: [`${process.env.PRIVATE_KEY}`],
    },
    sonic: {
      eid: EndpointId.SONIC_V2_MAINNET,
      url: "https://rpc.soniclabs.com",
      chainId: 146,
      gas: "auto",
      gasMultiplier: 1.2,
      gasPrice: "auto",
      accounts: [`${process.env.PRIVATE_KEY}`],
    },
    arbitrum: {
      eid: EndpointId.ARBITRUM_V2_MAINNET,
      url: "https://arb1.arbitrum.io/rpc",
      accounts: [`${process.env.PRIVATE_KEY}`],
      chainId: 42161,
      gas: "auto",
      gasMultiplier: 1.2,
      gasPrice: "auto",
    },
    base: {
      eid: EndpointId.BASE_V2_MAINNET,
      url: "https://mainnet.base.org",
      chainId: 8453,
      gas: "auto",
      gasMultiplier: 1.2,
      gasPrice: "auto",
      accounts: [`${process.env.PRIVATE_KEY}`],
    },
  },
  mocha: {
    timeout: 1000000,
  },
  // etherscan: {
  //   apiKey: {
  //     metis: "metis",
  //     sonic: "QMGDY6YXW3ATS7CG3SQFX3HXDNTQR276Z4",
  //   },
  //   customChains: [
  //     {
  //       network: "metis",
  //       chainId: 1088,
  //       urls: {
  //         apiURL: "https://api.routescan.io/v2/network/mainnet/evm/1088/etherscan",
  //         browserURL: "https://andromeda-explorer.metis.io",
  //       },
  //     },
  //     {
  //       network: "sonic",
  //       chainId: 146,
  //       urls: {
  //         apiURL: "https://api.sonicscan.org/api",
  //         browserURL: "https://sonicscan.org/",
  //       },
  //     },
  //   ],
  // },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v5",
  },
};

export default config;
