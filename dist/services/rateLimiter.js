"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndIncrement = checkAndIncrement;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const MAX_CLAIMS = Number(process.env.MAX_CLAIMS_PER_HOUR ?? 10);
const WINDOW_MS = 60 * 60 * 1000; // 1 hour in ms
/**
 * Check if employee is within rate limit, then increment counter.
 * Returns true if the claim is allowed, false if rate limit exceeded.
 */
async function checkAndIncrement(employeeAddress) {
    const addr = employeeAddress.toLowerCase();
    const now = new Date();
    const rows = await db_1.db
        .select()
        .from(schema_1.rateLimits)
        .where((0, drizzle_orm_1.eq)(schema_1.rateLimits.employeeAddress, addr));
    const record = rows[0];
    if (!record) {
        // First claim ever — create record
        await db_1.db.insert(schema_1.rateLimits).values({
            employeeAddress: addr,
            claimCount: 1,
            windowStart: now,
        });
        return true;
    }
    const windowExpired = now.getTime() - record.windowStart.getTime() > WINDOW_MS;
    if (windowExpired) {
        // Reset window
        await db_1.db
            .update(schema_1.rateLimits)
            .set({ claimCount: 1, windowStart: now })
            .where((0, drizzle_orm_1.eq)(schema_1.rateLimits.employeeAddress, addr));
        return true;
    }
    if (record.claimCount >= MAX_CLAIMS) {
        return false; // Rate limit exceeded
    }
    // Increment within current window
    await db_1.db
        .update(schema_1.rateLimits)
        .set({ claimCount: record.claimCount + 1 })
        .where((0, drizzle_orm_1.eq)(schema_1.rateLimits.employeeAddress, addr));
    return true;
}
