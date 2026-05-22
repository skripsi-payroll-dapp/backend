import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config({ path: '.env' });

async function wipePonderCache() {
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
  try {
    console.log("Menghapus cache Ponder di database...");
    
    // Ponder menyimpan log indexing di schema _ponder_... (biasanya _ponder atau _ponder_meta)
    // Untuk amannya, kita hapus seluruh isi schema public agar tabel terbuat ulang
    await sql`DROP SCHEMA public CASCADE;`;
    await sql`CREATE SCHEMA public;`;
    await sql`GRANT ALL ON SCHEMA public TO public;`;
    
    console.log("✅ Database berhasil di-reset!");
    console.log("Azure Ponder akan mendeteksi perubahan ini dan melakukan indexing ulang dari awal.");
  } catch (err) {
    console.error("❌ Gagal reset database:", err.message);
  } finally {
    await sql.end();
  }
}

wipePonderCache();
