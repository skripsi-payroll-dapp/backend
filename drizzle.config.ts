import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
dotenv.config();

export default defineConfig({
  schema:    "./src/db/schema.ts",
  out:       "./drizzle",
  dialect:   "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Backend off-chain tables live in "app" schema
  // Ponder-indexed tables live in "public" schema (managed by Ponder)
  schemaFilter: ["app"],
});
