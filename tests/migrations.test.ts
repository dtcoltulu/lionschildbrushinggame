import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_NAMES } from "@/types/analytics";

const DIR = path.resolve(import.meta.dirname, "../supabase/migrations");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** Bir geçiş dosyasından `name in (...)` listesindeki olay adlarını çıkarır. */
function namesIn(sql: string): string[] {
  const m = /name\s+in\s*\(([^)]*)\)/i.exec(sql);
  return m ? [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!) : [];
}

describe("veritabanı geçişleri ↔ uygulama olay adları", () => {
  it("geçişler sırayla numaralı", () => {
    expect(files[0]).toMatch(/^0001_/);
    files.forEach((f, i) => expect(f.startsWith(String(i + 1).padStart(4, "0"))).toBe(true));
  });

  it("en son ad kısıtı, uygulamanın bildiği TÜM olay adlarını içerir (eksik ad = olay kaybı)", () => {
    const latest = [...files].reverse().find((f) => namesIn(fs.readFileSync(path.join(DIR, f), "utf8")).length > 0)!;
    const names = namesIn(fs.readFileSync(path.join(DIR, latest), "utf8"));
    expect([...names].sort()).toEqual([...EVENT_NAMES].sort());
  });

  it("0002 yalnızca ad kısıtını genişletir (atomik tek ALTER, veri silmez/değiştirmez)", () => {
    const sql = fs.readFileSync(path.join(DIR, "0002_self_check_events.sql"), "utf8").replace(/--.*$/gm, "");
    expect(sql.match(/\balter\s+table\b/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(delete|truncate|drop\s+table|update)\b/i);
    expect(sql).toMatch(/drop constraint events_name_check/i);
    expect(sql).toMatch(/add constraint events_name_check/i);
    expect(namesIn(sql)).toEqual(expect.arrayContaining(["self_check_yes", "self_check_no"]));
  });

  it("0001'deki dokuz ad hâlâ yeni listenin içinde (geriye dönük uyum)", () => {
    const old = namesIn(fs.readFileSync(path.join(DIR, "0001_init.sql"), "utf8"));
    expect(old).toHaveLength(9);
    const latest = namesIn(fs.readFileSync(path.join(DIR, "0002_self_check_events.sql"), "utf8"));
    for (const n of old) expect(latest).toContain(n);
  });
});
