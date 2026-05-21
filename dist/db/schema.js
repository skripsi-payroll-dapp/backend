"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessions = exports.employees = exports.webhookEvents = exports.auditLogs = exports.rateLimits = exports.appSchema = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
// Off-chain tables live in "app" schema — separate from Ponder's "public" schema
exports.appSchema = (0, pg_core_1.pgSchema)("app");
// ── Rate Limiter ──────────────────────────────────────────────────────────────
// Tracks EWA claim count per employee per rolling hour window (FR-B02)
exports.rateLimits = exports.appSchema.table("rate_limits", {
    employeeAddress: (0, pg_core_1.text)("employee_address").primaryKey(),
    claimCount: (0, pg_core_1.integer)("claim_count").notNull().default(0),
    windowStart: (0, pg_core_1.timestamp)("window_start").notNull().defaultNow(),
});
// ── Audit Logs ────────────────────────────────────────────────────────────────
// Immutable off-chain audit trail for all backend actions
exports.auditLogs = exports.appSchema.table("audit_logs", {
    id: (0, pg_core_1.bigint)("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    action: (0, pg_core_1.text)("action").notNull(), // "BUNDLER_RELAY" | "COMPLIANCE_EXPORT" | "LOAN_LIQUIDATED"
    actor: (0, pg_core_1.text)("actor").notNull(), // employee or HR address
    txHash: (0, pg_core_1.text)("tx_hash"), // null if action not yet on-chain
    meta: (0, pg_core_1.text)("meta"), // JSON string for extra context
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
// ── Webhook Events ────────────────────────────────────────────────────────────
// Deduplication store for Alchemy webhook pushes
exports.webhookEvents = exports.appSchema.table("webhook_events", {
    id: (0, pg_core_1.text)("id").primaryKey(), // Alchemy webhook event ID
    type: (0, pg_core_1.text)("type").notNull(),
    processed: (0, pg_core_1.boolean)("processed").notNull().default(false),
    receivedAt: (0, pg_core_1.timestamp)("received_at").notNull().defaultNow(),
});
// ── Employee Profiles (Encrypted PII for UU PDP compliance) ───────────────────
exports.employees = exports.appSchema.table("employees", {
    address: (0, pg_core_1.text)("address").primaryKey(), // employee wallet address (lowercase)
    name: (0, pg_core_1.text)("name").notNull(), // AES-256-GCM encrypted name
    nik: (0, pg_core_1.text)("nik").notNull(), // AES-256-GCM encrypted NIK (16-digit ID)
    phone: (0, pg_core_1.text)("phone").notNull(), // AES-256-GCM encrypted phone number
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
// ── Active Sessions (JWT blocklist/revocation mapping) ────────────────────────
exports.sessions = exports.appSchema.table("sessions", {
    jti: (0, pg_core_1.text)("jti").primaryKey(), // JWT Unique ID
    address: (0, pg_core_1.text)("address").notNull(), // wallet address (lowercase)
    expiresAt: (0, pg_core_1.timestamp)("expires_at").notNull(), // token expiration timestamp
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
