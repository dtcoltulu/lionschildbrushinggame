import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPassword, createSessionToken, verifySessionToken, adminConfigured, SESSION_TTL_MS } from "@/lib/auth";

const ENV = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_PASSWORD = "dogru-parola-12345";
  process.env.ADMIN_SESSION_SECRET = "s".repeat(40);
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("admin auth", () => {
  it("doğru/yanlış parola", () => {
    expect(checkPassword("dogru-parola-12345")).toBe(true);
    expect(checkPassword("yanlis")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
  it("token doğrulanır", () => {
    const t = createSessionToken()!;
    expect(verifySessionToken(t)).toBe(true);
  });
  it("süresi dolan token reddedilir", () => {
    const t = createSessionToken(1000)!;
    expect(verifySessionToken(t, 1000 + SESSION_TTL_MS + 1)).toBe(false);
  });
  it("kurcalanmış token reddedilir", () => {
    const t = createSessionToken()!;
    const [exp, sig] = t.split(".");
    expect(verifySessionToken(`${Number(exp) + 100000}.${sig}`)).toBe(false);
    expect(verifySessionToken(`${exp}.${sig!.slice(0, -2)}xx`)).toBe(false);
    expect(verifySessionToken("abc")).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
  });
  it("farklı sır ile üretilmiş token reddedilir", () => {
    const t = createSessionToken()!;
    process.env.ADMIN_SESSION_SECRET = "z".repeat(40);
    expect(verifySessionToken(t)).toBe(false);
  });
  it("yapılandırma yoksa admin tamamen kapalıdır", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(adminConfigured()).toBe(false);
    expect(checkPassword("dogru-parola-12345")).toBe(false);
    process.env.ADMIN_PASSWORD = "kisa";
    expect(adminConfigured()).toBe(false);
  });
});
