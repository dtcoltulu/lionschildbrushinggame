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
/** Yüz dönme geçişi (dış yüzey/diş aralarından iç yüzeye geçerken): yarısında sahne değişir. */
export const TURN_TRANSITION_MS = 1900;
export const START_DELAY_MS = 900;
/** Arka plandan dönüşte sürenin şişmemesi için tek karede en fazla sayılan süre. */
export const MAX_DT_MS = 100;

/** Aşama sayısı: dış yüzey, diş araları, iç yüzey, çiğneme, dil, diş ipi. */
export const TOTAL_PHASES = 6;
