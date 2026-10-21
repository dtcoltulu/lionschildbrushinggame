-- Uygulama veritabanı rolü (Supabase SQL Editor'de, geçişlerden SONRA bir kez çalıştırılır).
-- Uygulama tablo sahibi `postgres` rolüyle DEĞİL, yalnızca veri okuma/yazma yetkisi olan ve satır güvenliğini (RLS)
-- atlayamayan bu rolle bağlanır. Rol RLS'i atlayabiliyorsa uygulama istekleri kendisi reddeder.
-- 'GÜÇLÜ-BİR-PAROLA' yerine parola yöneticisinde üretilmiş uzun bir parola yazın; bu dosyaya gerçek parola kaydetmeyin.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'satinalma_app') then
    create role satinalma_app login password 'GÜÇLÜ-BİR-PAROLA' nobypassrls;
  end if;
end $$;

alter role satinalma_app nobypassrls;
grant usage on schema public to satinalma_app;
grant select, insert, update, delete on all tables in schema public to satinalma_app;
grant usage, select on all sequences in schema public to satinalma_app;
grant execute on function app_clinic() to satinalma_app;
-- Sonraki geçişlerin açtığı tablolar da otomatik olarak bu role açılsın (geçişler postgres rolüyle uygulanır):
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to satinalma_app;
alter default privileges for role postgres in schema public grant usage, select on sequences to satinalma_app;
-- Uygulama rolü tablo silemez, şema değiştiremez:
revoke create on schema public from satinalma_app;
