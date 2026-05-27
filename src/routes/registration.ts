import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { pendingRegistrations } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";

const router = Router();

// POST /registration/request — employee submits their info (no auth needed)
router.post("/request", async (req: Request, res: Response, next: NextFunction) => {
  const { address, email, name } = req.body as { address?: string; email?: string; name?: string };
  if (!address || typeof address !== "string") {
    return res.status(400).json({ error: "address required" });
  }
  try {
    await db
      .insert(pendingRegistrations)
      .values({
        address: address.toLowerCase(),
        email: email ?? null,
        name: name ?? null,
      })
      .onConflictDoUpdate({
        target: pendingRegistrations.address,
        set: {
          email: email ?? null,
          name: name ?? null,
          updatedAt: new Date(),
        },
      });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[registration] insert error:", err);
    return res.status(500).json({ error: "db error" });
  }
});

// GET /registration/status/:address — employee checks their own status (no auth)
router.get("/status/:address", async (req: Request, res: Response, next: NextFunction) => {
  const address = (req.params.address as string).toLowerCase();
  try {
    const [row] = await db
      .select()
      .from(pendingRegistrations)
      .where(eq(pendingRegistrations.address, address));

    if (!row) return res.json({ status: "none" });
    return res.json({ status: row.status, requestedAt: row.requestedAt });
  } catch (err) {
    console.error("[registration] status error:", err);
    return res.status(500).json({ error: "db error" });
  }
});

// GET /registration/pending — owner sees full pending list (requires owner JWT)
router.get("/pending", requireAuth, requireOwner, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select()
      .from(pendingRegistrations)
      .orderBy(pendingRegistrations.requestedAt);
    return res.json(rows);
  } catch (err) {
    console.error("[registration] select error:", err);
    return res.status(500).json({ error: "db error" });
  }
});

// PATCH /registration/:address/approve — owner approves a registration (requires owner JWT)
router.patch("/:address/approve", requireAuth, requireOwner, async (req: Request, res: Response, next: NextFunction) => {
  const address = (req.params.address as string).toLowerCase();
  try {
    await db
      .update(pendingRegistrations)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(pendingRegistrations.address, address));
    return res.json({ ok: true });
  } catch (err) {
    console.error("[registration] approve error:", err);
    return res.status(500).json({ error: "db error" });
  }
});

// DELETE /registration/:address — owner rejects a registration (requires owner JWT)
router.delete("/:address", requireAuth, requireOwner, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db
      .update(pendingRegistrations)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(pendingRegistrations.address, (req.params.address as string).toLowerCase()));
    return res.json({ ok: true });
  } catch (err) {
    console.error("[registration] update error:", err);
    return res.status(500).json({ error: "db error" });
  }
});

export default router;
