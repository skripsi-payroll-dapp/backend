import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Extend Express Request so downstream routes can read the verified address
export interface AuthRequest extends Request {
  auth: { address: string };
}

/**
 * requireAuth — JWT Bearer token middleware (NFR-2)
 *
 * Expects:  Authorization: Bearer <accessToken>
 * Attaches: req.auth.address (normalized to lowercase)
 * Rejects:  401 if token is missing, malformed, expired, or signed with wrong secret
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token  = header.slice(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration: JWT_SECRET not set" });
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as { address: string };
    (req as AuthRequest).auth = { address: payload.address.toLowerCase() };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}
