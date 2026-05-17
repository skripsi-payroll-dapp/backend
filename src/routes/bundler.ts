import { Router, Request, Response } from "express";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { checkAndIncrement } from "../services/rateLimiter";
import { db } from "../db";
import { auditLogs } from "../db/schema";
import { AuthRequest } from "../middleware/auth";

export const bundlerRouter = Router();

// Shape of a UserOperation (ERC-4337) sent by the frontend via Privy
interface UserOperation {
  sender:               string;
  nonce:                string;
  callData:             string;
  callGasLimit:         string;
  verificationGasLimit: string;
  preVerificationGas:   string;
  maxFeePerGas:         string;
  maxPriorityFeePerGas: string;
  paymasterAndData:     string;
  signature:            string;
}

/**
 * POST /bundler/relay
 *
 * Receives a signed UserOperation from the frontend (Privy ERC-4337 Smart Account),
 * applies rate limiting, then forwards to Pimlico bundler.
 *
 * Body: { userOp: UserOperation, entryPoint: string }
 */
bundlerRouter.post("/relay", async (req: Request, res: Response) => {
  const { userOp, entryPoint } = req.body as {
    userOp:     UserOperation;
    entryPoint: string;
  };

  if (!userOp?.sender) {
    return res.status(400).json({ error: "Missing userOp.sender" });
  }

  const employee = userOp.sender.toLowerCase();

  // Verify caller owns the Smart Account — prevents relaying ops for other users
  const callerAddress = (req as AuthRequest).auth.address;
  if (callerAddress !== employee) {
    return res.status(403).json({ error: "Forbidden: JWT address does not match userOp.sender" });
  }

  // ── Rate limit check (FR-B02: max 10 claims/hour per employee) ──────────────
  const allowed = await checkAndIncrement(employee);
  if (!allowed) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      message: "Max 10 EWA claims per hour. Try again later.",
    });
  }

  // ── Forward to Pimlico bundler ────────────────────────────────────────────
  const bundlerUrl = process.env.BUNDLER_RPC_URL;
  if (!bundlerUrl) {
    return res.status(500).json({ error: "Bundler RPC not configured" });
  }

  try {
    const response = await fetch(bundlerUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id:      1,
        method:  "eth_sendUserOperation",
        params:  [userOp, entryPoint],
      }),
    });

    const result = (await response.json()) as { result?: string; error?: unknown };

    if (result.error) {
      console.error("[bundler] Pimlico error:", result.error);
      return res.status(502).json({ error: "Bundler rejected UserOperation", detail: result.error });
    }

    const userOpHash = result.result!;

    // Audit log
    await db.insert(auditLogs).values({
      action: "BUNDLER_RELAY",
      actor:  employee,
      txHash: userOpHash,
      meta:   JSON.stringify({ entryPoint }),
    });

    return res.json({ userOpHash });
  } catch (err) {
    console.error("[bundler] Relay error:", err);
    return res.status(502).json({ error: "Failed to reach bundler" });
  }
});

/**
 * GET /bundler/status/:userOpHash
 *
 * Polls Pimlico for UserOperation receipt.
 */
bundlerRouter.get("/status/:userOpHash", async (req: Request, res: Response) => {
  const { userOpHash } = req.params;
  const bundlerUrl = process.env.BUNDLER_RPC_URL!;

  try {
    const response = await fetch(bundlerUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id:      1,
        method:  "eth_getUserOperationReceipt",
        params:  [userOpHash],
      }),
    });

    const data = (await response.json()) as { result: unknown };
    return res.json({ receipt: data.result });
  } catch (err) {
    return res.status(502).json({ error: "Failed to fetch receipt" });
  }
});
