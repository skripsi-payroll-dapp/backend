import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db";
import { sessions } from "../db/schema";
import { eq } from "drizzle-orm";
import { AppError } from "./errorHandler";

// Extend Express Request so downstream routes can read the verified address and session ID
export interface AuthRequest extends Request {
  auth: { address: string; jti: string };
}

/**
 * requireAuth — JWT Bearer token middleware with stateless database revocation (NFR-2)
 *
 * Expects:  Authorization: Bearer <accessToken>
 * Attaches: req.auth.address (normalized to lowercase), req.auth.jti
 * Rejects:  401 if token is missing, malformed, expired, revoked, or signed with wrong secret
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError("Missing or malformed Authorization header", 401, "UNAUTHORIZED"));
  }

  const token  = header.slice(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return next(new AppError("Server misconfiguration: JWT_SECRET not set", 500, "INTERNAL_ERROR"));
  }

  try {
    const payload = jwt.verify(token, secret) as { address: string; jti: string };
    const normalizedAddress = payload.address.toLowerCase();

    // Check if session exists and is active in database (revocation check)
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.jti, payload.jti));

    if (!session) {
      return next(new AppError("Session has been revoked or logged out", 401, "UNAUTHORIZED"));
    }

    // Verify session expiration
    if (new Date() > new Date(session.expiresAt)) {
      // Clean up expired session asynchronously
      db.delete(sessions).where(eq(sessions.jti, payload.jti)).catch(console.error);
      return next(new AppError("Session has expired", 401, "UNAUTHORIZED"));
    }

    (req as AuthRequest).auth = { 
      address: normalizedAddress, 
      jti: payload.jti 
    };
    next();
  } catch (err) {
    return next(new AppError("Invalid or expired access token", 401, "UNAUTHORIZED"));
  }
}
