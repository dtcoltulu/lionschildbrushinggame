import { afterAll, beforeAll, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { seedDemoIfEmpty } from "@/server/seed-demo";
import { freshDb } from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => db.close());

it("örnek veri boş veritabanına bir kez eklenir ve açıkça demo olarak işaretlenir", async () => {
  await seedDemoIfEmpty(db);
  await seedDemoIfEmpty(db);
  const [c] = await db.query<{ is_demo: boolean }>(`select is_demo from clinics`);
  expect(c!.is_demo).toBe(true);
  const users = await db.query<{ display_name: string }>(`select display_name from app_users`);
  expect(users.every((u) => u.display_name.startsWith("Demo "))).toBe(true);
  const suppliers = await db.query<{ name: string }>(`select name from suppliers`);
  expect(suppliers.every((s) => s.name.startsWith("Örnek "))).toBe(true);
  expect((await db.query(`select 1 from delivery_issues`)).length).toBe(2);
  expect((await db.query(`select 1 from purchase_orders`)).length).toBe(2);
});
