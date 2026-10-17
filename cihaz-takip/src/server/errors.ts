import type { FieldErrors } from "@/lib/validate";

/** Kullanıcıya gösterilebilir hata. HTTP katmanı bunu JSON'a çevirir. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: FieldErrors,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(fieldErrors: FieldErrors, message = "Bazı alanlarda düzeltme gerekiyor.") {
    super(422, "validation", message, fieldErrors);
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super(401, "unauthorized", "Oturumunuz kapanmış. Lütfen tekrar giriş yapın.");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Bu işlem için yönetici yetkisi gerekir.") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Kayıt bulunamadı.") {
    super(404, "not_found", message);
  }
}

/** Eşzamanlı düzenleme: başkası kaydı değiştirmiş, sessizce üzerine yazılmaz. */
export class VersionConflictError extends AppError {
  constructor(data?: Record<string, unknown>) {
    super(
      409,
      "version_conflict",
      "Bu kayıt siz düzenlerken başka biri tarafından değiştirildi. Değişiklikleriniz kaydedilmedi; güncel bilgileri kontrol edip tekrar kaydedin.",
      undefined,
      data,
    );
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, data?: Record<string, unknown>, fieldErrors?: FieldErrors) {
    super(409, code, message, fieldErrors, data);
  }
}

/** Postgres benzersizlik ihlali mi? (constraint adıyla) */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string; message?: string } | null;
  if (!err || err.code !== "23505") return false;
  if (!constraint) return true;
  return err.constraint === constraint || (err.message ?? "").includes(constraint);
}
