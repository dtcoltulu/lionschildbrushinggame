-- Başlangıç listeleri (0002): ürün kategorileri ve oda/bölümler. Yönetim sonradan ekler, adını değiştirir, pasifleştirir.
-- name_key: Türkçe büyük/küçük harf ve aksan farkı olmadan karşılaştırma anahtarı (uygulamadaki normalizeKey ile aynı kural).

begin;

insert into categories (clinic_id, name, name_key, sort_order) values
  ('00000000-0000-4000-8000-000000000001', 'Eldiven ve koruyucular', 'eldiven ve koruyucular', 10),
  ('00000000-0000-4000-8000-000000000001', 'Restoratif', 'restoratif', 20),
  ('00000000-0000-4000-8000-000000000001', 'Endodonti', 'endodonti', 30),
  ('00000000-0000-4000-8000-000000000001', 'Ölçü', 'olcu', 40),
  ('00000000-0000-4000-8000-000000000001', 'Cerrahi', 'cerrahi', 50),
  ('00000000-0000-4000-8000-000000000001', 'İmplant sarfları', 'implant sarflari', 60),
  ('00000000-0000-4000-8000-000000000001', 'Sterilizasyon', 'sterilizasyon', 70),
  ('00000000-0000-4000-8000-000000000001', 'Tek kullanımlık ürünler', 'tek kullanimlik urunler', 80),
  ('00000000-0000-4000-8000-000000000001', 'Diğer', 'diger', 900)
on conflict do nothing;

insert into locations (clinic_id, name, name_key, sort_order) values
  ('00000000-0000-4000-8000-000000000001', 'Ünit 1', 'unit 1', 10),
  ('00000000-0000-4000-8000-000000000001', 'Ünit 2', 'unit 2', 20),
  ('00000000-0000-4000-8000-000000000001', 'Ünit 3', 'unit 3', 30),
  ('00000000-0000-4000-8000-000000000001', 'Cerrahi oda', 'cerrahi oda', 40),
  ('00000000-0000-4000-8000-000000000001', 'Sterilizasyon', 'sterilizasyon', 50),
  ('00000000-0000-4000-8000-000000000001', 'Röntgen', 'rontgen', 60),
  ('00000000-0000-4000-8000-000000000001', 'Depo', 'depo', 70),
  ('00000000-0000-4000-8000-000000000001', 'Banko / sekreterya', 'banko sekreterya', 80)
on conflict do nothing;

insert into schema_migrations (version) values ('0002') on conflict do nothing;

commit;
