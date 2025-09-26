import hardhat, { ethers, artifacts } from "hardhat";
import { Options } from "@layerzerolabs/lz-v2-utilities";
import { GatewayVault } from "../typechain-types";
import { EvmAssetStruct } from "../typechain-types/contracts/SyntheticTokenHub";
import fs from "fs";

const LZ_GAS_LIMIT = 500000;

async function main() {
    const data = fs.readFileSync('./scripts/testnetConfig.json', 'utf8');
    const params = JSON.parse(data);
    const [deployer] = await ethers.getSigners();

    const hub = await ethers.getContractAt("SyntheticTokenHub", params.sepolia.hub);

    const asset: EvmAssetStruct = {
        tokenAddress: params.sepolia.usdt,
        tokenAmount: ethers.utils.parseEther("1")
    }

    const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, 0).toHex();
    const fee = await hub.quoteBridgeTokens(
        params.solana.recipient,
        [asset],
        40168,
        options,
    );
    console.log(fee)

    const tx = await hub.bridgeTokens(
        params.solana.recipient,
        [asset],
        40168,
        options,
        {value: fee.nativeFee}
    )
    const receipt = await tx.wait();
    console.log(receipt);

    process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
