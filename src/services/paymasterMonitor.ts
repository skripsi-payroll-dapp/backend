import cron from "node-cron";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { baseSepolia } from "viem/chains";
import { db } from "../db";
import { auditLogs } from "../db/schema";

// FR-B02: alert ops when Paymaster ETH balance drops below this threshold
const ALERT_THRESHOLD = parseEther(
  process.env.PAYMASTER_ALERT_THRESHOLD_ETH ?? "0.05"
);

const publicClient = createPublicClient({
  chain:     baseSepolia,
  transport: http(process.env.BASE_RPC_URL ?? process.env.BUNDLER_RPC_URL),
});

async function checkPaymasterBalance(): Promise<void> {
  const paymasterAddress = process.env.PAYMASTER_ADDRESS as `0x${string}` | undefined;
  if (!paymasterAddress || paymasterAddress === "0x0000000000000000000000000000000000000000") {
    console.warn("[paymasterMonitor] PAYMASTER_ADDRESS not set — skipping check");
    return;
  }

  let balance: bigint;
  try {
    balance = await publicClient.getBalance({ address: paymasterAddress });
  } catch (err) {
    console.error("[paymasterMonitor] Failed to fetch balance:", err);
    return;
  }

  const ethStr = formatEther(balance);
  console.log(`[paymasterMonitor] Paymaster balance: ${ethStr} ETH`);

  if (balance >= ALERT_THRESHOLD) return;

  // ── Below threshold: log + push alert ────────────────────────────────────────
  console.warn(
    `[paymasterMonitor] LOW BALANCE — ${ethStr} ETH < ${formatEther(ALERT_THRESHOLD)} ETH threshold`
  );

  await db.insert(auditLogs).values({
    action: "PAYMASTER_LOW_BALANCE",
    actor:  paymasterAddress,
    meta:   JSON.stringify({
      balanceWei:       balance.toString(),
      thresholdWei:     ALERT_THRESHOLD.toString(),
      balanceEth:       ethStr,
      thresholdEth:     formatEther(ALERT_THRESHOLD),
    }),
  });

  await pushOpsAlert(paymasterAddress, ethStr);
}

async function pushOpsAlert(address: string, balanceEth: string): Promise<void> {
  const webhookUrl = process.env.OPS_ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[paymasterMonitor] OPS_ALERT_WEBHOOK_URL not set — alert logged only");
    return;
  }

  try {
    await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🚨 *Paymaster Low Balance Alert*\n` +
              `Address: \`${address}\`\n` +
              `Balance: *${balanceEth} ETH* (threshold: ${formatEther(ALERT_THRESHOLD)} ETH)\n` +
              `Action: Top up Paymaster to avoid failed gasless transactions.`,
      }),
    });
    console.log("[paymasterMonitor] Alert pushed to ops webhook");
  } catch (err) {
    console.error("[paymasterMonitor] Failed to push ops alert:", err);
  }
}

/**
 * Starts the Paymaster balance monitor.
 * Runs every 15 minutes — frequent enough to catch a drain before it causes
 * user-facing failures (gasless claims bounce if Paymaster hits 0).
 */
export function startPaymasterMonitor(): void {
  // Run once immediately on startup so ops know the current state at boot
  checkPaymasterBalance();

  cron.schedule("*/15 * * * *", () => {
    console.log("[paymasterMonitor] Running balance check...");
    checkPaymasterBalance();
  });

  console.log("[paymasterMonitor] Monitor started — checks every 15 minutes");
}
