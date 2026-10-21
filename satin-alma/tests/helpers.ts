import path from "node:path";
import { expect } from "vitest";
import { addDays, todayIstanbul } from "@/lib/dates";
import type { Role } from "@/lib/labels";
import type { Actor, Ctx } from "@/server/context";
import { enableTenantRole, forClinic, migrate, openDb, type Db } from "@/server/db";
import { AppError } from "@/server/errors";
import { createVariant } from "@/server/services/catalog";
import { createSupplier } from "@/server/services/suppliers";

/** "Bugün": sipariş verme zamanı veritabanı saatinden (now()) alındığı için testler de gerçek günü kullanır. */
export const TODAY = todayIstanbul();
export const FIRST_CLINIC = "00000000-0000-4000-8000-000000000001";

let counter = 0;

/**
 * Her test dosyası kendi boş veritabanını kullanır. TEST_DATABASE_URL verilirse gerçek PostgreSQL'e karşı çalışır;
 * yoksa bellek içi PGlite (aynı SQL, gerçek Postgres motoru).
 */
export async function freshDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  let db: Db;
  if (url) {
    const name = `satinalma_t_${process.pid}_${Date.now()}_${counter++}`;
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
  await enableTenantRole(db);
  return db;
}

export interface World {
  db: Db;
  asistan: Ctx;
  satinalma: Ctx;
  teslimat: Ctx;
  finans: Ctx;
  supplierA: string;
  supplierB: string;
  /** Nitril eldiven M ve L beden (1 kutu = 100 adet), kompozit (SKT + lot takipli, en az 180 gün raf ömrü) */
  gloveM: string;
  gloveL: string;
  composite: string;
  location: string;
}

export function ctxFor(db: Db, userId: string, roles: Role[], name: string, today = TODAY): Ctx {
  const actor: Actor = { userId, displayName: name, email: `${userId}@test`, roles, clinicId: FIRST_CLINIC, clinicName: "Koşuyolu Park" };
  return { db: forClinic(db, FIRST_CLINIC), actor, today };
}

export async function world(): Promise<World> {
  const db = await freshDb();
  const scoped = forClinic(db, FIRST_CLINIC);
  const user = async (email: string, name: string, roles: Role[]) =>
    ctxFor(db, (await scoped.query<{ id: string }>(`insert into app_users (email, email_key, display_name, roles) values ($1, $1, $2, $3) returning id`, [email, name, roles]))[0]!.id, roles, name);
  const asistan = await user("asistan@test", "Test Asistan", ["asistan"]);
  const satinalma = await user("satinalma@test", "Test Satın Alma", ["satinalma"]);
  const teslimat = await user("teslimat@test", "Test Teslimat", ["teslimat"]);
  const finans = await user("finans@test", "Test Finans", ["finans"]);
  const [cat] = await scoped.query<{ id: string }>(`select id from categories where name_key = 'eldiven ve koruyucular'`);
  const [resto] = await scoped.query<{ id: string }>(`select id from categories where name_key = 'restoratif'`);
  const [loc] = await scoped.query<{ id: string }>(`select id from locations order by sort_order limit 1`);
  const supplierA = (await createSupplier(satinalma, { name: "Test Dental Depo A", currency: "TRY", dueDays: 30 })).id;
  const supplierB = (await createSupplier(satinalma, { name: "Test Dental Depo B", currency: "TRY" })).id;
  const gloveM = (await createVariant(satinalma, {
    productName: "Nitril muayene eldiveni", categoryId: cat!.id, brand: "Test Marka", model: "Pudrasız", attributes: "M beden",
    orderUnit: "kutu", baseUnit: "adet", packSize: "100", defaultVatRate: "10", suppliers: [{ supplierId: supplierA }],
  })).id;
  const gloveL = (await createVariant(satinalma, {
    productName: "Nitril muayene eldiveni", categoryId: cat!.id, brand: "Test Marka", model: "Pudrasız", attributes: "L beden",
    orderUnit: "kutu", baseUnit: "adet", packSize: "100", defaultVatRate: "10",
  })).id;
  const composite = (await createVariant(satinalma, {
    productName: "Kompozit dolgu", categoryId: resto!.id, brand: "Test Kompozit", attributes: "A2 · 4 g şırınga", orderUnit: "adet", baseUnit: "adet",
    packSize: "1", trackExpiry: true, trackLot: true, minShelfLifeDays: 180, defaultVatRate: "20",
  })).id;
  return { db, asistan, satinalma, teslimat, finans, supplierA, supplierB, gloveM, gloveL, composite, location: loc!.id };
}

export async function expectError(p: Promise<unknown>, status: number, code?: string): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e, String(e)).toBeInstanceOf(AppError);
    const err = e as AppError;
    expect(err.status, `${err.code}: ${err.message} ${JSON.stringify(err.fieldErrors)}`).toBe(status);
    if (code) expect(err.code).toBe(code);
    return err;
  }
  throw new Error("Hata bekleniyordu ama işlem başarılı oldu.");
}

export const inDays = (n: number) => addDays(TODAY, n);
