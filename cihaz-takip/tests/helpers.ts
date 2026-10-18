import path from "node:path";
import type { Actor, Ctx } from "@/server/context";
import { forClinic, migrate, openDb, enableTenantRole, type Db } from "@/server/db";

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
  // Testler süper kullanıcıyla bağlanır; klinik işlemleri uygulamadaki gibi RLS'i atlayamayan role geçer.
  await enableTenantRole(db);
  return db;
}

/** 0004 geçişinin açtığı ilk klinik (Koşuyolu Park). */
export const FIRST_CLINIC = "00000000-0000-4000-8000-000000000001";

export interface World {
  /** Klinik kapsamı olmayan (süper kullanıcı) bağlantı: yalnızca test doğrulamaları ve kurulum için. */
  db: Db;
  clinicId: string;
  admin: Ctx;
  staff: Ctx;
  loc: Record<string, string>;
  type: Record<string, string>;
  cause: Record<string, string>;
}

export function actorOf(id: string, role: "admin" | "staff", displayName: string, email: string, clinicId = FIRST_CLINIC, extra: Partial<Actor> = {}): Actor {
  return { userId: id, role, displayName, email, staffId: null, clinicId, clinicName: "Koşuyolu Park", superAdmin: false, shared: false, ...extra };
}

/** Klinikte bir yönetici ve bir personel hesabı; servisler ctx.db (yalnızca o klinik) ile çağrılır. */
export async function world(today = TODAY, opts: { db?: Db; clinicId?: string; tag?: string } = {}): Promise<World> {
  const db = opts.db ?? (await freshDb());
  const clinicId = opts.clinicId ?? FIRST_CLINIC;
  const scoped = forClinic(db, clinicId);
  const tag = opts.tag ?? "";
  const user = async (email: string, name: string, role: string) =>
    (await scoped.query<{ id: string }>(
      `insert into app_users (email, email_key, display_name, role, clinic_id) values ($1, $1, $2, $3, $4) returning id`,
      [email, name, role, clinicId],
    ))[0]!.id;
  const a = await user(`y${tag}@test`, "Test Yönetici", "admin");
  const s = await user(`p${tag}@test`, "Test Personel", "staff");
  const admin: Ctx = { db: scoped, today, actor: actorOf(a, "admin", "Test Yönetici", `y${tag}@test`, clinicId) };
  const staff: Ctx = { db: scoped, today, actor: actorOf(s, "staff", "Test Personel", `p${tag}@test`, clinicId) };
  const loc = Object.fromEntries((await scoped.query<{ id: string; name: string }>(`select id, name from locations`)).map((r) => [r.name, r.id]));
  const type = Object.fromEntries((await scoped.query<{ id: string; p: string }>(`select id, code_prefix as p from device_types`)).map((r) => [r.p, r.id]));
  const cause = Object.fromEntries((await scoped.query<{ id: string; k: string }>(`select id, name_key as k from fault_causes`)).map((r) => [r.k, r.id]));
  return { db, clinicId, admin, staff, loc, type, cause };
}

export const at = (ctx: Ctx, today: string): Ctx => ({ ...ctx, today });
