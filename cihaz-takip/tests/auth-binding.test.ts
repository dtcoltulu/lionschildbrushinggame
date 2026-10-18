import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveAuthUser } from "@/server/auth";
import { createUser } from "@/server/services/users";
import type { LoginAdmin } from "@/server/login-admin";
import { world, type World } from "./helpers";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));

const manual: LoginAdmin = {
  mode: "supabase-manual",
  usesPasswords: false,
  async createLogin() { return null; },
  async setPassword() { throw new Error("yok"); },
  async setBlocked() {},
  async deleteLogin() {},
  async passwordMatches() { return false; },
};

let w: World;
beforeAll(async () => {
  w = await world();
});
afterAll(async () => w.db.close());

describe("Supabase hesabının uygulama hesabına bağlanması", () => {
  it("yöneticinin eklediği kullanıcı, panelden açılan hesapla ilk girişte (doğrulanmış e-posta) bağlanır", async () => {
    const { user } = await createUser(w.admin, { email: "Asistan@Klinik.test", displayName: "Asistan Bir", role: "staff" }, manual);
    expect(user.hasAuthLogin).toBe(false);
    const authId = "11111111-1111-4111-8111-111111111111";
    // E-postası doğrulanmamış Supabase hesabı bağlanamaz
    expect((await resolveAuthUser(w.db, { id: authId, email: "asistan@klinik.test", emailConfirmed: false })).kind).toBe("no_access");
    const ok = await resolveAuthUser(w.db, { id: authId, email: "asistan@klinik.test", emailConfirmed: true });
    expect(ok.kind).toBe("ok");
    // Sonraki girişler auth kimliğiyle eşleşir; aynı e-postayla başka bir Supabase hesabı bağlanamaz
    expect((await resolveAuthUser(w.db, { id: authId, email: "baska@klinik.test", emailConfirmed: true })).kind).toBe("ok");
    expect((await resolveAuthUser(w.db, { id: "22222222-2222-4222-8222-222222222222", email: "asistan@klinik.test", emailConfirmed: true })).kind).toBe("no_access");
  });

  it("ilk yönetici yalnızca BOOTSTRAP_ADMIN_EMAIL ile ve hiç yönetici yokken oluşur", async () => {
    vi.stubEnv("BOOTSTRAP_ADMIN_EMAIL", "Sahip@Klinik.test");
    const fresh = await world();
    await fresh.db.query(`delete from app_users`);
    const stranger = await resolveAuthUser(fresh.db, { id: "33333333-3333-4333-8333-333333333333", email: "yabanci@klinik.test", emailConfirmed: true });
    expect(stranger.kind).toBe("no_access");
    const unconfirmed = await resolveAuthUser(fresh.db, { id: "44444444-4444-4444-8444-444444444444", email: "sahip@klinik.test", emailConfirmed: false });
    expect(unconfirmed.kind).toBe("no_access");
    // İlk hesap genel yöneticidir: önce çalışacağı kliniği seçer, sonra o klinikte yönetici olarak çalışır.
    const owner = await resolveAuthUser(fresh.db, { id: "44444444-4444-4444-8444-444444444444", email: "sahip@klinik.test", emailConfirmed: true });
    expect(owner.kind).toBe("choose_clinic");
    const inClinic = await resolveAuthUser(
      fresh.db,
      { id: "44444444-4444-4444-8444-444444444444", email: "sahip@klinik.test", emailConfirmed: true },
      { selectedClinicId: fresh.clinicId },
    );
    expect(inClinic.kind === "ok" && [inClinic.actor.role, inClinic.actor.superAdmin, inClinic.actor.clinicId]).toEqual(["admin", true, fresh.clinicId]);
    // Yönetici varken aynı e-postayla ikinci bir Supabase hesabı yönetici olamaz
    const second = await resolveAuthUser(fresh.db, { id: "55555555-5555-4555-8555-555555555555", email: "sahip@klinik.test", emailConfirmed: true });
    expect(second.kind).toBe("no_access");
    vi.unstubAllEnvs();
    await fresh.db.close();
  });
});
