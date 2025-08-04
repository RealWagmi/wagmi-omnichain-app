import hardhat, { ethers } from "hardhat";
import { IERC20 } from "../typechain-types";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hardhat.network.name;

  const EID_SONIC = 30332;
  const EID_BASE = 30184;
  const EID_ARBITRUM = 30110;

  const syntheticTokenHubDeployment = await hardhat.deployments.get("SyntheticTokenHub");
  console.log(`SyntheticTokenHub: ${syntheticTokenHubDeployment.address}`);
  const gatewayVaultBDeployment = await hardhat.deployments.get("GatewayVaultB");
  console.log(`GatewayVaultB: ${gatewayVaultBDeployment.address}`);
  const gatewayVaultCDeployment = await hardhat.deployments.get("GatewayVaultC");
  console.log(`GatewayVaultC: ${gatewayVaultCDeployment.address}`);

  console.log(`[${network}] deployer address: ${deployer.address}`);

  if (network === "sonic") {
    const receiverContract = await ethers.getContractAt("SyntheticTokenHub", syntheticTokenHubDeployment.address);
    const senderContractBaseAddressBytes32 = ethers.utils.zeroPad(gatewayVaultBDeployment.address, 32);
    const senderContractArbitrumAddressBytes32 = ethers.utils.zeroPad(gatewayVaultCDeployment.address, 32);
    const tx = await receiverContract.setPeer(EID_BASE, senderContractBaseAddressBytes32);
    await tx.wait();
    console.log(`Set peer for BASE: ${tx.hash}`);
    sleep(10000);
    const tx2 = await receiverContract.setPeer(EID_ARBITRUM, senderContractArbitrumAddressBytes32);
    await tx2.wait();
    console.log(`Set peer for ARBITRUM: ${tx2.hash}`);
  } else {
    let senderAddress = "";
    if (network === "base") {
      senderAddress = gatewayVaultBDeployment.address;
    } else if (network === "arbitrum") {
      senderAddress = gatewayVaultCDeployment.address;
    }
    const receiverContractAddressBytes32 = ethers.utils.zeroPad(syntheticTokenHubDeployment.address, 32);
    const senderContract = await ethers.getContractAt("GatewayVaultB", senderAddress);
    const tx = await senderContract.setPeer(EID_SONIC, receiverContractAddressBytes32);
    await tx.wait();
    console.log(`Set peer for SONIC: ${tx.hash}`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
