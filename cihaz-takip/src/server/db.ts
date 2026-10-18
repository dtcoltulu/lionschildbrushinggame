import "server-only";
import fs from "node:fs";
import path from "node:path";
import { isUuid } from "@/lib/validate";
import { authMode, ConfigError, dbConfig, type DbConfig } from "./env";

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
  /**
   * Klinik işlemlerinde geçilecek kısıtlı rol (yalnızca süper kullanıcıyla bağlanılan yerel/test veritabanı).
   * Nesnenin üzerinde durur: Next.js sunucu kodunu birden çok pakete böldüğünde modül düzeyindeki bir
   * tablo paylaşılmaz, bağlantı nesnesi ise (getDb önbelleği) paylaşılır.
   */
  tenantRole?: string;
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

// ---------------------------------------------------------------------------
// Klinik ayrımı
// Klinik verisi tutan tablolarda satır güvenliği (RLS) açıktır: bir işlem yalnızca `app.clinic_id`
// ayarındaki kliniğin satırlarını görür ve yalnızca o kliniğe satır ekler (bkz. 0004/0005 geçişleri).
// Servisler bu yüzden klinik süzgeci yazmaz; ctx.db her zaman forClinic() ile açılmış bağlantıdır.
// ---------------------------------------------------------------------------

/** Yerel/test veritabanında (süper kullanıcıyla bağlanılır) klinik işlemleri bu kısıtlı role geçer. */
export const TENANT_ROLE = "dentinel_tenant";
const rlsChecked = new WeakMap<Db, Promise<void>>();

/**
 * Süper kullanıcıyla bağlanılan veritabanlarında (PGlite, test Postgres'i) RLS uygulanmaz. Klinik işlemleri
 * RLS'i atlayamayan bir role geçerek çalışsın diye rol açılır ve yetkileri verilir. Geçişlerden sonra çağrılır.
 */
export async function enableTenantRole(db: Db): Promise<void> {
  await db.exec(`do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${TENANT_ROLE}') then
        begin
          create role ${TENANT_ROLE} nologin nobypassrls;
        exception when duplicate_object or unique_violation then null;
        end;
      end if;
      execute format('grant usage on schema %I to ${TENANT_ROLE}', current_schema());
      execute format('grant select, insert, update, delete on all tables in schema %I to ${TENANT_ROLE}', current_schema());
      execute format('grant usage, select on all sequences in schema %I to ${TENANT_ROLE}', current_schema());
    end $$;`);
  db.tenantRole = TENANT_ROLE;
}

/** Üretimde uygulama rolü RLS'i atlayabiliyorsa klinik ayrımı sağlanamaz: istek reddedilir. */
function assertRlsEnforced(root: Db, q: Queryable): Promise<void> {
  let p = rlsChecked.get(root);
  if (!p) {
    p = q
      .query<{ bypass: boolean }>(`select (rolsuper or rolbypassrls) as bypass from pg_roles where rolname = current_user`)
      .then(([r]) => {
        if (!r || r.bypass) {
          throw new ConfigError("Veritabanı rolü satır güvenliğini (RLS) atlıyor; klinik verileri ayrılamaz. Uygulama rolü NOBYPASSRLS olmalı.");
        }
      });
    p.catch(() => rlsChecked.delete(root));
    rlsChecked.set(root, p);
  }
  return p;
}

/** Yalnızca verilen kliniğin verisini gören bağlantı. Her sorgu, kliniği ayarlayan bir işlem içinde çalışır. */
export function forClinic(root: Db, clinicId: string): Db {
  if (!isUuid(clinicId)) throw new Error("Geçersiz klinik kimliği.");
  const role = root.tenantRole;
  const enter = async (q: Queryable) => {
    if (role) {
      await q.query(`select set_config('app.clinic_id', $1, true), set_config('role', $2, true)`, [clinicId, role]);
    } else {
      await q.query(`select set_config('app.clinic_id', $1, true)`, [clinicId]);
      await assertRlsEnforced(root, q);
    }
  };
  return {
    query: <T>(sql: string, params?: unknown[]) =>
      root.tx(async (q) => {
        await enter(q);
        return q.query<T>(sql, params);
      }),
    tx: <T>(fn: (q: Queryable) => Promise<T>) =>
      root.tx(async (q) => {
        await enter(q);
        return fn(q);
      }),
    async exec() {
      throw new Error("Klinik bağlantısında çok komutlu SQL çalıştırılmaz.");
    },
    async close() {},
  };
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
        await enableTenantRole(db);
        if (process.env.SEED_DEMO !== "0") {
          const { seedDemoIfEmpty } = await import("./seed-demo");
          await seedDemoIfEmpty(db);
        }
      } else if (process.env.DB_USE_TENANT_ROLE === "1") {
        // Yerelde süper kullanıcıyla bağlanılan Postgres: klinik işlemleri kısıtlı role geçer.
        await enableTenantRole(db);
      }
      if (cfg.kind === "pg" && process.env.SEED_DEMO === "1" && authMode() === "dev") {
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
