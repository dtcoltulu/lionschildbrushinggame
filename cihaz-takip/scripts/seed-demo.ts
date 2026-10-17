/** Yerel geliştirme veritabanına (PGlite) örnek veri ekler. Gerçek (DATABASE_URL) veritabanına ASLA yazmaz. */
import { migrate, openDb } from "../src/server/db";
import { seedDemoIfEmpty } from "../src/server/seed-demo";

async function main() {
  if (process.env.DATABASE_URL) {
    console.error("DATABASE_URL tanımlı: örnek veri yalnızca yerel geliştirme veritabanına eklenir. İptal edildi.");
    process.exit(1);
  }
  const db = await openDb({ kind: "pglite", dir: process.env.LOCAL_DB_DIR ?? ".data/pglite" });
  try {
    await migrate(db);
    await seedDemoIfEmpty(db);
    console.log("Örnek veri hazır (veritabanı boştuysa eklendi).");
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
