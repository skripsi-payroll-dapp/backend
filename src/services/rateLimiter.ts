import { eq } from "drizzle-orm";
import { db } from "../db";
import { rateLimits } from "../db/schema";

const MAX_CLAIMS = Number(process.env.MAX_CLAIMS_PER_HOUR ?? 10);
const WINDOW_MS  = 60 * 60 * 1000; // 1 hour in ms

/**
 * Check if employee is within rate limit, then increment counter.
 * Returns true if the claim is allowed, false if rate limit exceeded.
 */
export async function checkAndIncrement(employeeAddress: string): Promise<boolean> {
  const addr = employeeAddress.toLowerCase();
  const now  = new Date();

  const rows = await db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.employeeAddress, addr));

  const record = rows[0];

  if (!record) {
    // First claim ever — create record
    await db.insert(rateLimits).values({
      employeeAddress: addr,
      claimCount:      1,
      windowStart:     now,
    });
    return true;
  }

  const windowExpired = now.getTime() - record.windowStart.getTime() > WINDOW_MS;

  if (windowExpired) {
    // Reset window
    await db
      .update(rateLimits)
      .set({ claimCount: 1, windowStart: now })
      .where(eq(rateLimits.employeeAddress, addr));
    return true;
  }

  if (record.claimCount >= MAX_CLAIMS) {
    return false; // Rate limit exceeded
  }

  // Increment within current window
  await db
    .update(rateLimits)
    .set({ claimCount: record.claimCount + 1 })
    .where(eq(rateLimits.employeeAddress, addr));

  return true;
}
