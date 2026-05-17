import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

// ── Message types broadcast to frontend clients ───────────────────────────────

export type WsMessageType =
  | "LOW_VAULT_BALANCE"   // → HR dashboard: treasury running low
  | "SALARY_CLAIMED";     // → Employee dashboard: claim confirmed on-chain

export interface WsMessage {
  type:    WsMessageType;
  payload: Record<string, unknown>;
}

// ── Singleton WS server ───────────────────────────────────────────────────────

let wss: WebSocketServer | null = null;

/**
 * Attach a WebSocket server to the existing Express HTTP server.
 * Must be called once after app.listen() returns the http.Server.
 */
export function createWsServer(httpServer: Server): void {
  wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket, req) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    console.log(`[ws] Client connected — ${ip} (total: ${wss!.clients.size})`);

    socket.on("close", () => {
      console.log(`[ws] Client disconnected — ${ip} (total: ${wss!.clients.size})`);
    });

    socket.on("error", (err) => {
      console.error(`[ws] Socket error from ${ip}:`, err.message);
    });
  });

  wss.on("error", (err) => {
    console.error("[ws] Server error:", err);
  });

  console.log("[ws] WebSocket server attached to HTTP server");
}

/**
 * Broadcast a typed message to all currently connected clients.
 * Safe to call before createWsServer() — logs a warning and no-ops.
 */
export function broadcast(type: WsMessageType, payload: Record<string, unknown>): void {
  if (!wss) {
    console.warn("[ws] broadcast() called before server was created — message dropped:", type);
    return;
  }

  const raw = JSON.stringify({ type, payload } satisfies WsMessage);
  let sent = 0;

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
      sent++;
    }
  }

  if (sent > 0) {
    console.log(`[ws] Broadcast "${type}" → ${sent} client(s)`);
  }
}
