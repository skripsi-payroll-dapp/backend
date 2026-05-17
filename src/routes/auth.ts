import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { verifyMessage } from "viem";

export const authRouter = Router();

// NFR-2: access token 15 min, refresh token 7 days
const ACCESS_TTL_SECONDS  = 15 * 60;           // 15 minutes
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;  // 7 days

function issueTokens(address: string): { accessToken: string; refreshToken: string } {
  const secret        = process.env.JWT_SECRET!;
  const refreshSecret = process.env.JWT_REFRESH_SECRET!;

  const accessToken = jwt.sign(
    { address },
    secret,
    { expiresIn: ACCESS_TTL_SECONDS }
  );

  const refreshToken = jwt.sign(
    { address },
    refreshSecret,
    { expiresIn: REFRESH_TTL_SECONDS }
  );

  return { accessToken, refreshToken };
}

/**
 * POST /auth/login
 *
 * Verifies an EIP-191 personal_sign signature.
 * Frontend (Privy Smart Account) signs a challenge message with the employee's
 * embedded wallet and submits it here to obtain a JWT pair.
 *
 * Body: { address: string, message: string, signature: string }
 *
 * The `message` must contain the current Unix timestamp so the backend can
 * reject replayed logins (timestamp must be within ±5 minutes of server time).
 *
 * Returns: { accessToken, refreshToken, address }
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
  const tokens     = issueTokens(normalized);

  return res.json({ ...tokens, address: normalized });
});

/**
 * POST /auth/refresh
 *
 * Exchanges a valid refresh token for a new access token.
 * Refresh tokens are stateless — revocation requires rotating JWT_REFRESH_SECRET.
 *
 * Body: { refreshToken: string }
 * Returns: { accessToken }
 */
authRouter.post("/refresh", (req: Request, res: Response) => {
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
    const payload    = jwt.verify(refreshToken, refreshSecret) as { address: string };
    const accessToken = jwt.sign(
      { address: payload.address.toLowerCase() },
      secret,
      { expiresIn: ACCESS_TTL_SECONDS }
    );
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});
