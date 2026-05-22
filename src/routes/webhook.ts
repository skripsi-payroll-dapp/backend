import { Router, Request, Response, NextFunction } from "express";
import { AppError } from "../middleware/errorHandler";
import { createHmac } from "crypto";
import { eq } from "drizzle-orm";
import { keccak256, toHex, decodeAbiParameters } from "viem";
import { db } from "../db";
import { webhookEvents, auditLogs } from "../db/schema";
import { broadcast } from "../services/wsServer";

export const webhookRouter = Router();

// ── Event topic hashes — computed from canonical signatures at module load ─────
// Avoids hardcoded strings drifting from the actual contract ABI.
const TOPICS = {
  LOW_VAULT_BALANCE: keccak256(toHex("LowVaultBalance(address,uint256,uint256)")),
  // SalaryClaimed now includes toCompliance and toSeverance (Fix #3)
  SALARY_CLAIMED:    keccak256(toHex("SalaryClaimed(address,uint256,uint256,uint256,uint256,uint256)")),
} as const;

// ── Signature verification ────────────────────────────────────────────────────

function verifyAlchemySignature(body: string, signature: string): boolean {
  const key = process.env.ALCHEMY_WEBHOOK_KEY;
  if (!key) return true; // skip in development if key not set

  const hmac = createHmac("sha256", key).update(body, "utf8").digest("hex");
  return hmac === signature;
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * POST /webhook/alchemy
 *
 * Receives on-chain event pushes from Alchemy.
 * Decodes LowVaultBalance and SalaryClaimed events, persists an audit log,
 * and broadcasts a WebSocket message to all connected frontend clients.
 */
webhookRouter.post("/alchemy", async (req: Request, res: Response, next: NextFunction) => {
  const signature = req.headers["x-alchemy-signature"] as string;
  const rawBody   = JSON.stringify(req.body);

  if (!verifyAlchemySignature(rawBody, signature)) {
    return next(new AppError("Invalid signature", 401, "UNAUTHORIZED"));
  }

  const payload = req.body as {
    webhookId: string;
    type:      string;
    event:     {
      data: {
        block: {
          logs: Array<{
            topics:          string[];
            data:            string;
            address:         string;
            transactionHash: string;
          }>;
        };
      };
    };
  };

  const eventId = payload.webhookId;

  // Deduplicate — Alchemy can deliver the same event more than once
  const existing = await db.query.webhookEvents.findFirst({
    where: (t, { eq }) => eq(t.id, eventId),
  });

  if (existing?.processed) {
    return res.json({ status: "already_processed" });
  }

  await db
    .insert(webhookEvents)
    .values({ id: eventId, type: payload.type, processed: false })
    .onConflictDoNothing();

  const logs = payload.event?.data?.block?.logs ?? [];
  for (const log of logs) {
    await handleLog(log);
  }

  await db
    .update(webhookEvents)
    .set({ processed: true })
    .where(eq(webhookEvents.id, eventId));

  return res.json({ status: "ok", logsProcessed: logs.length });
});

// ── Log handler ───────────────────────────────────────────────────────────────

type RawLog = {
  topics:          string[];
  data:            string;
  address:         string;
  transactionHash: string;
};

async function handleLog(log: RawLog): Promise<void> {
  const topic0 = log.topics[0];

  if (topic0 === TOPICS.LOW_VAULT_BALANCE) {
    await handleLowVaultBalance(log);
    return;
  }

  if (topic0 === TOPICS.SALARY_CLAIMED) {
    await handleSalaryClaimed(log);
    return;
  }
}

/**
 * LowVaultBalance(address indexed hrAuthority, uint256 balance, uint256 monthlyNeed)
 * topics[1] = hrAuthority (indexed)
 * data      = abi-encoded (balance, monthlyNeed)
 */
async function handleLowVaultBalance(log: RawLog): Promise<void> {
  const hrAuthority = `0x${log.topics[1]?.slice(26)}`;

  const [balance, monthlyNeed] = decodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    log.data as `0x${string}`
  );

  console.warn(
    `[webhook] LowVaultBalance — HR: ${hrAuthority} | balance: ${balance} | monthlyNeed: ${monthlyNeed}`
  );

  await db.insert(auditLogs).values({
    action: "LOW_VAULT_BALANCE_ALERT",
    actor:  hrAuthority,
    txHash: log.transactionHash,
    meta:   JSON.stringify({ balance: balance.toString(), monthlyNeed: monthlyNeed.toString() }),
  });

  // Push real-time alert to HR dashboard
  broadcast("LOW_VAULT_BALANCE", {
    hrAuthority,
    balance:     balance.toString(),
    monthlyNeed: monthlyNeed.toString(),
    txHash:      log.transactionHash,
  });
}

/**
 * SalaryClaimed(address indexed employee, uint256 accrued, uint256 netToEmployee,
 *               uint256 toCompliance, uint256 toSeverance, uint256 timestamp)
 * topics[1] = employee (indexed)
 * data      = abi-encoded (accrued, netToEmployee, toCompliance, toSeverance, timestamp)
 */
async function handleSalaryClaimed(log: RawLog): Promise<void> {
  const employee = `0x${log.topics[1]?.slice(26)}`;

  const [accrued, netToEmployee, toCompliance, toSeverance, timestamp] = decodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    log.data as `0x${string}`
  );

  console.log(
    `[webhook] SalaryClaimed — employee: ${employee} | accrued: ${accrued} | net: ${netToEmployee} | compliance: ${toCompliance} | severance: ${toSeverance}`
  );

  // Push real-time confirmation to employee dashboard
  broadcast("SALARY_CLAIMED", {
    employee,
    accrued:       accrued.toString(),
    netToEmployee: netToEmployee.toString(),
    toCompliance:  toCompliance.toString(),
    toSeverance:   toSeverance.toString(),
    timestamp:     timestamp.toString(),
    txHash:        log.transactionHash,
  });
}
