import "server-only";
import fs from "node:fs";
import path from "node:path";
import { authMode, dbConfig, type DbConfig } from "./env";

/** Sorgu çalıştırabilen her şey (bağlantı havuzu ya da açık işlem). */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Tek işlem (transaction): hata olursa tüm değişiklikler geri alınır. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Çok komutlu SQL (geçiş dosyaları). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// Tür dönüşümleri iki sürücüde aynı: date → "YYYY-MM-DD", timestamptz → ISO metin, bigint/numeric → sayı.
const OID = { INT8: 20, NUMERIC: 1700, DATE: 1082, TIMESTAMPTZ: 1184 } as const;
const toIso = (v: string) => new Date(v).toISOString();

async function createPg(url: string): Promise<Db> {
  const pg = await import("pg");
  const { Pool, types } = pg.default ?? pg;
  types.setTypeParser(OID.INT8, (v: string) => Number(v));
  types.setTypeParser(OID.NUMERIC, (v: string) => Number(v));
  types.setTypeParser(OID.DATE, (v: string) => v);
  types.setTypeParser(OID.TIMESTAMPTZ, toIso);

  // Bağlantı dizesindeki sslmode yerine TLS ayarı açıkça verilir.
  const u = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  u.searchParams.delete("sslmode");
  const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n");
  const ssl = local && !ca ? undefined : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: u.toString(), ssl, max: Number(process.env.DATABASE_POOL_MAX ?? 3), idleTimeoutMillis: 10_000 });

  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params);
      return r.rows as T[];
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const q: Queryable = {
          async query<R>(sql: string, params: unknown[] = []) {
            return (await client.query(sql, params)).rows as R[];
          },
        };
        const out = await fn(q);
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPglite(dir: string): Promise<Db> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const parsers = {
    [types.INT8]: (v: string) => Number(v),
    [types.NUMERIC]: (v: string) => Number(v),
    [types.DATE]: (v: string) => v,
    [types.TIMESTAMPTZ]: toIso,
  };
  if (dir !== "memory://") fs.mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir === "memory://" ? undefined : dir, { parsers });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await db.query<T>(sql, params)).rows;
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      return db.transaction(async (t) =>
        fn({
          async query<R>(sql: string, params: unknown[] = []) {
            return (await t.query<R>(sql, params)).rows;
          },
        }),
      );
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
}

export async function openDb(cfg: DbConfig): Promise<Db> {
  return cfg.kind === "pg" ? createPg(cfg.url) : createPglite(cfg.dir);
}

export function migrationsDir(): string {
  return path.join(process.cwd(), "db", "migrations");
}

/**
 * Uygulanmamış geçişleri sırayla uygular. Her dosya kendi işlemini açar ve kendini schema_migrations'a yazar.
 * Uygulama içinde yalnızca yerel (PGlite) modda çalışır; üretimde `npm run db:migrate` kullanılır.
 * Bu yüzden dosya okumaları sunucu paketine izlenmez (turbopackIgnore).
 */
export async function migrate(db: Db, dir = migrationsDir()): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ version: string }>("select version from schema_migrations")).map((r) => r.version));
  const applied: string[] = [];
  for (const file of fs.readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    const version = file.slice(0, 4);
    if (done.has(version)) continue;
    await db.exec(fs.readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, file), "utf8"));
    applied.push(file);
  }
  return applied;
}

type GlobalDb = { __cihazDb?: Promise<Db> };
const g = globalThis as GlobalDb;

/**
 * Uygulama genelinde tek bağlantı havuzu. Yerel (PGlite) modda geçişler otomatik uygulanır ve
 * ilk açılışta örnek veriler eklenir; üretimde geçişler `npm run db:migrate` ile bilinçli olarak uygulanır.
 * Önizleme (test) ortamı: ayrı şemadaki gerçek Postgres + deneme girişi; SEED_DEMO=1 ise veritabanı boşken
 * örnek veri eklenir. Bu yalnızca deneme girişinde (AUTH_MODE=dev) mümkündür, üretimde asla çalışmaz.
 */
export function getDb(): Promise<Db> {
  if (!g.__cihazDb) {
    g.__cihazDb = (async () => {
      const cfg = dbConfig();
      const db = await openDb(cfg);
      if (cfg.kind === "pglite") {
        await migrate(db);
        if (process.env.SEED_DEMO !== "0") {
          const { seedDemoIfEmpty } = await import("./seed-demo");
          await seedDemoIfEmpty(db);
        }
      } else if (process.env.SEED_DEMO === "1" && authMode() === "dev") {
        const { seedDemoIfEmpty } = await import("./seed-demo");
        // Aynı anda açılan iki sunucu örneğinden biri benzersizlik hatası alabilir; diğeri örnek veriyi ekler.
        await seedDemoIfEmpty(db).catch((e) => console.warn("[örnek veri]", e instanceof Error ? e.message : e));
      }
      return db;
    })().catch((e) => {
      g.__cihazDb = undefined;
      throw e;
    });
  }
  return g.__cihazDb;
}
