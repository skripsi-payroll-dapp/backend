"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startLiquidationCron = startLiquidationCron;
const node_cron_1 = __importDefault(require("node-cron"));
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const chains_1 = require("viem/chains");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
// Minimal ABI — only what we need for liquidation
const LIQUIDITY_ABI = (0, viem_1.parseAbi)([
    "function liquidateLoan(address borrower) external",
    "event LoanDefaulted(address indexed borrower, uint256 outstanding)",
]);
// Ponder exposes a GraphQL/REST API — we query it to find overdue loans
const PONDER_API_URL = process.env.PONDER_API_URL ?? "http://localhost:42069";
async function fetchOverdueLoans() {
    const now = Math.floor(Date.now() / 1000);
    const gracePeriod = 7 * 24 * 3600; // 7 days in seconds
    // Query Ponder's SQL endpoint for active loans past grace period
    const res = await fetch(`${PONDER_API_URL}/sql/select?` +
        `query=SELECT id FROM loan_record WHERE status='Active' AND due_ts < ${now - gracePeriod}`);
    if (!res.ok) {
        console.error("[liquidation] Failed to fetch overdue loans:", res.statusText);
        return [];
    }
    const data = (await res.json());
    return data.rows.map((r) => r.id);
}
async function liquidate(borrower) {
    const privateKey = process.env.OPS_PRIVATE_KEY;
    if (!privateKey) {
        console.warn("[liquidation] OPS_PRIVATE_KEY not set — skipping");
        return;
    }
    const account = (0, accounts_1.privateKeyToAccount)(privateKey);
    const walletClient = (0, viem_1.createWalletClient)({
        account,
        chain: chains_1.baseSepolia,
        transport: (0, viem_1.http)(process.env.BUNDLER_RPC_URL),
    });
    const publicClient = (0, viem_1.createPublicClient)({
        chain: chains_1.baseSepolia,
        transport: (0, viem_1.http)(process.env.BUNDLER_RPC_URL),
    });
    const contractAddress = process.env.LIQUIDITY_CONTRACT_ADDRESS;
    try {
        const hash = await walletClient.writeContract({
            address: contractAddress,
            abi: LIQUIDITY_ABI,
            functionName: "liquidateLoan",
            args: [borrower],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        await db_1.db.insert(schema_1.auditLogs).values({
            action: "LOAN_LIQUIDATED",
            actor: borrower,
            txHash: hash,
            meta: JSON.stringify({ triggeredBy: "cron" }),
        });
        console.log(`[liquidation] Liquidated loan for ${borrower} — tx: ${hash}`);
    }
    catch (err) {
        console.error(`[liquidation] Failed to liquidate ${borrower}:`, err);
    }
}
/**
 * Runs every 6 hours — checks for loans past grace period and liquidates them.
 * Triggered by backend ops wallet (OPS_ROLE in EmployeeLiquidityContract).
 */
function startLiquidationCron() {
    node_cron_1.default.schedule("0 */6 * * *", async () => {
        console.log("[liquidation] Running overdue loan check...");
        const overdue = await fetchOverdueLoans();
        console.log(`[liquidation] Found ${overdue.length} overdue loan(s)`);
        for (const borrower of overdue) {
            await liquidate(borrower);
        }
    });
    console.log("[liquidation] Cron started — runs every 6 hours");
}
