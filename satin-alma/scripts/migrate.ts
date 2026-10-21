/**
 * Veritabanı geçişlerini uygular.
 *   DATABASE_URL=postgres://… npm run db:migrate      (Supabase: "Session pooler" ya da doğrudan bağlantı adresi)
 * DATABASE_URL yoksa yerel geliştirme veritabanına (.data/pglite) uygular.
 */
import { migrate, openDb } from "../src/server/db";

async function main() {
  const url = process.env.DATABASE_URL;
  const db = await openDb(url ? { kind: "pg", url } : { kind: "pglite", dir: process.env.LOCAL_DB_DIR ?? ".data/pglite" });
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `Uygulanan geçişler: ${applied.join(", ")}` : "Veritabanı güncel; uygulanacak geçiş yok.");
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error("Geçiş başarısız:", e instanceof Error ? e.message : e);
  process.exit(1);
});
