import { Router, Request, Response, NextFunction } from "express";
import { AppError } from "../middleware/errorHandler";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { checkAndIncrement } from "../services/rateLimiter";
import { db } from "../db";
import { auditLogs } from "../db/schema";
import { AuthRequest } from "../middleware/auth";

export const bundlerRouter = Router();

// Shape of an ERC-4337 UserOperation supporting both EntryPoint v0.6 (ZeroDev v2 / Biconomy v3)
// and EntryPoint v0.7 (ZeroDev v3 / Biconomy v4) specifications.
interface UserOperation {
  sender:                         string;
  nonce:                          string;
  initCode?:                      string; // v0.6
  factory?:                       string; // v0.7
  factoryData?:                   string; // v0.7
  callData:                       string;
  callGasLimit?:                  string; // v0.6
  verificationGasLimit?:          string; // v0.6
  preVerificationGas:             string;
  maxFeePerGas:                   string;
  maxPriorityFeePerGas:           string;
  paymasterAndData?:              string; // v0.6
  paymaster?:                     string; // v0.7
  paymasterVerificationGasLimit?: string; // v0.7
  paymasterPostOpGasLimit?:       string; // v0.7
  paymasterData?:                 string; // v0.7
  signature:                      string;
  accountGasLimits?:              string; // v0.7
  gasFees?:                       string; // v0.7
}

/**
 * POST /bundler/relay
 *
 * Receives a signed UserOperation from the frontend (Privy ERC-4337 Smart Account),
 * applies rate limiting, then forwards to Pimlico bundler.
 *
 * Body: { userOp: UserOperation, entryPoint: string }
 */
bundlerRouter.post("/relay", async (req: Request, res: Response, next: NextFunction) => {
  const { userOp, entryPoint } = req.body as {
    userOp:     UserOperation;
    entryPoint: string;
  };

  if (!userOp?.sender) {
    return next(new AppError("Missing userOp.sender", 400, "BAD_REQUEST"));
  }

  const employee = userOp.sender.toLowerCase();

  // Verify caller owns the Smart Account — prevents relaying ops for other users
  const callerAddress = (req as AuthRequest).auth.address;
  if (callerAddress !== employee) {
    return next(new AppError("Forbidden: JWT address does not match userOp.sender", 403, "FORBIDDEN"));
  }

  // ── Rate limit check (FR-B02: max 10 claims/hour per employee) ──────────────
  const allowed = await checkAndIncrement(employee);
  if (!allowed) {
    return next(new AppError("Rate limit exceeded", 429, "TOO_MANY_REQUESTS"));
  }

  // ── Forward to Pimlico bundler ────────────────────────────────────────────
  const bundlerUrl = process.env.BUNDLER_RPC_URL;
  if (!bundlerUrl) {
    return next(new AppError("Bundler RPC not configured", 500, "INTERNAL_ERROR"));
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
      return next(new AppError("Bundler rejected UserOperation", 502, "BAD_GATEWAY"));
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
    return next(new AppError("Failed to reach bundler", 502, "BAD_GATEWAY"));
  }
});

/**
 * GET /bundler/status/:userOpHash
 *
 * Polls Pimlico for UserOperation receipt.
 */
bundlerRouter.get("/status/:userOpHash", async (req: Request, res: Response, next: NextFunction) => {
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
    return next(new AppError("Failed to fetch receipt", 502, "BAD_GATEWAY"));
  }
});
