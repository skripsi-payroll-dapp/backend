import { config } from "dotenv";
import postgres from "postgres";

config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("No DATABASE_URL found");
    process.exit(1);
  }

  console.log("Connecting to", url.split("@")[1]); // print only the host part
  const sql = postgres(url);
  try {
    await sql`SELECT 1`;
    console.log("Connection successful!");
  } catch (error: any) {
    console.error("Connection failed:", error.message);
  } finally {
    await sql.end();
  }
}

main();
