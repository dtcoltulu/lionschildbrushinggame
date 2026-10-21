import { createHash } from "node:crypto";
import { audit } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConfigError, supabaseConfig } from "../env";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { can } from "../permissions";

/**
 * Kalıcı dosya saklama: talep/teslimat/sorun fotoğrafları, ürün görseli, fatura ve dekont dosyaları.
 *  - FILE_STORAGE=db (varsayılan): içerik veritabanında (file_blobs) — yedekle (pg_dump) birlikte alınır.
 *  - FILE_STORAGE=supabase: içerik Supabase Storage'daki ÖZEL bir kovada; yalnızca sunucu (gizli anahtarla) okur/yazar.
 * Dosyalar her zaman uygulama üzerinden, yetki kontrolüyle verilir (doğrudan bağlantı yok).
 * Fotoğraflarda hasta bilgisi (yüz, ad, protokol no) bulunmamalıdır.
 */

export type FileEntity = "request" | "variant" | "receipt" | "issue" | "invoice" | "payment" | "adjustment";
export const FILE_ENTITIES: FileEntity[] = ["request", "variant", "receipt", "issue", "invoice", "payment", "adjustment"];
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FINANCE: FileEntity[] = ["invoice", "payment", "adjustment"];

export interface FileMeta {
  id: string;
  entity: FileEntity;
  entityId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedByName: string;
  uploadedAt: string;
}

/** İçerik türü dosyanın ilk baytlarından doğrulanır (uzantıya/beyana güvenilmez). */
export function sniffMime(data: Uint8Array): string | null {
  const b = (i: number) => data[i] ?? -1;
  const ascii = (from: number, to: number) => String.fromCharCode(...data.slice(from, to));
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|mif1|msf1|hevc)$/.test(ascii(8, 12))) return "image/heic";
  return null;
}

async function entityOwner(q: Queryable, entity: FileEntity, id: string): Promise<{ requestedBy?: string; receiverUserId?: string | null } | null> {
  switch (entity) {
    case "request": {
      const [r] = await q.query<{ requestedBy: string }>(`select requested_by as "requestedBy" from requests where id = $1`, [id]);
      return r ?? null;
    }
    case "receipt": {
      const [r] = await q.query<{ receiverUserId: string | null }>(`select po.receiver_user_id as "receiverUserId" from receipts r join purchase_orders po on po.id = r.order_id where r.id = $1`, [id]);
      return r ?? null;
    }
    case "issue": {
      const [r] = await q.query<{ receiverUserId: string | null }>(`select po.receiver_user_id as "receiverUserId" from delivery_issues d join purchase_orders po on po.id = d.order_id where d.id = $1`, [id]);
      return r ?? null;
    }
    case "variant":
      return (await q.query(`select 1 from variants where id = $1`, [id])).length ? {} : null;
    case "invoice":
      return (await q.query(`select 1 from invoices where id = $1`, [id])).length ? {} : null;
    case "payment":
      return (await q.query(`select 1 from payments where id = $1`, [id])).length ? {} : null;
    case "adjustment":
      return (await q.query(`select 1 from financial_adjustments where id = $1`, [id])).length ? {} : null;
  }
}

/** Dosya erişimi, bağlı olduğu kaydın yetkisiyle aynıdır (ör. fatura dosyası yalnızca finans rolüne). */
async function assertAccess(ctx: Ctx, q: Queryable, entity: FileEntity, entityId: string, mode: "read" | "write") {
  if (FINANCE.includes(entity)) {
    if (!can(ctx.actor, mode === "read" ? "finance.view" : "finance.manage")) throw new ForbiddenError("Finansal belgeler yalnızca finans / klinik yöneticisi rolüne açıktır.");
  }
  const owner = await entityOwner(q, entity, entityId);
  if (!owner) throw new NotFoundError("Dosyanın bağlı olduğu kayıt bulunamadı.");
  const me = ctx.actor.userId;
  const ok = (() => {
    switch (entity) {
      case "request":
        return owner.requestedBy === me || can(ctx.actor, mode === "read" ? "request.viewAll" : "request.decide");
      case "variant":
        return can(ctx.actor, mode === "read" ? "catalog.view" : "catalog.manage");
      case "receipt":
      case "issue":
        if (mode === "read" && can(ctx.actor, "order.view")) return true;
        if (can(ctx.actor, "order.manage")) return true;
        return can(ctx.actor, entity === "receipt" ? "receipt.record" : "issue.report") && owner.receiverUserId === me;
      default:
        return true;
    }
  })();
  if (!ok) throw new ForbiddenError("Bu dosyaya erişim yetkiniz yok.");
}

const storageKind = () => (process.env.FILE_STORAGE === "supabase" ? "supabase" : "db");
const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || "satin-alma";

async function storageClient() {
  const cfg = supabaseConfig();
  if (!cfg.serviceRoleKey) throw new ConfigError("FILE_STORAGE=supabase için SUPABASE_SERVICE_ROLE_KEY tanımlı olmalı.");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(bucket());
}

export async function uploadFile(ctx: Ctx, input: { entity: string; entityId: string; filename: string; data: Uint8Array }): Promise<FileMeta> {
  const entity = input.entity as FileEntity;
  if (!FILE_ENTITIES.includes(entity)) throw new ValidationError({ entity: "Geçersiz dosya türü." });
  if (!input.data.length) throw new ValidationError({ file: "Dosya boş." });
  if (input.data.length > MAX_FILE_BYTES) throw new ValidationError({ file: `Dosya en fazla ${MAX_FILE_BYTES / 1024 / 1024} MB olabilir (telefon fotoğrafları yüklenirken otomatik küçültülür).` });
  const mime = sniffMime(input.data);
  if (!mime) throw new ValidationError({ file: "Yalnızca fotoğraf (JPEG, PNG, WebP, HEIC) veya PDF yüklenebilir." });
  if (entity === "variant" && !mime.startsWith("image/")) throw new ValidationError({ file: "Ürün görseli bir fotoğraf olmalı." });
  const filename = input.filename.replace(/[\\/\r\n"]/g, "_").slice(0, 120) || "dosya";
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const kind = storageKind();
  return ctx.db.tx(async (q) => {
    await assertAccess(ctx, q, entity, input.entityId, "write");
    const [row] = await q.query<{ id: string }>(
      `insert into files (entity, entity_id, filename, mime, size_bytes, sha256, storage, uploaded_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [entity, input.entityId, filename, mime, input.data.length, sha256, kind, ctx.actor.userId],
    );
    const id = row!.id;
    if (kind === "db") {
      await q.query(`insert into file_blobs (file_id, data) values ($1, $2)`, [id, Buffer.from(input.data)]);
    } else {
      const key = `${ctx.actor.clinicId}/${entity}/${id}`;
      const { error } = await (await storageClient()).upload(key, Buffer.from(input.data), { contentType: mime, upsert: false });
      if (error) throw new ConfigError(`Dosya depolamaya yazılamadı: ${error.message}`);
      await q.query(`update files set storage_key = $2 where id = $1`, [id, key]);
    }
    if (entity === "variant") await q.query(`update variants set image_file_id = $2 where id = $1`, [input.entityId, id]);
    await audit(q, ctx, { entity, entityId: input.entityId, action: "file", summary: `Dosya eklendi: ${filename} (${Math.ceil(input.data.length / 1024)} KB)`, finance: FINANCE.includes(entity) });
    return (await listFilesQ(q, entity, input.entityId)).find((f) => f.id === id)!;
  });
}

async function listFilesQ(q: Queryable, entity: FileEntity, entityId: string): Promise<FileMeta[]> {
  return q.query<FileMeta>(
    `select f.id, f.entity, f.entity_id as "entityId", f.filename, f.mime, f.size_bytes as "sizeBytes", u.display_name as "uploadedByName", f.uploaded_at as "uploadedAt"
     from files f join app_users u on u.id = f.uploaded_by where f.entity = $1 and f.entity_id = $2 and f.deleted_at is null order by f.uploaded_at`,
    [entity, entityId],
  );
}

export async function listFiles(ctx: Ctx, entity: FileEntity, entityId: string): Promise<FileMeta[]> {
  await assertAccess(ctx, ctx.db, entity, entityId, "read");
  return listFilesQ(ctx.db, entity, entityId);
}

export async function readFile(ctx: Ctx, id: string): Promise<{ meta: FileMeta; data: Uint8Array }> {
  const [f] = await ctx.db.query<{ entity: FileEntity; entityId: string; storage: string; storageKey: string | null }>(
    `select entity, entity_id as "entityId", storage, storage_key as "storageKey" from files where id = $1 and deleted_at is null`,
    [id],
  );
  if (!f) throw new NotFoundError("Dosya bulunamadı.");
  await assertAccess(ctx, ctx.db, f.entity, f.entityId, "read");
  const meta = (await listFilesQ(ctx.db, f.entity, f.entityId)).find((x) => x.id === id)!;
  if (f.storage === "db") {
    const [b] = await ctx.db.query<{ data: Uint8Array }>(`select data from file_blobs where file_id = $1`, [id]);
    if (!b) throw new NotFoundError("Dosya içeriği bulunamadı.");
    return { meta, data: b.data };
  }
  const { data, error } = await (await storageClient()).download(f.storageKey!);
  if (error || !data) throw new NotFoundError("Dosya depolamada bulunamadı.");
  return { meta, data: new Uint8Array(await data.arrayBuffer()) };
}

/** Dosya kaldırma (mantıksal): yükleyen kişi veya kaydın yönetim yetkisi olan. İçerik silinmez (geçmiş korunur). */
export async function removeFile(ctx: Ctx, id: string): Promise<void> {
  await ctx.db.tx(async (q) => {
    const [f] = await q.query<{ entity: FileEntity; entityId: string; uploadedBy: string; filename: string }>(
      `select entity, entity_id as "entityId", uploaded_by as "uploadedBy", filename from files where id = $1 and deleted_at is null`,
      [id],
    );
    if (!f) throw new NotFoundError("Dosya bulunamadı.");
    await assertAccess(ctx, q, f.entity, f.entityId, "write");
    await q.query(`update files set deleted_at = now(), deleted_by = $2 where id = $1`, [id, ctx.actor.userId]);
    if (f.entity === "variant") await q.query(`update variants set image_file_id = null where id = $1 and image_file_id = $2`, [f.entityId, id]);
    await audit(q, ctx, { entity: f.entity, entityId: f.entityId, action: "file_remove", summary: `Dosya kaldırıldı: ${f.filename}`, finance: FINANCE.includes(f.entity) });
  });
}
