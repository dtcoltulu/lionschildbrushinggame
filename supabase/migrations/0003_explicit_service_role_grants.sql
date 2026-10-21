-- Supabase, 30 Ekim 2026'dan itibaren "public" şemasında YENİ oluşturulan tablolara Data API yetkisini (grant)
-- kendiliğinden vermez. Bu uygulamanın sunucusu service_role anahtarıyla (supabase-js / PostgREST) eriştiği için yetki
-- burada açıkça verilir.
--
-- Mevcut (canlı) projede bu yetkiler zaten vardır; bu geçiş orada hiçbir şeyi değiştirmez ve istenirse tekrar çalıştırılabilir.
-- Asıl amacı: şemayı yeniden kurarken (yeni proje, önizleme dalı, `supabase db reset`) tabloların "permission denied" vermemesi.
--
-- anon ve authenticated rollerine yetki VERİLMEZ: RLS açık ve policy yok; ayrıca 0001'de bu rollerin yetkisi kaldırılmıştır.
-- Yeni tablo eklerken aynı geçişte: RLS aç, anon/authenticated yetkisini kaldır, service_role'e yetki ver (bkz. DEPLOYMENT.md).

grant select, insert, update, delete on public.sessions to service_role;
grant select, insert, update, delete on public.events   to service_role;

revoke all on public.sessions from anon, authenticated;
revoke all on public.events   from anon, authenticated;
