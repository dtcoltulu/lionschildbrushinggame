import path from "node:path";
import type { Ctx } from "@/server/context";
import { migrate, openDb, type Db } from "@/server/db";

export const TODAY = "2026-10-17";

/**
 * Her test dosyası kendi boş veritabanını kullanır. TEST_DATABASE_URL verilirse gerçek PostgreSQL'e
 * (ör. yerel Postgres 16) karşı çalışır; yoksa bellek içi PGlite (aynı SQL, gerçek Postgres motoru).
 */
let counter = 0;

export async function freshDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  let db: Db;
  if (url) {
    // Her test dünyası için ayrı, boş bir veritabanı (testler birbirinin verisini görmez).
    const name = `cihaz_t_${process.pid}_${Date.now()}_${counter++}`;
    const admin = await openDb({ kind: "pg", url });
    await admin.exec(`create database ${name}`);
    await admin.close();
    const u = new URL(url);
    u.pathname = `/${name}`;
    const inner = await openDb({ kind: "pg", url: u.toString() });
    db = {
      ...inner,
      async close() {
        await inner.close();
        const a = await openDb({ kind: "pg", url });
        await a.exec(`drop database if exists ${name}`);
        await a.close();
      },
    };
  } else {
    db = await openDb({ kind: "pglite", dir: "memory://" });
  }
  await migrate(db, path.resolve(import.meta.dirname, "../db/migrations"));
  return db;
}

export interface World {
  db: Db;
  admin: Ctx;
  staff: Ctx;
  loc: Record<string, string>;
  type: Record<string, string>;
  cause: Record<string, string>;
}

export async function world(today = TODAY): Promise<World> {
  const db = await freshDb();
  const [a] = await db.query<{ id: string }>(
    `insert into app_users (email, email_key, display_name, role) values ('y@test', 'y@test', 'Test Yönetici', 'admin') returning id`,
  );
  const [s] = await db.query<{ id: string }>(
    `insert into app_users (email, email_key, display_name, role) values ('p@test', 'p@test', 'Test Personel', 'staff') returning id`,
  );
  const admin: Ctx = { db, today, actor: { userId: a!.id, role: "admin", displayName: "Test Yönetici", email: "y@test", staffId: null } };
  const staff: Ctx = { db, today, actor: { userId: s!.id, role: "staff", displayName: "Test Personel", email: "p@test", staffId: null } };
  const loc = Object.fromEntries((await db.query<{ id: string; name: string }>(`select id, name from locations`)).map((r) => [r.name, r.id]));
  const type = Object.fromEntries((await db.query<{ id: string; p: string }>(`select id, code_prefix as p from device_types`)).map((r) => [r.p, r.id]));
  const cause = Object.fromEntries((await db.query<{ id: string; k: string }>(`select id, name_key as k from fault_causes`)).map((r) => [r.k, r.id]));
  return { db, admin, staff, loc, type, cause };
}

export const at = (ctx: Ctx, today: string): Ctx => ({ ...ctx, today });
