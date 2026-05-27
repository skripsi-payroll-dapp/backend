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

// ── Employee Profiles (Encrypted PII for UU PDP compliance) ───────────────────
export const employees = appSchema.table("employees", {
  address:   text("address").primaryKey(),      // employee wallet address (lowercase)
  name:      text("name").notNull(),            // AES-256-GCM encrypted name
  nik:       text("nik").notNull(),             // AES-256-GCM encrypted NIK (16-digit ID)
  phone:     text("phone").notNull(),           // AES-256-GCM encrypted phone number
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Active Sessions (JWT blocklist/revocation mapping) ────────────────────────
export const sessions = appSchema.table("sessions", {
  jti:       text("jti").primaryKey(),          // JWT Unique ID
  address:   text("address").notNull(),          // wallet address (lowercase)
  expiresAt: timestamp("expires_at").notNull(), // token expiration timestamp
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Pending Registrations ─────────────────────────────────────────────────────
// Tracks unregistered employees who have requested SaaS owner approval
export const pendingRegistrations = appSchema.table("pending_registrations", {
  address:     text("address").primaryKey(),               // employee wallet address (lowercase)
  email:       text("email"),                              // optional contact email
  name:        text("name"),                               // display name from onboarding form
  hrAddress:   text("hr_address"),                         // HR who will handle the request
  status:      text("status").notNull().default("pending"), // "pending" | "approved" | "rejected"
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at",   { withTimezone: true }).notNull().defaultNow(),
});
