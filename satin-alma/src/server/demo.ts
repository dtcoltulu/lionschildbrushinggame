import "server-only";
import type { Queryable } from "./db";
import { environmentLabel } from "./env";

/** Şerit metni: ortam etiketi (GELİŞTİRME/TEST) veya veritabanı örnek veri içeriyorsa. Üretimde gerçek veride boş. */
export async function bannerText(q: Queryable): Promise<string | null> {
  const env = environmentLabel();
  const [c] = await q.query<{ is_demo: boolean }>(`select is_demo from clinics limit 1`).catch(() => [] as { is_demo: boolean }[]);
  if (env || c?.is_demo) return `${env ?? "ÖRNEK VERİ"} – Bu ekrandaki kayıtlar örnek/deneme verisidir. Gerçek klinik verisi girmeyin.`;
  return null;
}
