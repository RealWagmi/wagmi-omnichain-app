import { BigNumber, BigNumberish } from "ethers";
import { CommandType } from "./planner";
import { IERC20Metadata, SwapQuoterV3 } from "../../typechain-types";
import { RoutePlanner } from "./planner";
import { FeeAmount } from "@uniswap/v3-sdk";

// v3
export function encodePath(path: string[], fees: number[], isInput: boolean): string {
  if (path.length != fees.length + 1) {
    throw new Error("path/fee lengths do not match");
  }
  if (!isInput) {
    path = path.slice().reverse();
    fees = fees.slice().reverse();
  }
  let encoded = "0x";
  for (let i = 0; i < fees.length; i++) {
    encoded += path[i].slice(2);
    encoded += fees[i].toString(16).padStart(6, "0");
  }
  encoded += path[path.length - 1].slice(2);
  return encoded.toLowerCase();
}

export async function priceToTick(
  priceAInUsd: number,
  priceBInUsd: number,
  tokenA: IERC20Metadata,
  tokenB: IERC20Metadata
): Promise<number> {
  const zeroForA = tokenA.address < tokenB.address;

  const price = zeroForA ? priceAInUsd / priceBInUsd : priceBInUsd / priceAInUsd;
  const adjustedPrice =
    price *
    Math.pow(
      10,
      zeroForA
        ? (await tokenB.decimals()) - (await tokenA.decimals())
        : (await tokenA.decimals()) - (await tokenB.decimals())
    );
  const tick = Math.log(adjustedPrice) / Math.log(1.0001);

  return Math.floor(tick);
}

const SOURCE_MSG_SENDER = true;

export const addV3ExactInTrades = (
  planner: RoutePlanner,
  amountIn: BigNumberish,
  amountOutMin: BigNumberish,
  recipient: string,
  tokens: string[][]
) => {
  for (const element of tokens) {
    const path = encodePath(element, [FeeAmount.LOW, FeeAmount.LOW], true);
    planner.addCommand(CommandType.V3_SWAP_EXACT_IN, [recipient, amountIn, amountOutMin, path, SOURCE_MSG_SENDER]);
  }
};

export async function getMultiHopQuote(
  isInput: boolean,
  swapQuoterV3: SwapQuoterV3,
  tokens: string[],
  amount: BigNumber,
  fees: number[]
): Promise<BigNumber> {
  const path = encodePath(tokens, fees, isInput);
  if (isInput) {
    return await swapQuoterV3.quoteExactInput(path, amount); // Input is tokenIn
  } else {
    return await swapQuoterV3.quoteExactOutput(path, amount); // Output is tokenIn
  }
}
