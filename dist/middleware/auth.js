"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * requireAuth — JWT Bearer token middleware with stateless database revocation (NFR-2)
 *
 * Expects:  Authorization: Bearer <accessToken>
 * Attaches: req.auth.address (normalized to lowercase), req.auth.jti
 * Rejects:  401 if token is missing, malformed, expired, revoked, or signed with wrong secret
 */
async function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or malformed Authorization header" });
        return;
    }
    const token = header.slice(7);
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        res.status(500).json({ error: "Server misconfiguration: JWT_SECRET not set" });
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, secret);
        const normalizedAddress = payload.address.toLowerCase();
        // Check if session exists and is active in database (revocation check)
        const [session] = await db_1.db
            .select()
            .from(schema_1.sessions)
            .where((0, drizzle_orm_1.eq)(schema_1.sessions.jti, payload.jti));
        if (!session) {
            res.status(401).json({ error: "Session has been revoked or logged out" });
            return;
        }
        // Verify session expiration
        if (new Date() > new Date(session.expiresAt)) {
            // Clean up expired session asynchronously
            db_1.db.delete(schema_1.sessions).where((0, drizzle_orm_1.eq)(schema_1.sessions.jti, payload.jti)).catch(console.error);
            res.status(401).json({ error: "Session has expired" });
            return;
        }
        req.auth = {
            address: normalizedAddress,
            jti: payload.jti
        };
        next();
    }
    catch (err) {
        res.status(401).json({ error: "Invalid or expired access token" });
    }
}
