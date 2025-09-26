import hardhat, { ethers, artifacts } from "hardhat";
import fs from "fs";

async function main() {
    const data = fs.readFileSync('./scripts/testnetConfig.json', 'utf8');
    const params = JSON.parse(data);
    const [deployer] = await ethers.getSigners();

    const hub = await ethers.getContractAt("SyntheticTokenHub", params.sepolia.hub);
    const tx = await hub.setPeer(40102, "0x000000000000000000000000" + params.chapel.vault.slice(2));
    await tx.wait();

    process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});