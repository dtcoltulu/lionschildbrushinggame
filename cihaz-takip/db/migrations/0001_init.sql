-- Koşuyolu Park Cihaz Takip – şema (0001)
-- Supabase SQL Editor'e tamamı yapıştırılıp çalıştırılabilir ya da `npm run db:migrate` ile uygulanır.
-- Tek işlem (transaction) içinde çalışır: hata olursa hiçbir değişiklik kalmaz.

begin;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Yönetilebilir listeler
-- name_key: Türkçe büyük/küçük harf ve aksan farkı olmadan karşılaştırma anahtarı
-- (uygulamadaki normalizeKey ile üretilir) → "Ünit 1" ile "unit 1" aynı kayıttır.
-- ---------------------------------------------------------------------------
create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  name_key text not null,
  sort_order int not null default 100,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_name_key_uq unique (name_key)
);

create table device_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  name_key text not null,
  code_prefix text not null check (code_prefix ~ '^[A-Z]{2,5}$'),
  code_digits int not null default 3 check (code_digits between 2 and 4),
  frequent boolean not null default false,
  sort_order int not null default 100,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_types_name_key_uq unique (name_key),
  constraint device_types_prefix_uq unique (code_prefix)
);

create table fault_causes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  name_key text not null,
  -- 'belirlenmedi' ve 'diger' sistem kayıtlarıdır (pasifleştirilemez)
  system_key text unique,
  sort_order int not null default 100,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fault_causes_name_key_uq unique (name_key)
);

create table service_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  name_key text not null,
  phone text,
  note text,
  sort_order int not null default 100,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_vendors_name_key_uq unique (name_key)
);

-- ---------------------------------------------------------------------------
-- Personel kartı (giriş hesabından AYRI kavram)
-- ---------------------------------------------------------------------------
create table staff (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  name_key text not null,
  job_role text not null check (job_role in (
    'dis_hekimi', 'uzman_dis_hekimi', 'klinik_muduru', 'asistan',
    'sekreter', 'muhasebe', 'destek', 'diger')),
  location_id uuid references locations(id),
  work_email text,
  note text,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_name_key_idx on staff (name_key);

-- Uygulamaya giriş hesabı. auth_user_id: Supabase Auth kullanıcısı (geliştirme modunda boş).
create table app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null,
  email_key text not null,
  display_name text not null check (length(btrim(display_name)) between 2 and 120),
  role text not null check (role in ('admin', 'staff')),
  staff_id uuid references staff(id),
  active boolean not null default true,
  last_login_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_email_key_uq unique (email_key)
);

-- ---------------------------------------------------------------------------
-- Cihazlar: her fiziksel cihaz ayrı kayıttır
-- ---------------------------------------------------------------------------
create table devices (
  id uuid primary key default gen_random_uuid(),
  inventory_code text not null check (inventory_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' and length(inventory_code) <= 20),
  name text not null check (length(btrim(name)) between 1 and 120),
  type_id uuid not null references device_types(id),
  brand text,
  model text,
  serial_number text,
  location_id uuid references locations(id),
  responsible_staff_id uuid references staff(id),
  notes text,
  lifecycle text not null default 'aktif' check (lifecycle in ('aktif', 'kullanim_disi', 'envanterden_cikarildi')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references app_users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id),
  constraint devices_inventory_code_uq unique (inventory_code)
);
create index devices_type_idx on devices (type_id);
create index devices_location_idx on devices (location_id);
create index devices_responsible_idx on devices (responsible_staff_id);

-- Biliniyorsa cihazın diğer kullanıcıları
create table device_users (
  device_id uuid not null references devices(id) on delete cascade,
  staff_id uuid not null references staff(id),
  primary key (device_id, staff_id)
);

-- ---------------------------------------------------------------------------
-- Arıza olayları: her yeni olay ayrı kayıt
-- Arızayı fark eden, son kullanan ve sorumluluğu doğrulanan kişi AYRI alanlardır.
-- ---------------------------------------------------------------------------
create table faults (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id),
  description text not null check (length(btrim(description)) between 1 and 2000),
  noticed_on date not null,
  noticed_by_staff_id uuid references staff(id),
  last_user_staff_id uuid references staff(id),
  location_id uuid references locations(id),
  cause_id uuid not null references fault_causes(id),
  cause_detail text,
  cause_verification text not null default 'on_degerlendirme'
    check (cause_verification in ('on_degerlendirme', 'servis_dogruladi', 'klinik_dogruladi')),
  -- Sorumluluk ataması isteğe bağlıdır; yapılırsa tespit açıklaması ve doğrulayan kişi zorunludur.
  responsible_staff_id uuid references staff(id),
  responsibility_evidence text,
  responsibility_verified_by_staff_id uuid references staff(id),
  status text not null default 'arizali' check (status in ('arizali', 'serviste', 'tamirden_geldi', 'cozuldu')),
  resolution_note text,
  -- closed_at boşsa arıza açıktır (cihaz kullanılabilir sayılmaz)
  closed_at timestamptz,
  deletion_requested_at timestamptz,
  deletion_requested_by uuid references app_users(id),
  deletion_request_reason text,
  -- Mantıksal silme: silinen arıza hiçbir sayıma/analize girmez, yönetici geri alabilir
  deleted_at timestamptz,
  deleted_by uuid references app_users(id),
  delete_reason text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references app_users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id),
  constraint faults_responsibility_chk check (
    responsible_staff_id is null
    or (responsibility_evidence is not null and length(btrim(responsibility_evidence)) > 0
        and responsibility_verified_by_staff_id is not null))
);
-- Aynı cihazda aynı anda yalnızca bir açık (silinmemiş) arıza olabilir → mükerrer kayıt veritabanı düzeyinde engellenir.
create unique index faults_one_open_per_device on faults (device_id) where closed_at is null and deleted_at is null;
create index faults_device_idx on faults (device_id);
create index faults_noticed_on_idx on faults (noticed_on);

-- ---------------------------------------------------------------------------
-- Servise gidişler: her satır BİR tamire gidiştir. Aynı satırı düzenlemek yeni gidiş sayılmaz.
-- ---------------------------------------------------------------------------
create table service_visits (
  id uuid primary key default gen_random_uuid(),
  fault_id uuid not null references faults(id) on delete cascade,
  vendor_id uuid references service_vendors(id),
  sent_on date,
  expected_return_on date,
  service_note text,
  returned boolean not null default false,
  returned_on date,
  work_done text,
  -- null = tutar bilinmiyor; 0 = ücretsiz tamir
  cost_amount numeric(12, 2) check (cost_amount is null or cost_amount >= 0),
  -- null = masraf tarihi eksik (hiçbir aya yazılmaz)
  cost_date date,
  receipt_ref text,
  outcome text check (outcome in ('kullanima_hazir', 'sorun_devam', 'denenmedi')),
  -- Yanlışlıkla "Serviste" seçildiyse geri alınır; iptal edilen gidiş sayılmaz
  canceled_at timestamptz,
  canceled_by uuid references app_users(id),
  -- clock_timestamp: aynı işlemde açılan gidişler de sıralanabilsin ("güncel gidiş" = en son açılan)
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references app_users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id),
  constraint service_visits_return_after_send_chk check (returned_on is null or sent_on is null or returned_on >= sent_on),
  constraint service_visits_outcome_chk check (
    (returned and outcome is not null) or (not returned and outcome is null and returned_on is null))
);
create index service_visits_fault_idx on service_visits (fault_id);
create index service_visits_cost_date_idx on service_visits (cost_date);
-- Bir arızanın aynı anda en fazla bir "serviste" gidişi olur
create unique index service_visits_one_active_per_fault on service_visits (fault_id) where not returned and canceled_at is null;

-- ---------------------------------------------------------------------------
-- İşlem geçmişi (kritik değişiklikler). Kayıtlar silinse de geçmiş satırları kalır.
-- ---------------------------------------------------------------------------
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_user_id uuid references app_users(id),
  actor_label text not null,
  entity text not null,
  entity_id uuid,
  device_id uuid,
  action text not null,
  summary text not null,
  changes jsonb
);
create index audit_log_entity_idx on audit_log (entity, entity_id);
create index audit_log_device_idx on audit_log (device_id);
create index audit_log_at_idx on audit_log (at desc);

-- ---------------------------------------------------------------------------
-- Güvenlik: tarayıcı veritabanına hiç bağlanmaz. Supabase'in otomatik veri API'si
-- (anon/authenticated) bu tablolara erişemesin diye RLS açık ve policy YOK.
-- Uygulama sunucusu tablo sahibi rolüyle bağlanır.
-- ---------------------------------------------------------------------------
alter table schema_migrations enable row level security;
alter table locations enable row level security;
alter table device_types enable row level security;
alter table fault_causes enable row level security;
alter table service_vendors enable row level security;
alter table staff enable row level security;
alter table app_users enable row level security;
alter table devices enable row level security;
alter table device_users enable row level security;
alter table faults enable row level security;
alter table service_visits enable row level security;
alter table audit_log enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end $$;

insert into schema_migrations (version) values ('0001') on conflict do nothing;

commit;
