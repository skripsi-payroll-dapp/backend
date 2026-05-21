"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
const crypto_1 = __importDefault(require("crypto"));
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard IV length is 12 bytes
/**
 * Gets the cryptographically secure 32-byte key from the environment.
 * Uses SHA-256 hashing to guarantee the key is exactly 32 bytes,
 * regardless of the length of ENCRYPTION_KEY set in .env.
 */
function getKey() {
    const rawKey = process.env.ENCRYPTION_KEY;
    if (!rawKey) {
        throw new Error("Server misconfiguration: ENCRYPTION_KEY is not set in environment");
    }
    return crypto_1.default.createHash("sha256").update(rawKey).digest();
}
/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a colon-separated string: "iv_hex:auth_tag_hex:ciphertext_hex"
 */
function encrypt(text) {
    if (!text)
        return "";
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, getKey(), iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}
/**
 * Decrypts a colon-separated cipher text using AES-256-GCM.
 */
function decrypt(cipherText) {
    if (!cipherText)
        return "";
    const parts = cipherText.split(":");
    if (parts.length !== 3) {
        throw new Error("Invalid cipher text format");
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, undefined, "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
