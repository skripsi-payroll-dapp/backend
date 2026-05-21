"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.complianceRouter = void 0;
const express_1 = require("express");
const postgres_1 = __importDefault(require("postgres"));
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../middleware/auth");
const encryption_1 = require("../services/encryption");
const drizzle_orm_1 = require("drizzle-orm");
exports.complianceRouter = (0, express_1.Router)();
// Direct SQL client for reading Ponder-indexed tables (public schema)
const sql = (0, postgres_1.default)(process.env.DATABASE_URL);
/**
 * GET /compliance/export/:hr?month=2025-01
 *
 * Exports per-employee BPJS/PPh21 breakdown as CSV for monthly reconciliation.
 * Reads from Ponder-indexed salary_claim table (FR-C03) and decrypts employee profiles.
 *
 * Query params:
 *   month — YYYY-MM format (required)
 */
exports.complianceRouter.get("/export/:hr", auth_1.requireAuth, async (req, res) => {
    const hrAddress = String(req.params.hr).toLowerCase();
    // HR can only export their own company's data
    const callerAddress = req.auth.address;
    if (callerAddress !== hrAddress) {
        return res.status(403).json({ error: "Forbidden: you can only export your own company data" });
    }
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Query param 'month' is required in YYYY-MM format" });
    }
    const [year, mon] = month.split("-").map(Number);
    const from = Math.floor(new Date(year, mon - 1, 1).getTime() / 1000);
    const to = Math.floor(new Date(year, mon, 1).getTime() / 1000);
    try {
        // Query Ponder-indexed salary claims for this HR's company in the given month
        const rows = await sql `
      SELECT
        employee,
        COUNT(*)::text                   AS claim_count,
        SUM(accrued)::text               AS total_accrued,
        SUM(to_compliance)::text         AS total_compliance,
        SUM(to_severance)::text          AS total_severance
      FROM salary_claim
      WHERE hr_authority = ${hrAddress}
        AND timestamp >= ${from}
        AND timestamp <  ${to}
      GROUP BY employee
      ORDER BY employee
    `;
        if (rows.length === 0) {
            return res.status(404).json({ error: "No claims found for this period" });
        }
        // Fetch and decrypt employee profiles
        const employeeAddresses = rows.map((r) => r.employee.toLowerCase());
        const empProfiles = await db_1.db
            .select()
            .from(schema_1.employees)
            .where((0, drizzle_orm_1.inArray)(schema_1.employees.address, employeeAddresses));
        const profileMap = new Map();
        for (const emp of empProfiles) {
            try {
                profileMap.set(emp.address.toLowerCase(), {
                    name: (0, encryption_1.decrypt)(emp.name),
                    nik: (0, encryption_1.decrypt)(emp.nik),
                    phone: (0, encryption_1.decrypt)(emp.phone),
                });
            }
            catch (err) {
                console.error(`[compliance] Decryption failed for employee ${emp.address}:`, err);
            }
        }
        // Build CSV
        const header = "employee_address,employee_name,employee_nik,employee_phone,claim_count,total_accrued_idrx,compliance_bpjs_idrx,severance_idrx";
        const lines = rows.map((r) => {
            const addr = r.employee.toLowerCase();
            const profile = profileMap.get(addr) || { name: "N/A", nik: "N/A", phone: "N/A" };
            const escapedName = profile.name.includes(",") ? `"${profile.name}"` : profile.name;
            return `${r.employee},${escapedName},${profile.nik},${profile.phone},${r.claim_count},${r.total_accrued},${r.total_compliance},${r.total_severance}`;
        });
        const csv = [header, ...lines].join("\n");
        // Audit log
        await db_1.db.insert(schema_1.auditLogs).values({
            action: "COMPLIANCE_EXPORT",
            actor: hrAddress,
            meta: JSON.stringify({ month, rowCount: rows.length }),
        });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="compliance_${hrAddress}_${month}.csv"`);
        return res.send(csv);
    }
    catch (err) {
        console.error("[compliance] Export error:", err);
        return res.status(500).json({ error: "Export failed" });
    }
});
/**
 * GET /compliance/summary/:hr?month=2025-01
 *
 * Returns JSON summary — used by HR dashboard before download.
 */
exports.complianceRouter.get("/summary/:hr", async (req, res) => {
    const hrAddress = String(req.params.hr).toLowerCase();
    // HR can only view their own company's summary
    const callerAddress = req.auth.address;
    if (callerAddress !== hrAddress) {
        return res.status(403).json({ error: "Forbidden: you can only view your own company summary" });
    }
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Query param 'month' is required in YYYY-MM format" });
    }
    const [year, mon] = month.split("-").map(Number);
    const from = Math.floor(new Date(year, mon - 1, 1).getTime() / 1000);
    const to = Math.floor(new Date(year, mon, 1).getTime() / 1000);
    try {
        const [agg] = await sql `
      SELECT
        COUNT(DISTINCT employee)::text   AS employee_count,
        SUM(accrued)::text               AS total_accrued,
        SUM(to_compliance)::text         AS total_compliance,
        SUM(to_severance)::text          AS total_severance
      FROM salary_claim
      WHERE hr_authority = ${hrAddress}
        AND timestamp >= ${from}
        AND timestamp <  ${to}
    `;
        const rows = await sql `
      SELECT
        employee,
        COUNT(*)::text                   AS claim_count,
        SUM(accrued)::text               AS total_accrued,
        SUM(to_compliance)::text         AS total_compliance,
        SUM(to_severance)::text          AS total_severance
      FROM salary_claim
      WHERE hr_authority = ${hrAddress}
        AND timestamp >= ${from}
        AND timestamp <  ${to}
      GROUP BY employee
      ORDER BY employee
    `;
        return res.json({
            month,
            hrAddress,
            employeeCount: agg.employee_count ?? "0",
            totalAccrued: agg.total_accrued ?? "0",
            totalCompliance: agg.total_compliance ?? "0",
            totalSeverance: agg.total_severance ?? "0",
            rows: rows
        });
    }
    catch (err) {
        console.error("[compliance] Summary error:", err);
        return res.status(500).json({ error: "Summary failed" });
    }
});
