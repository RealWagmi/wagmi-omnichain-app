import hardhat, { ethers } from "hardhat";
import { IERC20 } from "../typechain-types";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hardhat.network.name;

  const endpointV2Deployment = await hardhat.deployments.get("EndpointV2");
  const ead = hardhat.network.config.eid;

  console.log(`[${network}] deployer address: ${deployer.address}`);
  console.log(`EndpointV2: ${endpointV2Deployment.address}`);

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
