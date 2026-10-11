-- 0002: "Sence yeterli ve etkin temizlendi mi?" sorusunun cevapları (anonim sayım).
--
-- İki yeni olay adı eklenir: self_check_yes / self_check_no (aşama numarası `phase` sütununda, 1..5).
-- Mevcut olaylar ve veriler DEĞİŞMEZ; yalnızca izin verilen ad listesi genişler.
-- Tek ifade olduğu için atomiktir: bir hata olursa hiçbir şey değişmez.
--
-- ÖNEMLİ SIRA: bu geçiş, yeni sürüm yayına alınmadan ÖNCE uygulanmalıdır (yeni istemci bu adlarla olay gönderir).
--
-- Geri alma (yalnızca self_check_* satırı yokken): aynı ifadeyi 0001'deki dokuz adlık listeyle yeniden çalıştırın.
alter table public.events
  drop constraint events_name_check,
  add constraint events_name_check check (name in (
    'landing_view', 'tutorial_started', 'tutorial_completed', 'tutorial_skipped',
    'game_started', 'phase_completed', 'game_completed', 'reward_screen_viewed', 'replay_started',
    'self_check_yes', 'self_check_no'
  ));
