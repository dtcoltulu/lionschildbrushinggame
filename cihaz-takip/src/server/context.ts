import type { UserRole } from "@/lib/labels";
import type { Db } from "./db";

/** Giriş yapmış kullanıcı (uygulama hesabı). Personel kartı ayrı kavramdır; staffId bağlıysa doludur. */
export interface Actor {
  userId: string;
  role: UserRole;
  displayName: string;
  email: string;
  staffId: string | null;
}

/** Her servis çağrısının bağlamı: veritabanı, işlemi yapan kişi ve klinik saatine göre "bugün". */
export interface Ctx {
  db: Db;
  actor: Actor;
  today: string;
}
