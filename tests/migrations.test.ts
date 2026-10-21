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

/** SQL'den satır içi yorumlar çıkarılmış hâli. */
const code = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8").replace(/--.*$/gm, "");

describe("Supabase Data API yetkileri (30 Ekim 2026'dan itibaren yeni tablolara yetki kendiliğinden verilmez)", () => {
  const all = files.map(code).join("\n");
  const tables = [...all.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)].map((m) => m[1]!);

  it("geçişlerde public şemasında tablolar oluşturuluyor (bu denetim boşa geçmesin)", () => {
    expect(tables).toEqual(expect.arrayContaining(["sessions", "events"]));
  });

  it("geçiş zincirinde oluşturulan HER tabloya service_role açıkça yetkili (yeniden kurulumda 'permission denied' olmasın)", () => {
    for (const t of tables) {
      expect(all, `${t}: service_role grant eksik`).toMatch(new RegExp(`grant\\s+[^;]*\\bon\\s+(?:table\\s+)?public\\.${t}\\s+to\\s+service_role`, "i"));
    }
  });

  it("anon ve authenticated hiçbir tabloya yetkilendirilmez; her tabloda RLS açık ve bu rollerin yetkisi kaldırılır", () => {
    expect(all).not.toMatch(/grant\s[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i);
    for (const t of tables) {
      expect(all, `${t}: RLS açılmamış`).toMatch(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i"));
      expect(all, `${t}: anon/authenticated yetkisi kaldırılmamış`).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+public\\.${t}\\s+from\\s+anon,\\s*authenticated`, "i"));
    }
    expect(all).not.toMatch(/create\s+policy/i); // policy yok: Data API üzerinden anonim erişim açılmaz
  });

  it("0003 yalnızca yetki verir/alır: veri ya da şema değiştirmez; tekrar çalıştırılabilir (grant/revoke idempotent)", () => {
    const sql = code("0003_explicit_service_role_grants.sql");
    const statements = sql.split(";").map((x) => x.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    // Her ifade grant ya da revoke ile başlar: create/alter/drop/insert/update/delete/truncate ifadesi yoktur
    for (const st of statements) expect(st).toMatch(/^(grant|revoke)\b/i);
  });
});
