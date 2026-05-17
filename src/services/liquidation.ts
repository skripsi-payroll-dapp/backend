import cron from "node-cron";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { db } from "../db";
import { auditLogs } from "../db/schema";

// Minimal ABI — only what we need for liquidation
const LIQUIDITY_ABI = parseAbi([
  "function liquidateLoan(address borrower) external",
  "event LoanDefaulted(address indexed borrower, uint256 outstanding)",
]);

// Ponder exposes a GraphQL/REST API — we query it to find overdue loans
const PONDER_API_URL = process.env.PONDER_API_URL ?? "http://localhost:42069";

async function fetchOverdueLoans(): Promise<string[]> {
  const now = Math.floor(Date.now() / 1000);
  const gracePeriod = 7 * 24 * 3600; // 7 days in seconds

  // Query Ponder's SQL endpoint for active loans past grace period
  const res = await fetch(
    `${PONDER_API_URL}/sql/select?` +
    `query=SELECT id FROM loan_record WHERE status='Active' AND due_ts < ${now - gracePeriod}`
  );

  if (!res.ok) {
    console.error("[liquidation] Failed to fetch overdue loans:", res.statusText);
    return [];
  }

  const data = (await res.json()) as { rows: Array<{ id: string }> };
  return data.rows.map((r) => r.id);
}

async function liquidate(borrower: string): Promise<void> {
  const privateKey = process.env.OPS_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.warn("[liquidation] OPS_PRIVATE_KEY not set — skipping");
    return;
  }

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain:     baseSepolia,
    transport: http(process.env.BUNDLER_RPC_URL),
  });
  const publicClient = createPublicClient({
    chain:     baseSepolia,
    transport: http(process.env.BUNDLER_RPC_URL),
  });

  const contractAddress = process.env.LIQUIDITY_CONTRACT_ADDRESS as `0x${string}`;

  try {
    const hash = await walletClient.writeContract({
      address:      contractAddress,
      abi:          LIQUIDITY_ABI,
      functionName: "liquidateLoan",
      args:         [borrower as `0x${string}`],
    });

    await publicClient.waitForTransactionReceipt({ hash });

    await db.insert(auditLogs).values({
      action: "LOAN_LIQUIDATED",
      actor:  borrower,
      txHash: hash,
      meta:   JSON.stringify({ triggeredBy: "cron" }),
    });

    console.log(`[liquidation] Liquidated loan for ${borrower} — tx: ${hash}`);
  } catch (err) {
    console.error(`[liquidation] Failed to liquidate ${borrower}:`, err);
  }
}

/**
 * Runs every 6 hours — checks for loans past grace period and liquidates them.
 * Triggered by backend ops wallet (OPS_ROLE in EmployeeLiquidityContract).
 */
export function startLiquidationCron(): void {
  cron.schedule("0 */6 * * *", async () => {
    console.log("[liquidation] Running overdue loan check...");
    const overdue = await fetchOverdueLoans();
    console.log(`[liquidation] Found ${overdue.length} overdue loan(s)`);
    for (const borrower of overdue) {
      await liquidate(borrower);
    }
  });

  console.log("[liquidation] Cron started — runs every 6 hours");
}
