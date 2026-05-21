"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWsServer = createWsServer;
exports.broadcast = broadcast;
const ws_1 = require("ws");
// ── Singleton WS server ───────────────────────────────────────────────────────
let wss = null;
/**
 * Attach a WebSocket server to the existing Express HTTP server.
 * Must be called once after app.listen() returns the http.Server.
 */
function createWsServer(httpServer) {
    wss = new ws_1.WebSocketServer({ server: httpServer });
    wss.on("connection", (socket, req) => {
        const ip = req.socket.remoteAddress ?? "unknown";
        console.log(`[ws] Client connected — ${ip} (total: ${wss.clients.size})`);
        socket.on("close", () => {
            console.log(`[ws] Client disconnected — ${ip} (total: ${wss.clients.size})`);
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
function broadcast(type, payload) {
    if (!wss) {
        console.warn("[ws] broadcast() called before server was created — message dropped:", type);
        return;
    }
    const raw = JSON.stringify({ type, payload });
    let sent = 0;
    for (const client of wss.clients) {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            client.send(raw);
            sent++;
        }
    }
    if (sent > 0) {
        console.log(`[ws] Broadcast "${type}" → ${sent} client(s)`);
    }
}
