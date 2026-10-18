import type { UserRole } from "@/lib/labels";
import type { Db } from "./db";

/** Giriş yapmış kullanıcı (uygulama hesabı). Personel kartı ayrı kavramdır; staffId bağlıysa doludur. */
export interface Actor {
  userId: string;
  role: UserRole;
  displayName: string;
  email: string;
  staffId: string | null;
  /** Şu an çalışılan klinik. Bütün veriler bu kliniğe aittir. */
  clinicId: string;
  clinicName: string;
  /** Genel yönetici: klinik ekler, her kliniğe girebilir. */
  superAdmin: boolean;
  /** Kliniğin ortak girişi (personel şifresi ya da yönetici şifresi). */
  shared: boolean;
}

/**
 * Her servis çağrısının bağlamı: işlemi yapan kişi, klinik saatine göre "bugün" ve YALNIZCA o kliniğin
 * verisini gören veritabanı bağlantısı (forClinic).
 */
export interface Ctx {
  db: Db;
  actor: Actor;
  today: string;
}
