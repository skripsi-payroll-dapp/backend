import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { verifyMessage } from "viem";
import crypto from "crypto";
import { db } from "../db";
import { sessions, employees } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { encrypt, decrypt } from "../services/encryption";

export const authRouter = Router();

// NFR-2: access token 15 min, refresh token 7 days
const ACCESS_TTL_SECONDS  = 15 * 60;           // 15 minutes
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;  // 7 days

function issueTokens(address: string, jti: string): { accessToken: string; refreshToken: string } {
  const secret        = process.env.JWT_SECRET!;
  const refreshSecret = process.env.JWT_REFRESH_SECRET!;

  const accessToken = jwt.sign(
    { address, jti },
    secret,
    { expiresIn: ACCESS_TTL_SECONDS }
  );

  const refreshToken = jwt.sign(
    { address, jti },
    refreshSecret,
    { expiresIn: REFRESH_TTL_SECONDS }
  );

  return { accessToken, refreshToken };
}

/**
 * POST /auth/login
 *
 * Verifies an EIP-191 personal_sign signature.
 * Saves the session ID (jti) and expiry to database for stateless revocation.
 */
authRouter.post("/login", async (req: Request, res: Response) => {
  const { address, message, signature } = req.body as {
    address:   string;
    message:   string;
    signature: string;
  };

  if (!address || !message || !signature) {
    return res.status(400).json({ error: "address, message, and signature are required" });
  }

  // Replay protection — message must embed a timestamp within ±5 minutes
  const tsMatch = message.match(/Timestamp:\s*(\d+)/);
  if (!tsMatch) {
    return res.status(400).json({ error: "Message must include 'Timestamp: <unix_seconds>'" });
  }

  const msgTs   = Number(tsMatch[1]);
  const nowTs   = Math.floor(Date.now() / 1000);
  const skewSec = 5 * 60; // 5 minutes tolerance

  if (Math.abs(nowTs - msgTs) > skewSec) {
    return res.status(401).json({ error: "Login message has expired. Request a new challenge." });
  }

  // EIP-191 signature verification via viem
  let valid = false;
  try {
    valid = await verifyMessage({
      address:   address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return res.status(400).json({ error: "Malformed signature" });
  }

  if (!valid) {
    return res.status(401).json({ error: "Signature verification failed" });
  }

  const normalized = address.toLowerCase();
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  try {
    // Record the active session in database
    await db.insert(sessions).values({
      jti,
      address: normalized,
      expiresAt,
    });
  } catch (err) {
    console.error("[auth] Failed to save session:", err);
    return res.status(500).json({ error: "Session creation failed" });
  }

  const tokens = issueTokens(normalized, jti);

  return res.json({ ...tokens, address: normalized });
});

/**
 * POST /auth/refresh
 *
 * Exchanges a valid refresh token for a new access token.
 * Validates the session jti in the database to support revocation.
 */
authRouter.post("/refresh", async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken: string };

  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  const secret        = process.env.JWT_SECRET!;
  const refreshSecret = process.env.JWT_REFRESH_SECRET!;

  if (!secret || !refreshSecret) {
    return res.status(500).json({ error: "Server misconfiguration: JWT secrets not set" });
  }

  try {
    const payload = jwt.verify(refreshToken, refreshSecret) as { address: string; jti: string };
    const normalized = payload.address.toLowerCase();

    // Check if the session is still active/valid in the database
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.jti, payload.jti));

    if (!session || new Date() > new Date(session.expiresAt)) {
      return res.status(401).json({ error: "Session has been revoked or expired" });
    }

    const accessToken = jwt.sign(
      { address: normalized, jti: payload.jti },
      secret,
      { expiresIn: ACCESS_TTL_SECONDS }
    );

    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

/**
 * POST /auth/logout
 *
 * Revokes the current session by deleting its jti from the sessions database.
 */
authRouter.post("/logout", requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const jti = authReq.auth.jti;

  try {
    await db.delete(sessions).where(eq(sessions.jti, jti));
    return res.json({ message: "Successfully logged out and session revoked" });
  } catch (err) {
    console.error("[auth] Logout error:", err);
    return res.status(500).json({ error: "Logout failed" });
  }
});

/**
 * POST /auth/profile
 *
 * Registers or updates an employee's Personally Identifiable Information (PII).
 * Encrypts Name, NIK, and Phone using AES-256-GCM before writing to database.
 */
authRouter.post("/profile", requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const callerAddress = authReq.auth.address;
  const { name, nik, phone } = req.body as { name?: string; nik?: string; phone?: string };

  if (!name || !nik || !phone) {
    return res.status(400).json({ error: "name, nik, and phone are required" });
  }

  // Indonesian KTP NIK must be exactly 16 numeric digits
  if (!/^\d{16}$/.test(nik)) {
    return res.status(400).json({ error: "NIK must be exactly 16 digits" });
  }

  try {
    const encryptedName = encrypt(name);
    const encryptedNik  = encrypt(nik);
    const encryptedPhone = encrypt(phone);

    await db
      .insert(employees)
      .values({
        address: callerAddress,
        name: encryptedName,
        nik: encryptedNik,
        phone: encryptedPhone,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: employees.address,
        set: {
          name: encryptedName,
          nik: encryptedNik,
          phone: encryptedPhone,
          updatedAt: new Date(),
        },
      });

    return res.json({ success: true, message: "Employee profile encrypted and saved successfully" });
  } catch (err) {
    console.error("[auth] Profile save error:", err);
    return res.status(500).json({ error: "Failed to save profile" });
  }
});

/**
 * GET /auth/profile
 *
 * Fetches the caller's employee profile and decrypts the PII.
 */
authRouter.get("/profile", requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const callerAddress = authReq.auth.address;

  try {
    const [emp] = await db
      .select()
      .from(employees)
      .where(eq(employees.address, callerAddress));

    if (!emp) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const decryptedName = decrypt(emp.name);
    const decryptedNik  = decrypt(emp.nik);
    const decryptedPhone = decrypt(emp.phone);

    return res.json({
      address: emp.address,
      name: decryptedName,
      nik: decryptedNik,
      phone: decryptedPhone,
      createdAt: emp.createdAt,
      updatedAt: emp.updatedAt,
    });
  } catch (err) {
    console.error("[auth] Profile fetch error:", err);
    return res.status(500).json({ error: "Failed to retrieve profile" });
  }
});
