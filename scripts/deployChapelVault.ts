import hardhat, { ethers, artifacts } from "hardhat";
import fs from "fs";

async function main() {
    const data = fs.readFileSync('./scripts/testnetConfig.json', 'utf8');
    const params = JSON.parse(data);
    const [deployer] = await ethers.getSigners();

    const GatewayVaultFactory = await ethers.getContractFactory("GatewayVault");
    const vault = await GatewayVaultFactory.deploy(
        "0x6EDCE65403992e310A62460808c4b910D972f10f",
        deployer.address,
        40161
    );
    await vault.deployed();

    console.log(`Chapel Vault address: ${vault.address}`);

    let tx = await vault.setPeer(40161, "0x000000000000000000000000" + params.sepolia.hub.slice(2));
    await tx.wait();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    const usdt = await MockERC20.deploy("Tether", "USDT", 18);
    await usdt.deployed();

    const usdc = await MockERC20.deploy("USD Coin", "USDC", 18);
    await usdc.deployed();

    console.log(`USDT address: ${usdt.address}`);
    console.log(`USDC address: ${usdc.address}`);

    process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});