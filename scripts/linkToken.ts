import hardhat, { ethers, artifacts } from "hardhat";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import { GatewayVault } from "../typechain-types";
import fs from "fs";

const LZ_GAS_LIMIT = 500000;

async function main() {
    const data = fs.readFileSync('./scripts/testnetConfig.json', 'utf8');
    const params = JSON.parse(data);
    const [deployer] = await ethers.getSigners();

    const vault = await ethers.getContractAt("GatewayVault", params.chapel.vault);

    const tokenSetupConfigs: GatewayVault.TokenSetupConfigStruct[] = [
        {
        onPause: false,
        tokenAddress: params.chapel.usdt,
        syntheticTokenDecimals: 18,
        syntheticTokenAddress: params.sepolia.usdt,
        minBridgeAmt: 0,
        },
    ];
    

    const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex();
    const fee = await vault.quoteLinkTokenToHub(tokenSetupConfigs, options);

    const tx = await vault.linkTokenToHub(tokenSetupConfigs, options, { value: fee });
    await tx.wait();

    process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
