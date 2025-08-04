import { EndpointId } from "@layerzerolabs/lz-definitions";

import type { OAppOmniGraphHardhat, OmniPointHardhat } from "@layerzerolabs/toolbox-hardhat";

const sonicContract: OmniPointHardhat = {
  eid: EndpointId.SONIC_V2_MAINNET,
  contractName: "TestCrossChainSwapReceiver",
  address: "0x1bbcE9Fc68E47Cd3E4B6bC3BE64E271bcDb3edf1",
};

const baseContract: OmniPointHardhat = {
  eid: EndpointId.BASE_V2_MAINNET,
  contractName: "TestCrossChainSwapSender",
  address: "0x5AafA963D0D448ba3bE2c5940F1778505AcA9512",
};

const arbitrumContract: OmniPointHardhat = {
  eid: EndpointId.ARBITRUM_V2_MAINNET,
  contractName: "TestCrossChainSwapSender",
  address: "0x0b3095Cd06d649b66f38a7a17f02e8Ba000b7baF",
};

const config: OAppOmniGraphHardhat = {
  contracts: [
    {
      contract: sonicContract,
      /**
       * This config object is optional.
       * The callerBpsCap refers to the maximum fee (in basis points) that the contract can charge.
       */

      // config: {
      //     callerBpsCap: BigInt(300),
      // },
    },
    {
      contract: baseContract,
    },
    {
      contract: arbitrumContract,
    },
  ],
  connections: [
    {
      from: sonicContract,
      to: baseContract,
      config: {
        sendLibrary: "0xC39161c743D0307EB9BCc9FEF03eeb9Dc4802de7",
        receiveLibraryConfig: { receiveLibrary: "0xe1844c5D63a9543023008D332Bd3d2e6f1FE1043", gracePeriod: 0n },
        sendConfig: {
          executorConfig: { maxMessageSize: 10000, executor: "0x4208D6E27538189bB48E603D6123A94b8Abe0A0b" },
          ulnConfig: {
            confirmations: 20n,
            requiredDVNs: ["0x282b3386571f7f794450d5789911a9804fa346b4"],
            optionalDVNs: ["0x05AaEfDf9dB6E0f7d27FA3b6EE099EDB33dA029E", "0x54dd79f5ce72b51fcbbcb170dd01e32034323565"],
            optionalDVNThreshold: 1,
          },
        },
        receiveConfig: {
          ulnConfig: {
            confirmations: 20n,
            requiredDVNs: ["0x282b3386571f7f794450d5789911a9804fa346b4"],
            optionalDVNs: ["0x05AaEfDf9dB6E0f7d27FA3b6EE099EDB33dA029E", "0x54dd79f5ce72b51fcbbcb170dd01e32034323565"],
            optionalDVNThreshold: 1,
          },
        },
      },
    },
    {
      from: sonicContract,
      to: arbitrumContract,
      config: {
        sendLibrary: "0xC39161c743D0307EB9BCc9FEF03eeb9Dc4802de7",
        receiveLibraryConfig: { receiveLibrary: "0xe1844c5D63a9543023008D332Bd3d2e6f1FE1043", gracePeriod: 0n },
        sendConfig: {
          executorConfig: { maxMessageSize: 10000, executor: "0x4208D6E27538189bB48E603D6123A94b8Abe0A0b" },
          ulnConfig: {
            confirmations: 20n,
            requiredDVNs: ["0x282b3386571f7f794450d5789911a9804fa346b4"],
            optionalDVNs: ["0x05AaEfDf9dB6E0f7d27FA3b6EE099EDB33dA029E", "0x54dd79f5ce72b51fcbbcb170dd01e32034323565"],
            optionalDVNThreshold: 1,
          },
        },
        receiveConfig: {
          ulnConfig: {
            confirmations: 20n,
            requiredDVNs: ["0x282b3386571f7f794450d5789911a9804fa346b4"],
            optionalDVNs: ["0x05AaEfDf9dB6E0f7d27FA3b6EE099EDB33dA029E", "0x54dd79f5ce72b51fcbbcb170dd01e32034323565"],
            optionalDVNThreshold: 1,
          },
        },
      },
    },
    {
      from: baseContract,
      to: sonicContract,
      config: {
        sendLibrary: "0xB5320B0B3a13cC860893E2Bd79FCd7e13484Dda2",
        receiveLibraryConfig: { receiveLibrary: "0xc70AB6f32772f59fBfc23889Caf4Ba3376C84bAf", gracePeriod: 0n },
        sendConfig: {
          executorConfig: { maxMessageSize: 10000, executor: "0x2CCA08ae69E0C44b18a57Ab2A87644234dAebaE4" },
          ulnConfig: {
            confirmations: 20n,
            requiredDVNs: ["0x9e059a54699a285714207b43b055483e78faac25"],
            optionalDVNs: ["0xa7b5189bca84cd304d8553977c7c614329750d99", "0xcd37ca043f8479064e10635020c65ffc005d36f6"],
            optionalDVNThreshold: 1,
          },
        },
        receiveConfig: {
          ulnConfig: {
            confirmations: 20n,
            requiredDVNs: ["0x9e059a54699a285714207b43b055483e78faac25"],
            optionalDVNs: ["0xa7b5189bca84cd304d8553977c7c614329750d99", "0xcd37ca043f8479064e10635020c65ffc005d36f6"],
            optionalDVNThreshold: 1,
          },
        },
      },
    },
    {
      from: arbitrumContract,
      to: sonicContract,
      config: {
        sendLibrary: "0x975bcD720be66659e3EB3C0e4F1866a3020E493A",
        receiveLibraryConfig: { receiveLibrary: "0x7B9E184e07a6EE1aC23eAe0fe8D6Be2f663f05e6", gracePeriod: 0n },
        sendConfig: {
          executorConfig: { maxMessageSize: 10000, executor: "0x31CAe3B7fB82d847621859fb1585353c5720660D" },
          ulnConfig: {
            confirmations: 20n,
            requiredDVNs: ["0x2f55c492897526677c5b68fb199ea31e2c126416"],
            optionalDVNs: ["0x19670df5e16bea2ba9b9e68b48c054c5baea06b8", "0xa7b5189bca84cd304d8553977c7c614329750d99"],
            optionalDVNThreshold: 1,
          },
        },
        receiveConfig: {
          ulnConfig: {
            confirmations: 20n,
            requiredDVNs: ["0x2f55c492897526677c5b68fb199ea31e2c126416"],
            optionalDVNs: ["0x19670df5e16bea2ba9b9e68b48c054c5baea06b8", "0xa7b5189bca84cd304d8553977c7c614329750d99"],
            optionalDVNThreshold: 1,
          },
        },
      },
    },
  ],
};

export default config;
