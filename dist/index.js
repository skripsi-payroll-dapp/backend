"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const auth_1 = require("./routes/auth");
const bundler_1 = require("./routes/bundler");
const compliance_1 = require("./routes/compliance");
const webhook_1 = require("./routes/webhook");
const auth_2 = require("./middleware/auth");
const liquidation_1 = require("./services/liquidation");
const paymasterMonitor_1 = require("./services/paymasterMonitor");
const wsServer_1 = require("./services/wsServer");
const errorHandler_1 = require("./middleware/errorHandler");
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT ?? 3001);
// ── Middleware ─────────────────────────────────────────────────────────────────
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
// Raw body needed for webhook signature verification
app.use("/webhook", express_1.default.raw({ type: "application/json" }), (req, _res, next) => {
    if (Buffer.isBuffer(req.body)) {
        req.body = JSON.parse(req.body.toString());
    }
    next();
});
app.use(express_1.default.json());
// ── Routes ─────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/auth", auth_1.authRouter); // public — issues JWT
app.use("/bundler", auth_2.requireAuth, bundler_1.bundlerRouter); // NFR-2: JWT required
app.use("/compliance", auth_2.requireAuth, compliance_1.complianceRouter); // NFR-2: JWT required
app.use("/webhook", webhook_1.webhookRouter); // Alchemy HMAC — no JWT needed
// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
// ── Global Error Handler ───────────────────────────────────────────────────────
app.use(errorHandler_1.globalErrorHandler);
// ── Start ──────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
    // Attach WebSocket server to the same HTTP port (ws://host:PORT)
    (0, wsServer_1.createWsServer)(server);
    // Background services
    (0, liquidation_1.startLiquidationCron)();
    (0, paymasterMonitor_1.startPaymasterMonitor)();
});
exports.default = app;
