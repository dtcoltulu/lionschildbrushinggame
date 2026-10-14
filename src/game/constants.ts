/** Oyun ayarları tek yerde: süre/zorluk buradan ayarlanır. */
export const WORLD_W = 360;
export const WORLD_H = 520;

export const BRUSH_RADIUS = 20;
/** Bir "swipe" sayılması için gereken en az çizgi uzunluğu (dünya birimi). */
export const MIN_STROKE = 26;
/** Kesintisiz uzun bir hareket bu uzunluğa ulaşınca da swipe sayılır. */
export const MAX_STROKE = 80;
/** Bu değerden küçük hareketler titreme sayılır. */
export const JITTER = 1.2;

/** Bir plak lekesinin tamamen temizlenmesi için gereken swipe sayısı. */
export const SWIPES_PER_PATCH = 3;

export const HINT_AFTER_MS = 5500;
export const EASY_AFTER_MS = 11000;
export const PHASE_EASY_ALL_MS = 24000;

export const PHASE_TRANSITION_MS = 1400;
/**
 * Ağız açılma geçişi (diş aralarından iç yüzeye geçerken): yüz dönmez, çene aşağı iner ve ağız kocaman açılır.
 * Geçiş ilerlemesinin (0..1) `OPEN_FROM`–`OPEN_TO` aralığında çene iner; `OPEN_TO`'da sahne (lekeler) değişir.
 */
export const OPEN_TRANSITION_MS = 1500;
export const OPEN_FROM = 0.1;
export const OPEN_TO = 0.5;
/** Çene tam inince yeni lekelerin görünür olma süresi (geçiş ilerlemesinin oranı; ≈ 0,2 sn): lekeler birden çıkmaz, belirir. */
export const OPEN_APPEAR = 0.14;
export const START_DELAY_MS = 900;
/** Arka plandan dönüşte sürenin şişmemesi için tek karede en fazla sayılan süre. */
export const MAX_DT_MS = 100;

/** Aşama sayısı: dış yüzey, diş araları, iç yüzey, çiğneme, dil, diş ipi. */
export const TOTAL_PHASES = 6;
