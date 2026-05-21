"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookRouter = void 0;
const express_1 = require("express");
const crypto_1 = require("crypto");
const drizzle_orm_1 = require("drizzle-orm");
const viem_1 = require("viem");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const wsServer_1 = require("../services/wsServer");
exports.webhookRouter = (0, express_1.Router)();
// ── Event topic hashes — computed from canonical signatures at module load ─────
// Avoids hardcoded strings drifting from the actual contract ABI.
const TOPICS = {
    LOW_VAULT_BALANCE: (0, viem_1.keccak256)((0, viem_1.toHex)("LowVaultBalance(address,uint256,uint256)")),
    // SalaryClaimed now includes toCompliance and toSeverance (Fix #3)
    SALARY_CLAIMED: (0, viem_1.keccak256)((0, viem_1.toHex)("SalaryClaimed(address,uint256,uint256,uint256,uint256,uint256)")),
};
// ── Signature verification ────────────────────────────────────────────────────
function verifyAlchemySignature(body, signature) {
    const key = process.env.ALCHEMY_WEBHOOK_KEY;
    if (!key)
        return true; // skip in development if key not set
    const hmac = (0, crypto_1.createHmac)("sha256", key).update(body, "utf8").digest("hex");
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
exports.webhookRouter.post("/alchemy", async (req, res) => {
    const signature = req.headers["x-alchemy-signature"];
    const rawBody = JSON.stringify(req.body);
    if (!verifyAlchemySignature(rawBody, signature)) {
        return res.status(401).json({ error: "Invalid signature" });
    }
    const payload = req.body;
    const eventId = payload.webhookId;
    // Deduplicate — Alchemy can deliver the same event more than once
    const existing = await db_1.db.query.webhookEvents.findFirst({
        where: (t, { eq }) => eq(t.id, eventId),
    });
    if (existing?.processed) {
        return res.json({ status: "already_processed" });
    }
    await db_1.db
        .insert(schema_1.webhookEvents)
        .values({ id: eventId, type: payload.type, processed: false })
        .onConflictDoNothing();
    const logs = payload.event?.data?.block?.logs ?? [];
    for (const log of logs) {
        await handleLog(log);
    }
    await db_1.db
        .update(schema_1.webhookEvents)
        .set({ processed: true })
        .where((0, drizzle_orm_1.eq)(schema_1.webhookEvents.id, eventId));
    return res.json({ status: "ok", logsProcessed: logs.length });
});
async function handleLog(log) {
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
async function handleLowVaultBalance(log) {
    const hrAuthority = `0x${log.topics[1]?.slice(26)}`;
    const [balance, monthlyNeed] = (0, viem_1.decodeAbiParameters)([{ type: "uint256" }, { type: "uint256" }], log.data);
    console.warn(`[webhook] LowVaultBalance — HR: ${hrAuthority} | balance: ${balance} | monthlyNeed: ${monthlyNeed}`);
    await db_1.db.insert(schema_1.auditLogs).values({
        action: "LOW_VAULT_BALANCE_ALERT",
        actor: hrAuthority,
        txHash: log.transactionHash,
        meta: JSON.stringify({ balance: balance.toString(), monthlyNeed: monthlyNeed.toString() }),
    });
    // Push real-time alert to HR dashboard
    (0, wsServer_1.broadcast)("LOW_VAULT_BALANCE", {
        hrAuthority,
        balance: balance.toString(),
        monthlyNeed: monthlyNeed.toString(),
        txHash: log.transactionHash,
    });
}
/**
 * SalaryClaimed(address indexed employee, uint256 accrued, uint256 netToEmployee,
 *               uint256 toCompliance, uint256 toSeverance, uint256 timestamp)
 * topics[1] = employee (indexed)
 * data      = abi-encoded (accrued, netToEmployee, toCompliance, toSeverance, timestamp)
 */
async function handleSalaryClaimed(log) {
    const employee = `0x${log.topics[1]?.slice(26)}`;
    const [accrued, netToEmployee, toCompliance, toSeverance, timestamp] = (0, viem_1.decodeAbiParameters)([
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
    ], log.data);
    console.log(`[webhook] SalaryClaimed — employee: ${employee} | accrued: ${accrued} | net: ${netToEmployee} | compliance: ${toCompliance} | severance: ${toSeverance}`);
    // Push real-time confirmation to employee dashboard
    (0, wsServer_1.broadcast)("SALARY_CLAIMED", {
        employee,
        accrued: accrued.toString(),
        netToEmployee: netToEmployee.toString(),
        toCompliance: toCompliance.toString(),
        toSeverance: toSeverance.toString(),
        timestamp: timestamp.toString(),
        txHash: log.transactionHash,
    });
}
