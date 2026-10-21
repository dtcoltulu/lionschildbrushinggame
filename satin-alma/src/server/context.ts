import type { Role } from "@/lib/labels";
import type { Db } from "./db";

/** Giriş yapmış kullanıcı. Her işlem gerçek bir kişiyle ilişkilendirilir (ortak/paylaşılan giriş yoktur). */
export interface Actor {
  userId: string;
  displayName: string;
  email: string;
  /** Bir kullanıcının birden fazla rolü olabilir (ör. teslimat + finans). */
  roles: Role[];
  clinicId: string;
  clinicName: string;
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
