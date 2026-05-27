import "dotenv/config";
import postgres from "postgres";

async function main() {
  const client = postgres(process.env.DATABASE_URL!);
  try {
    await client`
      ALTER TABLE "app"."pending_registrations"
      ADD COLUMN IF NOT EXISTS "name" text
    `;
    console.log("✓ Column 'name' added (or already existed)");
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main();
