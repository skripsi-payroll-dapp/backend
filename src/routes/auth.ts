import { Router, Request, Response, NextFunction } from "express";
import { AppError } from "../middleware/errorHandler";
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
authRouter.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  const { address, message, signature } = req.body as {
    address:   string;
    message:   string;
    signature: string;
  };

  if (!address || !message || !signature) {
    return next(new AppError("address, message, and signature are required", 400, "BAD_REQUEST"));
  }

  // Replay protection — message must embed a timestamp within ±5 minutes
  const tsMatch = message.match(/Timestamp:\s*(\d+)/);
  if (!tsMatch) {
    return next(new AppError("Message must include 'Timestamp: <unix_seconds>'", 400, "BAD_REQUEST"));
  }

  const msgTs   = Number(tsMatch[1]);
  const nowTs   = Math.floor(Date.now() / 1000);
  const skewSec = 5 * 60; // 5 minutes tolerance

  if (Math.abs(nowTs - msgTs) > skewSec) {
    return next(new AppError("Login message has expired. Request a new challenge.", 401, "UNAUTHORIZED"));
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
    return next(new AppError("Malformed signature", 400, "BAD_REQUEST"));
  }

  if (!valid) {
    return next(new AppError("Signature verification failed", 401, "UNAUTHORIZED"));
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
    return next(new AppError("Session creation failed", 500, "INTERNAL_ERROR"));
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
authRouter.post("/refresh", async (req: Request, res: Response, next: NextFunction) => {
  const { refreshToken } = req.body as { refreshToken: string };

  if (!refreshToken) {
    return next(new AppError("refreshToken is required", 400, "BAD_REQUEST"));
  }

  const secret        = process.env.JWT_SECRET!;
  const refreshSecret = process.env.JWT_REFRESH_SECRET!;

  if (!secret || !refreshSecret) {
    return next(new AppError("Server misconfiguration: JWT secrets not set", 500, "INTERNAL_ERROR"));
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
      return next(new AppError("Session has been revoked or expired", 401, "UNAUTHORIZED"));
    }

    const accessToken = jwt.sign(
      { address: normalized, jti: payload.jti },
      secret,
      { expiresIn: ACCESS_TTL_SECONDS }
    );

    return res.json({ accessToken });
  } catch {
    return next(new AppError("Invalid or expired refresh token", 401, "UNAUTHORIZED"));
  }
});

/**
 * POST /auth/logout
 *
 * Revokes the current session by deleting its jti from the sessions database.
 */
authRouter.post("/logout", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthRequest;
  const jti = authReq.auth.jti;

  try {
    await db.delete(sessions).where(eq(sessions.jti, jti));
    return res.json({ message: "Successfully logged out and session revoked" });
  } catch (err) {
    console.error("[auth] Logout error:", err);
    return next(new AppError("Logout failed", 500, "INTERNAL_ERROR"));
  }
});

/**
 * POST /auth/profile
 *
 * Registers or updates an employee's Personally Identifiable Information (PII).
 * Encrypts Name, NIK, and Phone using AES-256-GCM before writing to database.
 */
authRouter.post("/profile", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthRequest;
  const callerAddress = authReq.auth.address;
  const { name, nik, phone } = req.body as { name?: string; nik?: string; phone?: string };

  if (!name || !nik || !phone) {
    return next(new AppError("name, nik, and phone are required", 400, "BAD_REQUEST"));
  }

  // Indonesian KTP NIK must be exactly 16 numeric digits
  if (!/^\d{16}$/.test(nik)) {
    return next(new AppError("NIK must be exactly 16 digits", 400, "BAD_REQUEST"));
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
    return next(new AppError("Failed to save profile", 500, "INTERNAL_ERROR"));
  }
});

/**
 * GET /auth/profile
 *
 * Fetches the caller's employee profile and decrypts the PII.
 */
authRouter.get("/profile", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthRequest;
  const callerAddress = authReq.auth.address;

  try {
    const [emp] = await db
      .select()
      .from(employees)
      .where(eq(employees.address, callerAddress));

    if (!emp) {
      return next(new AppError("Profile not found", 404, "NOT_FOUND"));
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
    return next(new AppError("Failed to retrieve profile", 500, "INTERNAL_ERROR"));
  }
});
