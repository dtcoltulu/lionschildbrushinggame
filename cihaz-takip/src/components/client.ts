"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiError {
  ok: false;
  status: number;
  error: string;
  code?: string;
  fieldErrors: Record<string, string>;
  data: Record<string, unknown>;
}
export type ApiResult<T> = { ok: true; data: T } | ApiError;

/** Sunucu API çağrısı. Ağ hatasında da anlaşılır bir mesaj döner; girilen bilgiler formda kalır. */
export async function callApi<T = unknown>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return {
      ok: false, status: 0, fieldErrors: {}, data: {},
      error: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin; girdiğiniz bilgiler bu sayfada duruyor.",
    };
  }
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (res.ok) return { ok: true, data: json as T };
  const { error, code, fieldErrors, ...data } = json as { error?: string; code?: string; fieldErrors?: Record<string, string> };
  return {
    ok: false,
    status: res.status,
    error: error ?? `İşlem tamamlanamadı (HTTP ${res.status}).`,
    code,
    fieldErrors: fieldErrors ?? {},
    data,
  };
}

const DRAFT_PREFIX = "cihaz-takip:taslak:";
const DRAFT_TTL_MS = 3 * 24 * 3600 * 1000;

function readDraft<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; value: T };
    if (Date.now() - parsed.at > DRAFT_TTL_MS) {
      window.localStorage.removeItem(DRAFT_PREFIX + key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

/**
 * Kaydedilmemiş form taslağı: oturum düşse, sayfa yenilense ya da internet kopsa bile girilen bilgiler
 * bu cihazda (tarayıcıda) tutulur ve form tekrar açılınca geri yüklenir. Başarılı kayıtta silinir.
 * (Asıl veriler her zaman sunucudaki veritabanındadır; burası yalnızca taslak içindir.)
 */
export function useDraft<T extends object>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const loaded = useRef(false);
  const initialRef = useRef(initial);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const d = readDraft<T>(key);
    if (d && JSON.stringify(d) !== JSON.stringify(initialRef.current)) {
      // Taslak, ilk çizimden sonra geri yüklenir (sunucu/istemci HTML'i aynı kalsın diye).
      setValue({ ...initialRef.current, ...d });
      setRestored(true);
    }
  }, [key]);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      try {
        if (JSON.stringify(value) === JSON.stringify(initialRef.current)) window.localStorage.removeItem(DRAFT_PREFIX + key);
        else window.localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ at: Date.now(), value }));
      } catch {
        // Depolama kapalıysa (gizli sekme vb.) taslak tutulamaz; form yine çalışır.
      }
    }, 300);
    return () => clearTimeout(t);
  }, [key, value]);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(DRAFT_PREFIX + key);
    } catch {
      // yok say
    }
    setRestored(false);
  }, [key]);

  const discard = useCallback(() => {
    clear();
    setValue(initialRef.current);
  }, [clear]);

  const reset = useCallback((next: T) => {
    initialRef.current = next;
    setValue(next);
  }, []);

  return { value, setValue, restored, clear, discard, reset };
}

/** Çıkışta bu tarayıcıdaki tüm taslakları siler (paylaşılan klinik bilgisayarları için). */
export function clearAllDrafts() {
  try {
    for (const k of Object.keys(window.localStorage)) if (k.startsWith(DRAFT_PREFIX)) window.localStorage.removeItem(k);
  } catch {
    // yok say
  }
}
