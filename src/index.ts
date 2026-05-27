import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { authRouter }            from "./routes/auth";
import { bundlerRouter }         from "./routes/bundler";
import { complianceRouter }      from "./routes/compliance";
import { webhookRouter }         from "./routes/webhook";
import registrationRouter        from "./routes/registration";
import { requireAuth }           from "./middleware/auth";
import { startLiquidationCron }  from "./services/liquidation";
import { startPaymasterMonitor } from "./services/paymasterMonitor";
import { createWsServer }        from "./services/wsServer";
import swaggerUi                 from "swagger-ui-express";
import { swaggerSpecs }          from "./swagger";

import { globalErrorHandler }     from "./middleware/errorHandler";

const app  = express();
const PORT = Number(process.env.PORT ?? 3001);

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
// Raw body needed for webhook signature verification
app.use("/webhook", express.raw({ type: "application/json" }), (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.body = JSON.parse(req.body.toString());
  }
  next();
});
app.use(express.json());

// ── Swagger ────────────────────────────────────────────────────────────────────
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/auth",         authRouter);                    // public — issues JWT
app.use("/bundler",      requireAuth, bundlerRouter);    // NFR-2: JWT required
app.use("/compliance",   requireAuth, complianceRouter); // NFR-2: JWT required
app.use("/webhook",      webhookRouter);                 // Alchemy HMAC — no JWT needed
app.use("/registration", registrationRouter);            // mixed — /request is public, others require JWT

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// ── Global Error Handler ───────────────────────────────────────────────────────
app.use(globalErrorHandler);

// ── Start ──────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);

  // Attach WebSocket server to the same HTTP port (ws://host:PORT)
  createWsServer(server);

  // Background services
  startLiquidationCron();
  startPaymasterMonitor();
});

export default app;
