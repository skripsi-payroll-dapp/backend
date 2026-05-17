import { pgSchema, text, integer, bigint, timestamp, boolean } from "drizzle-orm/pg-core";

// Off-chain tables live in "app" schema — separate from Ponder's "public" schema
export const appSchema = pgSchema("app");

// ── Rate Limiter ──────────────────────────────────────────────────────────────
// Tracks EWA claim count per employee per rolling hour window (FR-B02)
export const rateLimits = appSchema.table("rate_limits", {
  employeeAddress: text("employee_address").primaryKey(),
  claimCount:      integer("claim_count").notNull().default(0),
  windowStart:     timestamp("window_start").notNull().defaultNow(),
});

// ── Audit Logs ────────────────────────────────────────────────────────────────
// Immutable off-chain audit trail for all backend actions
export const auditLogs = appSchema.table("audit_logs", {
  id:          bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  action:      text("action").notNull(),       // "BUNDLER_RELAY" | "COMPLIANCE_EXPORT" | "LOAN_LIQUIDATED"
  actor:       text("actor").notNull(),        // employee or HR address
  txHash:      text("tx_hash"),                // null if action not yet on-chain
  meta:        text("meta"),                   // JSON string for extra context
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

// ── Webhook Events ────────────────────────────────────────────────────────────
// Deduplication store for Alchemy webhook pushes
export const webhookEvents = appSchema.table("webhook_events", {
  id:          text("id").primaryKey(),        // Alchemy webhook event ID
  type:        text("type").notNull(),
  processed:   boolean("processed").notNull().default(false),
  receivedAt:  timestamp("received_at").notNull().defaultNow(),
});
