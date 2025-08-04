import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, ContractFactory } from "ethers";
import { ethers } from "hardhat";

import { Balancer, Balancer__factory, MockERC20, MockERC20__factory } from "../typechain-types";

// Helper function for BigNumber exponentiation (base^exp)
async function bigPower(base: BigNumber, exp: BigNumber): Promise<BigNumber> {
  let res = BigNumber.from(1);
  let y = base;
  let n = exp;
  while (n.gt(0)) {
    if (n.mod(2).eq(1)) {
      res = res.mul(y);
    }
    y = y.mul(y);
    n = n.div(2);
  }
  return res;
}

// Helper function for FullMath.mulDiv style operation
function mulDiv(a: BigNumber, b: BigNumber, c: BigNumber): BigNumber {
  if (c.isZero()) {
    throw new Error("Division by zero in mulDiv");
  }
  return a.mul(b).div(c);
}

describe("Balancer Contract Tests", function () {
  let BalancerFactory: Balancer__factory;
  let MockERC20Factory: MockERC20__factory;

  let balancer: Balancer;
  let mockToken: MockERC20;

  let owner: SignerWithAddress;
  let user1: SignerWithAddress;

  const BPS = BigNumber.from("1000000"); // 1e6
  const DEFAULT_CURVE_FLATTENER = BigNumber.from(3);
  const MIN_CURVE_FLATTENER = BigNumber.from(1);
  const MAX_CURVE_FLATTENER = BigNumber.from(11);
  const CHAIN_ID_1 = 1;
  const ONE_ETHER = ethers.utils.parseEther("1"); // 10^18

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();

    BalancerFactory = await ethers.getContractFactory("Balancer");
    balancer = await BalancerFactory.deploy(owner.address);
    await balancer.deployed();

    MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20Factory.deploy(
      "Mock Token",
      "MTK",
      18 // Pass only name, symbol, and decimalsValue
    );
    await mockToken.deployed();

    const initialSupplyForTests = ethers.utils.parseUnits("2000000", 18);
    await mockToken.connect(owner).mint(owner.address, initialSupplyForTests);
  });

  describe("setTokenConfig", function () {
    it("should set token config correctly", async function () {
      await expect(balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, BPS.div(2), DEFAULT_CURVE_FLATTENER)).to.not
        .be.reverted;
    });

    it("should revert if curveFlattener is too low", async function () {
      await expect(
        balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, BPS.div(2), MIN_CURVE_FLATTENER.sub(1))
      ).to.be.revertedWith("Invalid curve flattener");
    });

    it("should revert if curveFlattener is too high", async function () {
      await expect(
        balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, BPS.div(2), MAX_CURVE_FLATTENER.add(1))
      ).to.be.revertedWith("Invalid curve flattener");
    });

    it("should revert if thresholdWeightBps is invalid", async function () {
      await expect(
        balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, BPS.add(1), DEFAULT_CURVE_FLATTENER)
      ).to.be.revertedWith("Invalid threshold weight");
    });
  });

  describe("getPenalty", function () {
    const chainLength = BigNumber.from(2);
    const defaultAmountOut = ethers.utils.parseUnits("10", 18);

    it("should return 0 penalty if chainLength is 0", async function () {
      const penalty = await balancer.getPenalty(
        mockToken.address,
        CHAIN_ID_1,
        ethers.utils.parseUnits("100", 18), // currentDstChainTokenBalance
        defaultAmountOut,
        0 // chainLength
      );
      expect(penalty).to.equal(0);
    });

    it("should return 0 penalty if withdrawal does not create/worsen deficit", async function () {
      const thresholdBps = BPS.div(chainLength); // 50%
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, thresholdBps, DEFAULT_CURVE_FLATTENER);

      const currentTotalSupply = await mockToken.totalSupply();
      const amountOut = ethers.utils.parseUnits("10000", 18);

      const newTotalSupplyAfterOut = currentTotalSupply.sub(amountOut);
      const newAverageThreshold = newTotalSupplyAfterOut.mul(thresholdBps).div(BPS);
      const currentDstChainBalance = newAverageThreshold.add(amountOut).add(ONE_ETHER);

      const penalty = await balancer.getPenalty(
        mockToken.address,
        CHAIN_ID_1,
        currentDstChainBalance,
        amountOut,
        chainLength
      );
      expect(penalty).to.equal(0);
    });

    it("should create increasing penalty when deficit is increasingly worsened", async function () {
      const thresholdBps = BPS.div(chainLength); // 50%
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, thresholdBps, DEFAULT_CURVE_FLATTENER);

      const currentTotalSupply = await mockToken.totalSupply();
      const currentAverageThreshold = currentTotalSupply.mul(thresholdBps).div(BPS);
      const baseDstChainBalance = currentAverageThreshold.sub(ethers.utils.parseUnits("100000", 18));
      const currentDstChainBalance = baseDstChainBalance.isNegative() ? BigNumber.from(0) : baseDstChainBalance;

      const amountOut1 = ethers.utils.parseUnits("1000", 18);
      const penalty1 = await balancer.getPenalty(
        mockToken.address,
        CHAIN_ID_1,
        currentDstChainBalance,
        amountOut1,
        chainLength
      );
      expect(penalty1).to.be.gt(0);

      const amountOut2 = ethers.utils.parseUnits("20000", 18);
      const penalty2 = await balancer.getPenalty(
        mockToken.address,
        CHAIN_ID_1,
        currentDstChainBalance,
        amountOut2,
        chainLength
      );
      expect(penalty2).to.be.gt(penalty1);

      const amountOut3 = ethers.utils.parseUnits("50000", 18);
      if (currentDstChainBalance.gte(amountOut3)) {
        // Ensure we don't withdraw more than available
        const penalty3 = await balancer.getPenalty(
          mockToken.address,
          CHAIN_ID_1,
          currentDstChainBalance,
          amountOut3,
          chainLength
        );
        expect(penalty3).to.be.gt(penalty2);
      }
    });

    it("should show penalty trend: extreme withdrawal from deep deficit -> penalty approaches amountOut", async function () {
      const thresholdBps = BPS.div(chainLength); // 50%
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, thresholdBps, DEFAULT_CURVE_FLATTENER);

      const currentTotalSupply = await mockToken.totalSupply();
      const currentAverageThreshold = currentTotalSupply.mul(thresholdBps).div(BPS);
      const veryLowDstChainBalance = ethers.utils.parseUnits("100", 18);
      expect(veryLowDstChainBalance).to.be.lt(currentAverageThreshold.div(100));

      const amountOutAlmostAll = veryLowDstChainBalance.sub(ethers.utils.parseUnits("1", 15));

      if (amountOutAlmostAll.gt(0)) {
        const penalty = await balancer.getPenalty(
          mockToken.address,
          CHAIN_ID_1,
          veryLowDstChainBalance,
          amountOutAlmostAll,
          chainLength
        );
        expect(penalty).to.be.gt(0);
        expect(penalty).to.be.gte(amountOutAlmostAll.mul(95).div(100));
        expect(penalty).to.be.lte(amountOutAlmostAll);
      }
    });

    it("should show penalty trend: small withdrawal creating small deficit -> small penalty", async function () {
      const thresholdBps = BPS.div(chainLength); // 50%
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, thresholdBps, DEFAULT_CURVE_FLATTENER);

      const currentTotalSupply = await mockToken.totalSupply();
      const currentAverageThreshold = currentTotalSupply.mul(thresholdBps).div(BPS);

      // Start with balance 1 ETH BELOW its average threshold
      const currentDstChainBalance = currentAverageThreshold.sub(ONE_ETHER);
      const nonNegativeDstChainBalance = currentDstChainBalance.isNegative()
        ? BigNumber.from(0)
        : currentDstChainBalance;

      // Withdraw 2 ETH, further deepening this small deficit
      const amountOutToTest = ethers.utils.parseUnits("2", 18);

      const penalty = await balancer.getPenalty(
        mockToken.address,
        CHAIN_ID_1,
        nonNegativeDstChainBalance,
        amountOutToTest,
        chainLength
      );
      expect(penalty).to.be.gt(0);
      expect(penalty).to.be.lt(amountOutToTest);
    });
  });

  describe("getBonus", function () {
    const chainLength = BigNumber.from(2);
    const defaultAmountIn = ethers.utils.parseUnits("10", 18);
    const defaultAvailableBonusPool = ethers.utils.parseUnits("50", 18);

    it("should return 0 bonus if chainLength is 0", async function () {
      const bonus = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        defaultAvailableBonusPool,
        ethers.utils.parseUnits("100", 18),
        defaultAmountIn,
        0 // chainLength
      );
      expect(bonus).to.equal(0);
    });

    it("should return 0 bonus if pool is already balanced or oversupplied on the chain", async function () {
      const thresholdBps = BPS.div(chainLength); // 50%
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, thresholdBps, DEFAULT_CURVE_FLATTENER);

      const currentTotalSupply = await mockToken.totalSupply();
      const currentAverageThreshold = currentTotalSupply.mul(thresholdBps).div(BPS);

      let currentChainBalance = currentAverageThreshold;
      let bonus = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        defaultAvailableBonusPool,
        currentChainBalance,
        defaultAmountIn,
        chainLength
      );
      expect(bonus).to.equal(0);

      currentChainBalance = currentAverageThreshold.add(ethers.utils.parseUnits("100000", 18));
      bonus = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        defaultAvailableBonusPool,
        currentChainBalance,
        defaultAmountIn,
        chainLength
      );
      expect(bonus).to.equal(0);
    });

    it("should grant full availableBonusPool if deposit fully balances or oversupplies a deficient chain pool", async function () {
      const thresholdBps = BPS.div(chainLength); // 50%
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, thresholdBps, DEFAULT_CURVE_FLATTENER);

      const currentTotalSupply = await mockToken.totalSupply();
      const currentAverageThreshold = currentTotalSupply.mul(thresholdBps).div(BPS);
      const deficitAmount = ethers.utils.parseUnits("200000", 18);
      const baseCurrentChainBalance = currentAverageThreshold.sub(deficitAmount);
      const currentChainBalance = baseCurrentChainBalance.isNegative() ? BigNumber.from(0) : baseCurrentChainBalance;

      expect(currentChainBalance).to.be.lt(currentAverageThreshold);

      const amountToExactlyBalance = deficitAmount.mul(BPS).div(BPS.sub(thresholdBps));

      const amountInToBalanceSlightlyOver = amountToExactlyBalance.add(ONE_ETHER);
      let bonusOver = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        defaultAvailableBonusPool,
        currentChainBalance,
        amountInToBalanceSlightlyOver,
        chainLength
      );
      expect(bonusOver).to.equal(defaultAvailableBonusPool);

      const amountInToOversupply = amountToExactlyBalance.add(ethers.utils.parseUnits("50000", 18));
      let bonusSignificantlyOver = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        defaultAvailableBonusPool,
        currentChainBalance,
        amountInToOversupply,
        chainLength
      );
      expect(bonusSignificantlyOver).to.equal(defaultAvailableBonusPool);
    });

    it("should show bonus trend: increasing deposit (partially improving deficit) -> increasing bonus", async function () {
      const thresholdBps = BPS.div(chainLength); // 50%
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, thresholdBps, DEFAULT_CURVE_FLATTENER);

      const currentTotalSupply = await mockToken.totalSupply();
      const currentAverageThreshold = currentTotalSupply.mul(thresholdBps).div(BPS);
      const deficit = ethers.utils.parseUnits("300000", 18);
      const baseCurrentChainBalance = currentAverageThreshold.sub(deficit);
      const currentChainBalance = baseCurrentChainBalance.isNegative() ? BigNumber.from(0) : baseCurrentChainBalance;
      expect(currentChainBalance).to.be.lt(currentAverageThreshold);

      const localAvailableBonusPool = ethers.utils.parseUnits("500", 18);

      const amountToFullyBalance = deficit.mul(BPS).div(BPS.sub(thresholdBps));

      const amountIn1 = ethers.utils.parseUnits("1000", 18);
      expect(amountIn1).to.be.lt(amountToFullyBalance);
      const bonus1 = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        localAvailableBonusPool,
        currentChainBalance,
        amountIn1,
        chainLength
      );
      expect(bonus1).to.be.gt(0);
      expect(bonus1).to.be.lte(localAvailableBonusPool);

      const amountIn2 = ethers.utils.parseUnits("2000", 18);
      expect(amountIn2).to.be.lt(amountToFullyBalance);
      const bonus2 = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        localAvailableBonusPool,
        currentChainBalance,
        amountIn2,
        chainLength
      );
      expect(bonus2).to.be.gt(bonus1);
      expect(bonus2).to.be.lte(localAvailableBonusPool);

      const amountIn3 = ethers.utils.parseUnits("3000", 18);
      expect(amountIn3).to.be.lt(amountToFullyBalance);
      const bonus3 = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        localAvailableBonusPool,
        currentChainBalance,
        amountIn3,
        chainLength
      );
      expect(bonus3).to.be.gt(bonus2);
      expect(bonus3).to.be.lte(localAvailableBonusPool);
    });

    it("should grant full availableBonusPool on full rebalance from significant deficit", async function () {
      const localChainLength = BigNumber.from(2);
      const localThresholdBps = BPS.div(localChainLength); // 50%
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, localThresholdBps, DEFAULT_CURVE_FLATTENER);

      const currentTotalSupply = await mockToken.totalSupply();
      const currentAverageThreshold = currentTotalSupply.mul(localThresholdBps).div(BPS);

      const deficitAmount = ethers.utils.parseUnits("100000", 18); // 100k ETH deficit
      let currentChainBalance = currentAverageThreshold.sub(deficitAmount);
      currentChainBalance = currentChainBalance.isNegative() ? BigNumber.from(0) : currentChainBalance;

      const amountToFullyBalance = deficitAmount.mul(BPS).div(BPS.sub(localThresholdBps));
      const actualAmountIn = amountToFullyBalance.add(ethers.utils.parseUnits("1", "gwei"));

      const bonusPoolToGrant = ethers.utils.parseUnits("77", 18);

      const actualBonus = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        bonusPoolToGrant,
        currentChainBalance,
        actualAmountIn,
        localChainLength
      );
      expect(actualBonus).to.equal(bonusPoolToGrant);
    });

    it("should return 0 for zero deposit, and a tiny bonus for tiny deposit", async function () {
      const localChainLength = BigNumber.from(2);
      const localThresholdBps = BPS.div(localChainLength);
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, localThresholdBps, DEFAULT_CURVE_FLATTENER);

      const currentTotalSupply = await mockToken.totalSupply();
      const currentAverageThreshold = currentTotalSupply.mul(localThresholdBps).div(BPS);

      let currentChainBalance = currentAverageThreshold.sub(ethers.utils.parseUnits("100", 18));
      currentChainBalance = currentChainBalance.isNegative() ? BigNumber.from(0) : currentChainBalance;

      const bonusPoolAmount = ethers.utils.parseUnits("50", 18);

      const zeroAmountIn = BigNumber.from(0);
      let bonus0 = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        bonusPoolAmount,
        currentChainBalance,
        zeroAmountIn,
        localChainLength
      );
      expect(bonus0).to.equal(0);

      const verySmallAmountIn = BigNumber.from(1);
      let bonus1 = await balancer.getBonus(
        mockToken.address,
        CHAIN_ID_1,
        bonusPoolAmount,
        currentChainBalance,
        verySmallAmountIn,
        localChainLength
      );

      // For a 1 wei deposit into a significant deficit:
      // - If it causes any fractional percentage improvement, bonus will be > 0 but very small.
      // - If it causes no deficit percentage improvement (or worsens it), bonus will be 0.
      // - It will not fully balance a large deficit to get the full bonusPoolAmount.
      if (bonus1.gt(0)) {
        expect(bonus1).to.be.lte(bonusPoolAmount.div(100));
      } else {
        expect(bonus1).to.equal(0);
      }
    });
  });

  describe("ASCII Graph Visualizations", function () {
    const chainLength = BigNumber.from(2);
    const plotHeight = 15; // Number of rows for the Y-axis
    const plotWidth = 50; // Number of columns for the X-axis
    const numDataPoints = plotWidth; // Try to plot a point for each column

    // Helper to create and print the ASCII plot
    function printAsciiPlot(
      title: string,
      points: Array<{ x: BigNumber; y: BigNumber }>,
      pointsSet2: Array<{ x: BigNumber; y: BigNumber }> | null, // Second set of points, optional
      xMin: BigNumber,
      xMax: BigNumber,
      yMin: BigNumber,
      yMax: BigNumber,
      xLabel: string,
      yLabel: string,
      plotChar1: string,
      plotChar2: string | null, // Character for the second set
      legend1?: string, // Optional legend for set 1
      legend2?: string // Optional legend for set 2
    ) {
      console.log(`\n--- ${title} ---`);
      const grid: string[][] = Array(plotHeight)
        .fill(null)
        .map(() => Array(plotWidth).fill(" "));
      const yAxisLabelWidth = 8;

      const plotPoints = (points: Array<{ x: BigNumber; y: BigNumber }>, plotChar: string) => {
        for (const point of points) {
          if (point.x.lt(xMin) || point.x.gt(xMax) || point.y.lt(yMin) || point.y.gt(yMax)) continue;
          const xRange = xMax.sub(xMin);
          const yRange = yMax.sub(yMin);
          let xCoord = 0;
          if (!xRange.isZero()) {
            xCoord = point.x
              .sub(xMin)
              .mul(plotWidth - 1)
              .div(xRange)
              .toNumber();
          }
          let yCoord = 0;
          if (!yRange.isZero()) {
            yCoord = point.y
              .sub(yMin)
              .mul(plotHeight - 1)
              .div(yRange)
              .toNumber();
          }
          const plotY = plotHeight - 1 - yCoord;
          if (plotY >= 0 && plotY < plotHeight && xCoord >= 0 && xCoord < plotWidth) {
            // If cell is not empty and new char is different, use a combined marker or prioritize
            if (grid[plotY][xCoord] !== " " && grid[plotY][xCoord] !== plotChar) {
              grid[plotY][xCoord] = "#"; // Collision marker
            } else {
              grid[plotY][xCoord] = plotChar;
            }
          }
        }
      };

      plotPoints(points, plotChar1);
      if (pointsSet2 && plotChar2) {
        plotPoints(pointsSet2, plotChar2);
      }

      console.log(" ".repeat(yAxisLabelWidth) + `^ ${yLabel}`);
      for (let r = 0; r < plotHeight; ++r) {
        let yLabelText = " ";
        let yAxisMarker = "|";

        // Determine if this row should have a major label
        // Labels at approx 0%, 25%, 50%, 75%, 100% of height (from bottom up)
        const numLabels = 5;
        let bestLabelDiff = -1;
        let labelValue: BigNumber | null = null;

        for (let labelIdx = 0; labelIdx < numLabels; labelIdx++) {
          const targetRowForLabel = Math.round((plotHeight - 1) * (labelIdx / (numLabels - 1)));
          // If current row r (inverted, 0 is top) matches targetRowForLabel (0 is bottom for calc)
          if (plotHeight - 1 - r === targetRowForLabel) {
            if (!yMax.sub(yMin).isZero() && numLabels > 1) {
              labelValue = yMin.add(
                yMax
                  .sub(yMin)
                  .mul(labelIdx)
                  .div(numLabels - 1)
              );
            } else if (labelIdx === 0) {
              labelValue = yMin;
            } else if (labelIdx === numLabels - 1) {
              labelValue = yMax;
            }
            break;
          }
        }

        if (labelValue !== null) {
          let valStr = ethers.utils.formatEther(labelValue);
          if (valStr.length > yAxisLabelWidth - 2) {
            // Truncate if too long
            valStr = valStr.substring(0, yAxisLabelWidth - 3) + "..";
          }
          yLabelText = valStr.padEnd(yAxisLabelWidth - 1);
          yAxisMarker = "+"; // Tick mark for labeled value
        } else {
          yLabelText = " ".repeat(yAxisLabelWidth - 1);
        }

        console.log(`${yLabelText}${yAxisMarker}${grid[r].join("")}`);
      }

      // Print X-axis line and label
      console.log(" ".repeat(yAxisLabelWidth) + "+" + "-".repeat(plotWidth) + `> ${xLabel}`);

      // Print X-axis min/max labels
      const xMinStr = ethers.utils.formatEther(xMin);
      const xMaxStr = ethers.utils.formatEther(xMax);
      let xMinLabel = xMinStr.length > 6 ? xMinStr.substring(0, 5) + ".." : xMinStr;
      let xMaxLabel = xMaxStr.length > 6 ? xMaxStr.substring(0, 5) + ".." : xMaxStr;

      const spaceBetweenXLabels = plotWidth - xMinLabel.length - xMaxLabel.length;
      if (spaceBetweenXLabels > 0) {
        console.log(" ".repeat(yAxisLabelWidth + 1) + `${xMinLabel}${" ".repeat(spaceBetweenXLabels)}${xMaxLabel}`);
      } else {
        console.log(" ".repeat(yAxisLabelWidth + 1) + `${xMinLabel}`);
        console.log(" ".repeat(yAxisLabelWidth + 1 + plotWidth - xMaxLabel.length) + `${xMaxLabel}`);
      }
      // Add legend if provided
      if (legend1) {
        console.log(" ".repeat(yAxisLabelWidth + 1) + `${plotChar1}: ${legend1}`);
      }
      if (pointsSet2 && plotChar2 && legend2) {
        console.log(" ".repeat(yAxisLabelWidth + 1) + `${plotChar2}: ${legend2}`);
      }
      if (grid.some((row) => row.includes("#"))) {
        console.log(" ".repeat(yAxisLabelWidth + 1) + `# : Overlapping points`);
      }
    }

    it("should print an ASCII graph of penalty vs. withdrawal amount", async function () {
      const defaultFlattener = DEFAULT_CURVE_FLATTENER;
      const increasedFlattener = DEFAULT_CURVE_FLATTENER.add(5);
      const plotCharDefault = "*";
      const plotCharIncreased = "+";

      // --- Data for DEFAULT_CURVE_FLATTENER ---
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, BPS.div(chainLength), defaultFlattener);
      const contractTotalSupply = await mockToken.totalSupply();
      const currentAvgThreshold = contractTotalSupply.mul(BPS.div(chainLength)).div(BPS);
      const fixedInitialBalance = currentAvgThreshold.sub(ethers.utils.parseUnits("200000", 18));
      const nonNegativeFixedInitialBalance = fixedInitialBalance.isNegative() ? BigNumber.from(0) : fixedInitialBalance;

      const pointsDefault: Array<{ x: BigNumber; y: BigNumber }> = [];
      const xMin = ethers.utils.parseUnits("1000", 18);
      const xMax = nonNegativeFixedInitialBalance.mul(95).div(100);

      if (xMin.gte(xMax)) {
        console.log("Skipping penalty graph: xMin >= xMax due to low initial balance.");
        return;
      }

      let yMaxForDefaultFlattener = xMax.div(3); // Initial yMax guess based on default curve, maybe 1/3 of max withdrawal
      if (yMaxForDefaultFlattener.isZero()) yMaxForDefaultFlattener = ethers.utils.parseUnits("1", 18);

      const stepSize = xMax.sub(xMin).div(numDataPoints > 1 ? numDataPoints - 1 : 1);
      if (stepSize.isZero() && numDataPoints > 1) {
        console.log("Skipping penalty graph: stepSize is zero.");
        return;
      }

      console.log(
        `\n--- Initial state for Penalty Graph: Fixed Chain Balance = ${ethers.utils.formatEther(
          nonNegativeFixedInitialBalance
        )} ETH ---`
      );

      for (let i = 0; i < numDataPoints; i++) {
        const amountToWithdraw = xMin.add(stepSize.mul(i));
        if (amountToWithdraw.gt(nonNegativeFixedInitialBalance) || (amountToWithdraw.isZero() && i > 0)) continue;
        const penalty = await balancer.getPenalty(
          mockToken.address,
          CHAIN_ID_1,
          nonNegativeFixedInitialBalance,
          amountToWithdraw,
          chainLength
        );
        pointsDefault.push({ x: amountToWithdraw, y: penalty });
        if (penalty.gt(yMaxForDefaultFlattener)) yMaxForDefaultFlattener = penalty;
      }

      // --- Data for DEFAULT_CURVE_FLATTENER + 5 ---
      await balancer.setTokenConfig(mockToken.address, CHAIN_ID_1, BPS.div(chainLength), increasedFlattener);
      const pointsIncreased: Array<{ x: BigNumber; y: BigNumber }> = [];
      // Using the same xMin, xMax, stepSize for comparison
      for (let i = 0; i < numDataPoints; i++) {
        const amountToWithdraw = xMin.add(stepSize.mul(i));
        if (amountToWithdraw.gt(nonNegativeFixedInitialBalance) || (amountToWithdraw.isZero() && i > 0)) continue;
        const penalty = await balancer.getPenalty(
          mockToken.address,
          CHAIN_ID_1,
          nonNegativeFixedInitialBalance,
          amountToWithdraw,
          chainLength
        );
        pointsIncreased.push({ x: amountToWithdraw, y: penalty });
        // We will use yMaxForDefaultFlattener for scaling, so no need to update it here further,
        // unless we want a combined yMax, which we decided against for now to favor default curve viz.
      }

      // If yMaxForDefaultFlattener remained very small, set a sensible minimum for plotting.
      if (yMaxForDefaultFlattener.lt(ethers.utils.parseUnits("1", 17))) {
        yMaxForDefaultFlattener = xMax.div(2).gt(ethers.utils.parseUnits("1", 17))
          ? xMax.div(2)
          : ethers.utils.parseUnits("1", 18);
      }

      printAsciiPlot(
        "Penalty vs. Withdrawal Amount",
        pointsDefault,
        pointsIncreased,
        xMin,
        xMax,
        BigNumber.from(0),
        yMaxForDefaultFlattener, // Use yMax from default flattener
        "Withdrawal Amount (ETH)",
        "Penalty (ETH)",
        plotCharDefault,
        plotCharIncreased,
        `Flattener=${defaultFlattener.toString()}`,
        `Flattener=${increasedFlattener.toString()}`
      );
    });

    it("should print an ASCII graph of bonus vs. deposit amount", async function () {
      await balancer.setTokenConfig(
        mockToken.address,
        CHAIN_ID_1,
        BPS.div(chainLength),
        BigNumber.from(DEFAULT_CURVE_FLATTENER) // Use a low flattener (e.g., 1) for more sensitive bonus
      );
      const contractTotalSupply = await mockToken.totalSupply();
      const currentAvgThreshold = contractTotalSupply.mul(BPS.div(chainLength)).div(BPS);
      const fixedInitialBalance = currentAvgThreshold.sub(ethers.utils.parseUnits("500000", 18));
      const nonNegativeFixedInitialBalance = fixedInitialBalance.isNegative() ? BigNumber.from(0) : fixedInitialBalance;

      const points: Array<{ x: BigNumber; y: BigNumber }> = [];
      const xMin = ethers.utils.parseUnits("1000", 18); // Min deposit amount
      const xMax = ethers.utils.parseUnits("1000000", 18); // Max deposit amount up to 1M ETH

      // Set a reasonable availableBonusPool for visualization and contract call
      const availableBonusPool = ethers.utils.parseUnits("50000", 18); // Visual yMax and contract cap
      if (availableBonusPool.isZero()) {
        console.log("Skipping bonus graph: availableBonusPool (yMax) is zero.");
        return;
      }

      const yMin = BigNumber.from(0);
      const yMax = availableBonusPool;

      const stepSize = xMax.sub(xMin).div(numDataPoints > 1 ? numDataPoints - 1 : 1);
      if (stepSize.isZero() && numDataPoints > 1) {
        console.log("Skipping bonus graph: stepSize is zero.");
        return;
      }
      console.log(
        `\n--- Initial state for Bonus Graph: Fixed Chain Balance = ${ethers.utils.formatEther(
          nonNegativeFixedInitialBalance
        )} ETH, Visual Max Bonus = ${ethers.utils.formatEther(yMax)} ETH, Flattener = 1 ---`
      );

      for (let i = 0; i < numDataPoints; i++) {
        const amountToDeposit = xMin.add(stepSize.mul(i));
        if (amountToDeposit.isZero() && i > 0) continue;

        // Pass the large availableBonusPool for visualization to the contract call
        const bonus = await balancer.getBonus(
          mockToken.address,
          CHAIN_ID_1,
          availableBonusPool,
          nonNegativeFixedInitialBalance,
          amountToDeposit,
          chainLength
        );
        points.push({ x: amountToDeposit, y: bonus });
      }
      printAsciiPlot(
        "Bonus vs. Deposit Amount",
        points,
        null,
        xMin,
        xMax,
        yMin,
        yMax,
        "Deposit Amount (ETH)",
        "Bonus (ETH)",
        "*",
        null,
        "Bonus"
      );
    });
  });
});
