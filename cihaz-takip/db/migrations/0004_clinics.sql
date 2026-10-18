-- DENTINEL – birden fazla klinik (0004, GEÇİŞ AŞAMASI)
--
-- Her kliniğin verisi aynı tablolarda, clinic_id sütunuyla ayrılır. Ayrım VERİTABANINDA uygulanır (RLS):
-- uygulama her işlemin başında `app.clinic_id` ayarını verir; bir klinik başka kliniğin satırını
-- göremez, değiştiremez, ona satır ekleyemez. Uygulama rolleri RLS'i atlayamaz (nobypassrls).
--
-- Var olan bütün kayıtlar ilk kliniğe (Koşuyolu Park) bağlanır. Mevcut yöneticiler "genel yönetici"
-- olur: klinik ekler, her kliniğe girebilir.
--
-- Bu aşamada `app.clinic_id` verilmeyen istekler ilk kliniği görür; böylece yeni sürüm yayına çıkana
-- kadar eski sürüm çalışmaya devam eder. 0005 bu geçiş kolaylığını kaldırır (ayar yoksa hiçbir satır).

begin;

create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  name_key text not null,
  active boolean not null default true,
  sort_order int not null default 100,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinics_name_key_uq unique (name_key)
);

insert into clinics (id, name, name_key, sort_order)
values ('00000000-0000-4000-8000-000000000001', 'Koşuyolu Park', 'kosuyolu park', 10);

-- Klinik verisi tutan tablolar: clinic_id + klinik ayrımı politikası.
do $$
declare
  t text;
  cur constant text := $e$coalesce(nullif(current_setting('app.clinic_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid)$e$;
begin
  foreach t in array array['locations', 'device_types', 'fault_causes', 'service_vendors', 'staff', 'staff_locations',
                           'devices', 'device_users', 'faults', 'service_visits', 'audit_log'] loop
    execute format('alter table %I add column clinic_id uuid references clinics(id)', t);
    execute format('update %I set clinic_id = %L', t, '00000000-0000-4000-8000-000000000001');
    -- İşlem geçmişinde klinikten bağımsız (sistem) satırlar olabilir.
    if t <> 'audit_log' then
      execute format('alter table %I alter column clinic_id set not null', t);
    end if;
    execute format('alter table %I alter column clinic_id set default %s', t, cur);
    execute format('create index %I on %I (clinic_id)', t || '_clinic_idx', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy klinik_ayrimi on %I using (clinic_id = %s) with check (clinic_id = %s)', t, cur, cur);
  end loop;
end $$;

-- Adlar ve envanter kodları artık klinik içinde benzersiz (iki klinikte de AER-001 olabilir).
alter table locations drop constraint locations_name_key_uq,
  add constraint locations_name_key_uq unique (clinic_id, name_key);
alter table device_types drop constraint device_types_name_key_uq,
  add constraint device_types_name_key_uq unique (clinic_id, name_key);
alter table device_types drop constraint device_types_prefix_uq,
  add constraint device_types_prefix_uq unique (clinic_id, code_prefix);
alter table fault_causes drop constraint fault_causes_name_key_uq,
  add constraint fault_causes_name_key_uq unique (clinic_id, name_key);
alter table fault_causes drop constraint fault_causes_system_key_key,
  add constraint fault_causes_system_key_uq unique (clinic_id, system_key);
alter table service_vendors drop constraint service_vendors_name_key_uq,
  add constraint service_vendors_name_key_uq unique (clinic_id, name_key);
alter table devices drop constraint devices_inventory_code_uq,
  add constraint devices_inventory_code_uq unique (clinic_id, inventory_code);

-- Giriş hesapları:
--   clinic_id boş  → genel yönetici (tüm klinikler),
--   shared = true  → kliniğin ortak girişi (personel şifresi / yönetici şifresi; klinik başına birer tane),
--   diğerleri      → klinikteki kişisel hesap.
-- sessions_valid_after: şifre değişince bu andan önce açılmış oturumlar geçersiz sayılır.
alter table app_users add column clinic_id uuid references clinics(id);
alter table app_users add column shared boolean not null default false;
alter table app_users add column sessions_valid_after timestamptz;
update app_users set clinic_id = '00000000-0000-4000-8000-000000000001' where role <> 'admin';
update app_users set display_name = 'Genel yönetici' where role = 'admin' and display_name = 'Klinik yöneticisi';
alter table app_users add constraint app_users_scope_chk check (clinic_id is not null or (role = 'admin' and not shared));
create unique index app_users_shared_uq on app_users (clinic_id, role) where shared;
create index app_users_clinic_idx on app_users (clinic_id);
-- Giriş sırasında (henüz klinik seçilmemişken) hesap bulunabilmeli; klinik içinde yalnızca o kliniğin
-- hesapları ve genel yöneticiler görünür.
create policy klinik_ayrimi on app_users
  using (clinic_id is null or clinic_id = coalesce(nullif(current_setting('app.clinic_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid))
  with check (clinic_id is null or clinic_id = coalesce(nullif(current_setting('app.clinic_id', true), '')::uuid, '00000000-0000-4000-8000-000000000001'::uuid));

-- Klinik listesi giriş ekranında gösterilir; değişiklikleri yalnızca genel yönetici yapar (uygulamada denetlenir).
alter table clinics enable row level security;
create policy klinikler on clinics using (true) with check (true);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table clinics from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table clinics from authenticated';
  end if;
  -- Uygulama rolleri (Supabase kurulumu) satır güvenliğini atlayamaz.
  if exists (select 1 from pg_roles where rolname = 'cihaz_app') then
    execute 'alter role cihaz_app nobypassrls';
  end if;
  if exists (select 1 from pg_roles where rolname = 'cihaz_onizleme') then
    execute 'alter role cihaz_onizleme nobypassrls';
  end if;
end $$;

insert into schema_migrations (version) values ('0004') on conflict do nothing;

commit;
