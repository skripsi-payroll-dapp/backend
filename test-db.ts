import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config({ path: '.env' });

async function queryDB() {
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
  try {
    const rows = await sql`SELECT * FROM public.company`;
    console.log("Daftar Company di Database:");
    console.table(rows);
  } catch (err) {
    console.error("Gagal koneksi atau query:", err.message);
  } finally {
    await sql.end();
  }
}

queryDB();
