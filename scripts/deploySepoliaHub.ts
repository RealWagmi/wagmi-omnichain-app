import hardhat, { ethers, artifacts } from "hardhat";
import fs from "fs";

async function main() {
    const data = fs.readFileSync('./scripts/testnetConfig.json', 'utf8');
    const params = JSON.parse(data);
    const [deployer] = await ethers.getSigners();

    const BalancerFactory = await ethers.getContractFactory("Balancer");
    const balancer = await BalancerFactory.deploy(deployer.address);

    const SyntheticTokenHubHelpersArtifact = await artifacts.readArtifact("SyntheticTokenHubHelpers");
    const SyntheticTokenHubHelpersFactory = new ethers.ContractFactory([], SyntheticTokenHubHelpersArtifact.bytecode, deployer);
    const syntheticTokenHubHelpers = await SyntheticTokenHubHelpersFactory.deploy();
    await syntheticTokenHubHelpers.deployed();

    const SyntheticTokenHubFactory = await ethers.getContractFactory("SyntheticTokenHub", {
      libraries: { SyntheticTokenHubHelpers: await syntheticTokenHubHelpers.address },
    });

    const syntheticTokenHub = await SyntheticTokenHubFactory.deploy(
      "0x6EDCE65403992e310A62460808c4b910D972f10f",
      deployer.address,
      "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      balancer.address
    );
    await syntheticTokenHub.deployed();

    console.log(`Sepolia Syntetic Hub address: ${syntheticTokenHub.address}`);

    let tx = await syntheticTokenHub.createSyntheticToken("USDT", 18);
    await tx.wait();

    tx = await syntheticTokenHub.createSyntheticToken("USDC", 18);
    await tx.wait();

    process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
