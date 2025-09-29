import hardhat, { ethers, artifacts } from "hardhat";
import fs from "fs";
import { EvmAssetStruct } from "../typechain-types/contracts/GatewayVault";
import { Options } from "@layerzerolabs/lz-v2-utilities";

async function main() {
    const data = fs.readFileSync('./scripts/testnetConfig.json', 'utf8');
    const params = JSON.parse(data);
    const [deployer] = await ethers.getSigners();

    const LZ_GAS_LIMIT = 500000;
    const value = ethers.BigNumber.from("282057782019022");

    const usdt = await ethers.getContractAt("MockERC20", params.chapel.usdt);
    const usdc = await ethers.getContractAt("MockERC20", params.chapel.usdc);
    const vault = await ethers.getContractAt("GatewayVault", params.chapel.vault);

    const amount = ethers.utils.parseEther("1");
    const options = Options.newOptions().addExecutorLzReceiveOption(LZ_GAS_LIMIT, value.toString()).toHex();
    const bytes32Address = "0x000000000000000000000000" + deployer.address.slice(2);

    let tx = await usdt.mint(deployer.address, amount);
    await tx.wait();

    tx = await usdt.approve(params.chapel.vault, amount);
    await tx.wait();

    let evmStruct: EvmAssetStruct[] = [{
        tokenAddress: params.chapel.usdt,
        tokenAmount: amount
    }]

    let fee = await vault.quoteSwap(
        {
            from: bytes32Address,
            to: bytes32Address,
            evmAddress: deployer.address,
            syntheticTokenOut: params.sepolia.usdc,
            gasLimit: 500000,
            dstEid: 40102,
            value: value,
            assets: evmStruct,
            commands: "0x08",
            inputs: ["0x00000000000000000000000091745befa63c2a74e1c8c16b38527951fe2e01fd0000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000003181483b8f3ac321ac9097bbffd5e6fc52c8bb280000000000000000000000008c530dbadc107e386d0932a706f1167dabc109db"],
            minimumAmountOut: 0
        },
        options,
        [{
            tokenAddress: params.chapel.usdt,
            tokenAmount: amount
        }]
    );

    console.log(fee);

    tx = await vault.swap(
        {
            from: bytes32Address,
            to: bytes32Address,
            evmAddress: deployer.address,
            syntheticTokenOut: params.sepolia.usdc,
            gasLimit: 500000,
            dstEid: 40102,
            value: value,
            assets: evmStruct,
            commands: "0x08",
            inputs: ["0x00000000000000000000000091745befa63c2a74e1c8c16b38527951fe2e01fd0000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000003181483b8f3ac321ac9097bbffd5e6fc52c8bb280000000000000000000000008c530dbadc107e386d0932a706f1167dabc109db"],
            minimumAmountOut: 0
        },
        options,
        [{
            tokenAddress: params.chapel.usdt,
            tokenAmount: amount
        }],
        {value: fee}
    );

    await tx.wait();
    
    process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});