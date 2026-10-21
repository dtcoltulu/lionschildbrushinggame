-- Koşuyolu Park Satın Alma – şema (0001)
-- Supabase SQL Editor'e tamamı yapıştırılıp çalıştırılabilir ya da `npm run db:migrate` ile uygulanır.
-- Tek işlem (transaction) içinde çalışır: hata olursa hiçbir değişiklik kalmaz.
--
-- Temel ilkeler:
--  * Para: numeric(14,2), birim fiyat: numeric(14,4), miktar: numeric(12,3). Kayan nokta (float) kullanılmaz.
--  * Satır tutarları (KDV hariç net ve KDV) HESAPLANAN sütunlardır: uygulama ile veritabanı aynı formülü kullanır.
--  * Sipariş, teslimat, uyuşmazlık (sorun), fatura ve ödeme durumları AYRI tablolarda/alanlarda tutulur.
--  * Finansal kayıtlar silinmez: gerekçeli iptal (canceled_at + cancel_reason) ile bakiyeden çıkar.
--  * Her tabloda clinic_id vardır; satır güvenliği (RLS) bir işlemin yalnızca `app.clinic_id` kliniğini görmesini sağlar.
--    İlk sürüm tek kliniktir, veri yapısı başka kliniklere hazırdır.

begin;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- İşlemin klinik kapsamı (uygulama her işlemin başında ayarlar; ayar yoksa klinik verisi görünmez).
create or replace function app_clinic() returns uuid language sql stable as $$
  select nullif(current_setting('app.clinic_id', true), '')::uuid
$$;

create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  short_name text not null,
  active boolean not null default true,
  -- Örnek/deneme verisi içeren veritabanı (yalnızca geliştirme/önizleme): ekranda kırmızı şerit gösterilir.
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
insert into clinics (id, name, short_name)
values ('00000000-0000-4000-8000-000000000001', 'Özel Koşuyolu Park Ağız ve Diş Sağlığı Polikliniği', 'Koşuyolu Park');

-- Klinik içi sıra numaraları (sipariş no, talep no …). Satır kilidiyle artırılır: eşzamanlı işlemde tekrar etmez.
create table counters (
  clinic_id uuid not null default app_clinic() references clinics(id),
  name text not null,
  year int not null,
  value int not null default 0,
  primary key (clinic_id, name, year)
);

-- ---------------------------------------------------------------------------
-- Kullanıcılar ve listeler
-- ---------------------------------------------------------------------------
create table app_users (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  auth_user_id uuid unique,
  email text not null,
  email_key text not null,
  display_name text not null check (length(btrim(display_name)) between 2 and 120),
  -- Birden fazla rol atanabilir.
  roles text[] not null check (cardinality(roles) between 1 and 4
    and roles <@ array['asistan', 'satinalma', 'teslimat', 'finans']::text[]),
  active boolean not null default true,
  last_login_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_email_key_uq unique (email_key)
);
create index app_users_clinic_idx on app_users (clinic_id);

-- Oda / bölüm (talebin kullanılacağı yer)
create table locations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  name text not null check (length(btrim(name)) between 1 and 80),
  name_key text not null,
  sort_order int not null default 100,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_name_key_uq unique (clinic_id, name_key)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  name text not null check (length(btrim(name)) between 1 and 80),
  name_key text not null,
  sort_order int not null default 100,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_key_uq unique (clinic_id, name_key)
);

-- ---------------------------------------------------------------------------
-- Dosyalar (fotoğraf, fatura, dekont). İçerik ya veritabanında (file_blobs) ya da Supabase Storage'da.
-- ---------------------------------------------------------------------------
create table files (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  entity text not null check (entity in ('request', 'variant', 'receipt', 'issue', 'invoice', 'payment', 'adjustment')),
  entity_id uuid not null,
  filename text not null,
  mime text not null,
  size_bytes int not null check (size_bytes > 0),
  sha256 text not null,
  storage text not null check (storage in ('db', 'supabase')),
  storage_key text,
  uploaded_by uuid not null references app_users(id),
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references app_users(id)
);
create index files_entity_idx on files (entity, entity_id);

create table file_blobs (
  file_id uuid primary key references files(id),
  clinic_id uuid not null default app_clinic() references clinics(id),
  data bytea not null
);

-- ---------------------------------------------------------------------------
-- Tedarikçiler
-- ---------------------------------------------------------------------------
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  name text not null check (length(btrim(name)) between 2 and 160),
  name_key text not null,
  contact_name text,
  phone text,
  email text,
  payment_terms text,
  -- Varsayılan vade (gün): fatura girerken vade tarihi önerisi
  due_days int check (due_days is null or due_days between 0 and 365),
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  notes text,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_key_uq unique (clinic_id, name_key)
);

-- ---------------------------------------------------------------------------
-- Ürün kataloğu: ürün (genel ad) → varyant (marka, tip, ölçü, paket). Farklı marka/ölçü = ayrı varyant.
-- ---------------------------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  category_id uuid not null references categories(id),
  name text not null check (length(btrim(name)) between 2 and 160),
  name_key text not null,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_key_uq unique (clinic_id, name_key)
);

create table variants (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  product_id uuid not null references products(id),
  brand text,
  model text, -- tip / model / seri
  attributes text, -- ölçü, boyut, renk gibi ayırt edici özellikler
  code text, -- ürün kodu / barkod
  code_key text,
  order_unit text not null, -- sipariş birimi: kutu, paket, adet, şişe …
  base_unit text not null, -- temel birim: adet, ml, gr …
  pack_size numeric(12, 3) not null check (pack_size > 0), -- 1 sipariş birimi = pack_size temel birim
  default_vat_rate numeric(5, 2) not null default 20 check (default_vat_rate between 0 and 100),
  track_expiry boolean not null default false,
  track_lot boolean not null default false,
  -- Teslimatta kabul için gereken en az kalan raf ömrü (gün). Altındaki ürün yönetim incelemesine düşer.
  min_shelf_life_days int check (min_shelf_life_days is null or min_shelf_life_days between 0 and 3650),
  image_file_id uuid references files(id),
  -- Aynı varyantın farklı yazımla tekrar açılmasını önleyen anahtar (ürün + marka + tip + özellik + paket)
  variant_key text not null,
  search_key text not null,
  active boolean not null default true,
  version int not null default 1,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variants_key_uq unique (clinic_id, variant_key),
  constraint variants_unit_chk check (order_unit <> base_unit or pack_size = 1),
  constraint variants_track_chk check (min_shelf_life_days is null or track_expiry)
);
create unique index variants_code_uq on variants (clinic_id, code_key) where code_key is not null;
create index variants_product_idx on variants (product_id);

-- Tercih edilen tedarikçiler (sıra: 1 = ilk tercih)
create table variant_suppliers (
  clinic_id uuid not null default app_clinic() references clinics(id),
  variant_id uuid not null references variants(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  preference int not null default 1 check (preference between 1 and 9),
  supplier_code text,
  primary key (variant_id, supplier_id)
);

-- Elle girilen teklifler. Fiyat her zaman KDV HARİÇ ve sipariş birimi başına saklanır (karşılaştırma aynı temelde).
create table price_quotes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  variant_id uuid not null references variants(id),
  supplier_id uuid not null references suppliers(id),
  quoted_on date not null,
  valid_until date,
  currency text not null check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  unit_price numeric(14, 4) not null check (unit_price >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  vat_rate numeric(5, 2) not null check (vat_rate between 0 and 100),
  min_qty numeric(12, 3),
  note text,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  canceled_at timestamptz,
  canceled_by uuid references app_users(id)
);
create index price_quotes_variant_idx on price_quotes (variant_id);

-- ---------------------------------------------------------------------------
-- Malzeme talepleri
-- ---------------------------------------------------------------------------
create table requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  request_no text not null,
  variant_id uuid references variants(id),
  -- Katalogda olmayan ürün için geçici tanım; yönetim mevcut ürünle eşleştirir veya yeni ürün açar.
  temp_product_text text,
  stock_state text not null check (stock_state in ('azaldi', 'bitti')),
  qty numeric(12, 3) not null check (qty > 0),
  -- 'siparis' = varyantın sipariş birimi (kutu), 'temel' = temel birim (adet). Geçici talepte eşleştirmeye kadar boş.
  unit_kind text check (unit_kind in ('siparis', 'temel')),
  unit_label text not null,
  -- İsteğe bağlı, talep edenin bildirdiği kalan miktar (sayım DEĞİLDİR; kesin stok olarak gösterilmez).
  remaining_qty numeric(12, 3) check (remaining_qty is null or remaining_qty >= 0),
  needed_by date,
  urgency text not null default 'normal' check (urgency in ('normal', 'acil', 'cok_acil')),
  location_id uuid references locations(id),
  note text,
  -- Aynı ürün için açık talep/sipariş varken yeni talep açılırsa gerekçe zorunlu.
  extra_need_reason text,
  status text not null default 'beklemede' check (status in ('beklemede', 'onaylandi', 'reddedildi', 'iptal')),
  decided_by uuid references app_users(id),
  decided_at timestamptz,
  decision_note text,
  idempotency_key uuid,
  requested_by uuid not null references app_users(id),
  requested_at timestamptz not null default now(),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  constraint requests_no_uq unique (clinic_id, request_no),
  constraint requests_idem_uq unique (clinic_id, requested_by, idempotency_key),
  constraint requests_product_chk check (variant_id is not null or temp_product_text is not null),
  constraint requests_unit_chk check (variant_id is null or unit_kind is not null),
  constraint requests_reject_chk check (status <> 'reddedildi' or decision_note is not null)
);
create index requests_variant_idx on requests (variant_id);
create index requests_status_idx on requests (status);

-- ---------------------------------------------------------------------------
-- Satın alma siparişleri (her sipariş tek tedarikçiye aittir)
-- ---------------------------------------------------------------------------
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  order_no text not null,
  supplier_id uuid not null references suppliers(id),
  currency text not null check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  -- Yalnızca siparişin yaşam döngüsü. Teslimat, sorun, fatura, ödeme durumları ayrı hesaplanır.
  status text not null default 'taslak' check (status in ('taslak', 'verildi', 'kapandi', 'iptal')),
  expected_on date,
  receiver_user_id uuid references app_users(id),
  note text,
  supplier_ref text,
  shipping_amount numeric(14, 2) not null default 0 check (shipping_amount >= 0),
  shipping_vat_rate numeric(5, 2) not null default 20 check (shipping_vat_rate between 0 and 100),
  placed_at timestamptz,
  placed_by uuid references app_users(id),
  placed_channel text check (placed_channel in ('telefon', 'whatsapp', 'eposta', 'web', 'yuz_yuze', 'diger')),
  closed_at timestamptz,
  closed_by uuid references app_users(id),
  close_note text,
  canceled_at timestamptz,
  canceled_by uuid references app_users(id),
  cancel_reason text,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references app_users(id),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  constraint purchase_orders_no_uq unique (clinic_id, order_no),
  constraint purchase_orders_placed_chk check (status not in ('verildi', 'kapandi') or (placed_at is not null and placed_by is not null and placed_channel is not null)),
  constraint purchase_orders_closed_chk check (status <> 'kapandi' or closed_at is not null),
  constraint purchase_orders_cancel_chk check (status <> 'iptal' or (canceled_at is not null and length(btrim(coalesce(cancel_reason, ''))) > 0))
);
create index purchase_orders_supplier_idx on purchase_orders (supplier_id);
create index purchase_orders_receiver_idx on purchase_orders (receiver_user_id);

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  order_id uuid not null references purchase_orders(id) on delete cascade,
  line_no int not null,
  variant_id uuid not null references variants(id),
  -- Sipariş birimiyle (ör. kutu). Birim ve paket içeriği sipariş anındaki hâliyle saklanır.
  qty numeric(12, 3) not null check (qty > 0),
  unit_label text not null,
  pack_size numeric(12, 3) not null check (pack_size > 0),
  unit_price numeric(14, 4) not null check (unit_price >= 0), -- KDV hariç, sipariş birimi başına
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  vat_rate numeric(5, 2) not null check (vat_rate between 0 and 100),
  net_amount numeric(14, 2) generated always as (round(qty * unit_price * (100 - discount_pct) / 100, 2)) stored,
  vat_amount numeric(14, 2) generated always as (round(round(qty * unit_price * (100 - discount_pct) / 100, 2) * vat_rate / 100, 2)) stored,
  -- Yönetimin gerekçeyle iptal ettiği kalan miktar (teslim alınmayacak).
  canceled_qty numeric(12, 3) not null default 0 check (canceled_qty >= 0 and canceled_qty <= qty),
  note text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_lines_no_uq unique (order_id, line_no)
);
create index order_lines_variant_idx on order_lines (variant_id);

-- Talep ↔ sipariş kalemi bağlantısı. Birden fazla talep tek kalemde birleşebilir; bir talep birden fazla
-- kaleme/tedarikçiye bölünebilir. Miktar temel birimdedir (kutu/adet farkı karışmasın).
create table request_allocations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  request_id uuid not null references requests(id),
  order_line_id uuid not null references order_lines(id) on delete cascade,
  qty_base numeric(14, 3) not null check (qty_base > 0),
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  constraint request_allocations_uq unique (request_id, order_line_id)
);
create index request_allocations_line_idx on request_allocations (order_line_id);

-- ---------------------------------------------------------------------------
-- Teslimat kontrolü. "Ürün geldi" siparişi otomatik tamamlamaz; her kalem ayrı kontrol edilir.
-- Bir siparişte aynı anda en fazla bir açık (taslak) teslimat kontrolü olur: iki kişi aynı teslimatı
-- açarsa aynı kaydı görür; kaydetme tek sefer yapılır (sürüm kontrolü) → miktarlar iki kez işlenmez.
-- ---------------------------------------------------------------------------
create table receipts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  receipt_no text not null,
  order_id uuid not null references purchase_orders(id),
  status text not null default 'taslak' check (status in ('taslak', 'kaydedildi', 'iptal')),
  received_on date not null,
  delivery_note_no text, -- irsaliye no
  note text,
  started_by uuid not null references app_users(id),
  started_at timestamptz not null default now(),
  posted_by uuid references app_users(id),
  posted_at timestamptz,
  canceled_by uuid references app_users(id),
  canceled_at timestamptz,
  cancel_reason text,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  constraint receipts_no_uq unique (clinic_id, receipt_no),
  constraint receipts_posted_chk check (status = 'taslak' or posted_at is not null or canceled_at is not null),
  constraint receipts_cancel_chk check (status <> 'iptal' or length(btrim(coalesce(cancel_reason, ''))) > 0)
);
create unique index receipts_one_draft_per_order on receipts (order_id) where status = 'taslak';
create index receipts_order_idx on receipts (order_id);

create table receipt_lines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  receipt_id uuid not null references receipts(id) on delete cascade,
  -- Boş: sipariş dışı ürün
  order_line_id uuid references order_lines(id),
  -- Gerçekte gelen ürün (farklı marka kabul edilse bile sipariş kalemi değişmez)
  received_variant_id uuid references variants(id),
  received_desc text,
  -- Fiziksel gelen = kabul + ret + yönetim incelemesinde bekleyen
  qty_physical numeric(12, 3) not null check (qty_physical > 0),
  qty_accepted numeric(12, 3) not null default 0 check (qty_accepted >= 0),
  qty_rejected numeric(12, 3) not null default 0 check (qty_rejected >= 0),
  qty_held numeric(12, 3) not null default 0 check (qty_held >= 0),
  check_date date not null,
  lot_no text,
  expiry_date date,
  chk_product boolean not null default true,
  chk_variant boolean not null default true,
  chk_package boolean not null default true,
  -- Ret/inceleme varsa sorun türü ve açıklaması (kayıtta delivery_issues satırına dönüşür)
  issue_type text check (issue_type in ('eksik', 'yanlis_urun', 'farkli_marka', 'hasarli', 'skt_gecmis', 'kisa_miat', 'fazla', 'lot_eksik')),
  issue_note text,
  note text,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receipt_lines_sum_chk check (qty_accepted + qty_rejected + qty_held = qty_physical),
  -- Son kullanma tarihi geçmiş ürün kabul edilemez (incelemeye de alınamaz; yalnızca ret).
  constraint receipt_lines_expired_chk check (expiry_date is null or expiry_date >= check_date or (qty_accepted = 0 and qty_held = 0)),
  -- Sipariş dışı ürün doğrudan kabul edilemez (yönetim kararıyla siparişe eklenir).
  constraint receipt_lines_unordered_chk check (order_line_id is not null or qty_accepted = 0),
  constraint receipt_lines_what_chk check (order_line_id is not null or received_variant_id is not null or received_desc is not null)
);
create index receipt_lines_receipt_idx on receipt_lines (receipt_id);
create index receipt_lines_order_line_idx on receipt_lines (order_line_id);

-- Teslimat sorunları (uyuşmazlıklar). Sorunun durumu sipariş durumundan ayrıdır.
create table delivery_issues (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  issue_no text not null,
  order_id uuid not null references purchase_orders(id),
  order_line_id uuid references order_lines(id),
  receipt_id uuid references receipts(id),
  receipt_line_id uuid references receipt_lines(id) on delete set null,
  type text not null check (type in ('eksik', 'yanlis_urun', 'farkli_marka', 'hasarli', 'skt_gecmis', 'kisa_miat', 'fazla', 'lot_eksik')),
  qty numeric(12, 3) check (qty is null or qty > 0),
  description text,
  action text check (action in ('eksik_bekleniyor', 'degisim', 'iade', 'fiyat_duzeltmesi', 'alternatif_kabul', 'kabul', 'iptal')),
  status text not null default 'acik' check (status in ('acik', 'cozuldu')),
  -- İade / değişimde ürünün tedarikçiye geri verildiği gün
  returned_on date,
  resolution_note text,
  resolved_by uuid references app_users(id),
  resolved_at timestamptz,
  reported_by uuid not null references app_users(id),
  reported_at timestamptz not null default now(),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  constraint delivery_issues_no_uq unique (clinic_id, issue_no),
  constraint delivery_issues_resolved_chk check (status = 'acik' or (action is not null and resolved_at is not null and resolved_by is not null))
);
create index delivery_issues_order_idx on delivery_issues (order_id);
create index delivery_issues_status_idx on delivery_issues (status);

-- ---------------------------------------------------------------------------
-- Faturalar. Sipariş vermek borç yaratmaz; borç faturayla (ve açılış bakiyesiyle) oluşur.
-- Fatura kalemleri kayıttan sonra değiştirilmez: hatalı fatura gerekçeyle iptal edilip yeniden girilir.
-- ---------------------------------------------------------------------------
create table invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  supplier_id uuid not null references suppliers(id),
  kind text not null default 'fatura' check (kind in ('fatura', 'acilis')),
  invoice_no text,
  -- Tekrar kaydı önlemek için normalleştirilmiş numara (büyük harf, yalnız harf/rakam)
  invoice_no_key text,
  invoice_date date not null,
  due_date date,
  currency text not null check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  shipping_amount numeric(14, 2) not null default 0 check (shipping_amount >= 0),
  shipping_vat_rate numeric(5, 2) not null default 20 check (shipping_vat_rate between 0 and 100),
  total_net numeric(14, 2) not null default 0,
  total_vat numeric(14, 2) not null default 0,
  total numeric(14, 2) not null check (total >= 0),
  -- Kağıt/e-faturada yazan genel toplam (hesaplanan toplamla karşılaştırılır)
  declared_total numeric(14, 2),
  -- TL karşılığı için kullanılan kur (yalnız döviz faturalarında, isteğe bağlı): 1 birim döviz = fx_rate TL
  fx_rate numeric(14, 6) check (fx_rate is null or fx_rate > 0),
  fx_date date,
  fx_source text,
  description text,
  note text,
  review_status text not null default 'yok' check (review_status in ('yok', 'inceleme_bekliyor', 'onaylandi', 'itiraz')),
  review_note text,
  reviewed_by uuid references app_users(id),
  reviewed_at timestamptz,
  idempotency_key uuid,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version int not null default 1,
  canceled_at timestamptz,
  canceled_by uuid references app_users(id),
  cancel_reason text,
  constraint invoices_no_chk check (kind <> 'fatura' or (invoice_no is not null and invoice_no_key is not null)),
  constraint invoices_due_chk check (due_date is null or due_date >= invoice_date),
  constraint invoices_fx_chk check ((currency = 'TRY' and fx_rate is null) or currency <> 'TRY'),
  constraint invoices_fx_full_chk check (fx_rate is null or (fx_date is not null and length(btrim(coalesce(fx_source, ''))) > 0)),
  constraint invoices_cancel_chk check (canceled_at is null or length(btrim(coalesce(cancel_reason, ''))) > 0),
  constraint invoices_idem_uq unique (clinic_id, idempotency_key)
);
-- Aynı tedarikçinin aynı fatura numarası iki kez kaydedilemez (iptal edilenler hariç).
create unique index invoices_no_uq on invoices (clinic_id, supplier_id, invoice_no_key) where canceled_at is null and kind = 'fatura';
-- Tedarikçi başına para birimi başına tek açılış bakiyesi
create unique index invoices_opening_uq on invoices (clinic_id, supplier_id, currency) where canceled_at is null and kind = 'acilis';
create index invoices_supplier_idx on invoices (supplier_id);
create index invoices_date_idx on invoices (invoice_date);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  invoice_id uuid not null references invoices(id) on delete cascade,
  line_no int not null,
  order_line_id uuid references order_lines(id),
  variant_id uuid references variants(id),
  description text,
  qty numeric(12, 3) not null check (qty > 0),
  unit_label text not null,
  pack_size numeric(12, 3) not null default 1 check (pack_size > 0),
  unit_price numeric(14, 4) not null check (unit_price >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  vat_rate numeric(5, 2) not null check (vat_rate between 0 and 100),
  net_amount numeric(14, 2) generated always as (round(qty * unit_price * (100 - discount_pct) / 100, 2)) stored,
  vat_amount numeric(14, 2) generated always as (round(round(qty * unit_price * (100 - discount_pct) / 100, 2) * vat_rate / 100, 2)) stored,
  constraint invoice_lines_no_uq unique (invoice_id, line_no),
  constraint invoice_lines_what_chk check (variant_id is not null or description is not null)
);
create index invoice_lines_order_line_idx on invoice_lines (order_line_id);
create index invoice_lines_variant_idx on invoice_lines (variant_id);

create table invoice_receipts (
  clinic_id uuid not null default app_clinic() references clinics(id),
  invoice_id uuid not null references invoices(id) on delete cascade,
  receipt_id uuid not null references receipts(id),
  primary key (invoice_id, receipt_id)
);

-- ---------------------------------------------------------------------------
-- Ödemeler ve fatura dağıtımları. Faturaya dağıtılmayan kısım "avans" olarak ayrı izlenir.
-- ---------------------------------------------------------------------------
create table payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  payment_no text not null,
  supplier_id uuid not null references suppliers(id),
  paid_on date not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  method text not null check (method in ('havale_eft', 'nakit', 'kredi_karti', 'cek', 'senet', 'mahsup', 'diger')),
  reference text,
  note text,
  fx_rate numeric(14, 6) check (fx_rate is null or fx_rate > 0),
  fx_date date,
  fx_source text,
  idempotency_key uuid,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  version int not null default 1,
  canceled_at timestamptz,
  canceled_by uuid references app_users(id),
  cancel_reason text,
  constraint payments_no_uq unique (clinic_id, payment_no),
  constraint payments_idem_uq unique (clinic_id, idempotency_key),
  constraint payments_fx_chk check ((currency = 'TRY' and fx_rate is null) or currency <> 'TRY'),
  constraint payments_fx_full_chk check (fx_rate is null or (fx_date is not null and length(btrim(coalesce(fx_source, ''))) > 0)),
  constraint payments_cancel_chk check (canceled_at is null or length(btrim(coalesce(cancel_reason, ''))) > 0)
);
create index payments_supplier_idx on payments (supplier_id);
create index payments_date_idx on payments (paid_on);

create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  payment_id uuid not null references payments(id),
  invoice_id uuid not null references invoices(id),
  amount numeric(14, 2) not null check (amount > 0),
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references app_users(id),
  release_reason text
);
create unique index payment_allocations_active_uq on payment_allocations (payment_id, invoice_id) where released_at is null;
create index payment_allocations_invoice_idx on payment_allocations (invoice_id);

-- ---------------------------------------------------------------------------
-- Finansal düzeltmeler (iade faturası, fiyat farkı, iskonto, kur farkı). Bakiyeyi yalnızca ONAYLANINCA etkiler.
-- Fiziksel iade tek başına borç düşürmez: borç ancak buradaki onaylı düzeltme belgesiyle azalır.
-- ---------------------------------------------------------------------------
create table financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default app_clinic() references clinics(id),
  adjustment_no text not null,
  supplier_id uuid not null references suppliers(id),
  adj_date date not null,
  currency text not null check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  type text not null check (type in ('iade_faturasi', 'fiyat_farki', 'iskonto', 'kur_farki', 'diger')),
  direction text not null check (direction in ('borc_azaltir', 'borc_artirir')),
  net_amount numeric(14, 2) not null check (net_amount >= 0),
  vat_amount numeric(14, 2) not null default 0 check (vat_amount >= 0),
  total_amount numeric(14, 2) generated always as (net_amount + vat_amount) stored,
  document_no text,
  description text not null check (length(btrim(description)) > 0),
  invoice_id uuid references invoices(id),
  issue_id uuid references delivery_issues(id),
  fx_rate numeric(14, 6) check (fx_rate is null or fx_rate > 0),
  fx_date date,
  fx_source text,
  status text not null default 'onay_bekliyor' check (status in ('onay_bekliyor', 'onaylandi', 'iptal')),
  approved_by uuid references app_users(id),
  approved_at timestamptz,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  version int not null default 1,
  canceled_at timestamptz,
  canceled_by uuid references app_users(id),
  cancel_reason text,
  constraint financial_adjustments_no_uq unique (clinic_id, adjustment_no),
  constraint financial_adjustments_amount_chk check (net_amount + vat_amount > 0),
  constraint financial_adjustments_approved_chk check (status <> 'onaylandi' or (approved_by is not null and approved_at is not null)),
  constraint financial_adjustments_cancel_chk check (status <> 'iptal' or length(btrim(coalesce(cancel_reason, ''))) > 0)
);
create index financial_adjustments_supplier_idx on financial_adjustments (supplier_id);

-- Güvenlik ağı: ödeme dağıtımı ödeme tutarını ve faturanın kalanını aşamaz; tedarikçi ve para birimi aynı olmalı.
-- (Servis bunu kullanıcıya anlaşılır mesajla önceden kontrol eder; bu tetikleyici tutarlılığı veritabanında garanti eder.)
create or replace function check_payment_allocation() returns trigger language plpgsql as $$
declare
  p record;
  i record;
  used numeric;
  cap numeric;
begin
  if new.released_at is not null then
    return new;
  end if;
  select supplier_id, currency, amount, canceled_at into p from payments where id = new.payment_id;
  select supplier_id, currency, total, canceled_at into i from invoices where id = new.invoice_id;
  if p.canceled_at is not null or i.canceled_at is not null then
    raise exception 'İptal edilmiş ödeme veya faturaya dağıtım yapılamaz.' using errcode = 'P0001';
  end if;
  if p.supplier_id <> i.supplier_id or p.currency <> i.currency then
    raise exception 'Ödeme ve fatura aynı tedarikçiye ve para birimine ait olmalı.' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into used from payment_allocations where payment_id = new.payment_id and released_at is null and id <> new.id;
  if used + new.amount > p.amount then
    raise exception 'Dağıtım ödeme tutarını aşıyor.' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into used from payment_allocations where invoice_id = new.invoice_id and released_at is null and id <> new.id;
  cap := i.total + coalesce((select sum(case when direction = 'borc_artirir' then total_amount else -total_amount end)
                               from financial_adjustments where invoice_id = new.invoice_id and status = 'onaylandi'), 0);
  if used + new.amount > cap then
    raise exception 'Dağıtım faturanın kalan tutarını aşıyor.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger payment_allocations_check before insert or update on payment_allocations
  for each row execute function check_payment_allocation();

-- ---------------------------------------------------------------------------
-- İşlem geçmişi: kim, ne zaman, hangi kayıtta, neyi neyden neye değiştirdi. Değişiklikle aynı işlemde yazılır.
-- ---------------------------------------------------------------------------
create table audit_log (
  id bigserial primary key,
  clinic_id uuid default app_clinic() references clinics(id),
  at timestamptz not null default now(),
  actor_user_id uuid references app_users(id),
  actor_label text not null,
  entity text not null,
  entity_id uuid,
  order_id uuid,
  supplier_id uuid,
  action text not null,
  summary text not null,
  changes jsonb,
  -- 'finans': yalnızca finans rolüne gösterilir (fatura, ödeme, düzeltme)
  visibility text not null default 'genel' check (visibility in ('genel', 'finans'))
);
create index audit_log_entity_idx on audit_log (entity, entity_id);
create index audit_log_order_idx on audit_log (order_id);
create index audit_log_at_idx on audit_log (at desc);

-- ---------------------------------------------------------------------------
-- Güvenlik
--  * Tarayıcı veritabanına hiç bağlanmaz. Supabase'in otomatik veri API'si (anon/authenticated) tablolara erişemez.
--  * Klinik ayrımı: her tabloda `klinik_ayrimi` politikası. Uygulama rolü NOBYPASSRLS olmalıdır.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['counters', 'locations', 'categories', 'files', 'file_blobs', 'suppliers', 'products', 'variants',
                           'variant_suppliers', 'price_quotes', 'requests', 'purchase_orders', 'order_lines', 'request_allocations',
                           'receipts', 'receipt_lines', 'delivery_issues', 'invoices', 'invoice_lines', 'invoice_receipts',
                           'payments', 'payment_allocations', 'financial_adjustments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy klinik_ayrimi on %I using (clinic_id = app_clinic()) with check (clinic_id = app_clinic())', t);
  end loop;
end $$;

alter table schema_migrations enable row level security;

-- Klinikler: klinik seçilmeden (giriş anı) okunabilir; klinik içinde yalnızca kendisi.
alter table clinics enable row level security;
create policy klinik_ayrimi on clinics using (app_clinic() is null or id = app_clinic()) with check (app_clinic() is null);

-- Kullanıcılar: giriş anında (klinik henüz bilinmezken) hesap bulunabilmeli; klinik içinde yalnızca o kliniğin hesapları.
alter table app_users enable row level security;
create policy klinik_ayrimi on app_users
  using (app_clinic() is null or clinic_id = app_clinic())
  with check (app_clinic() is null or clinic_id = app_clinic());

-- İşlem geçmişi: ilk yöneticinin açılması gibi giriş anı satırları da yazılabilsin.
alter table audit_log enable row level security;
create policy klinik_ayrimi on audit_log
  using (clinic_id = app_clinic())
  with check (app_clinic() is null or clinic_id = app_clinic());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'revoke all on all functions in schema public from authenticated';
  end if;
end $$;

insert into schema_migrations (version) values ('0001') on conflict do nothing;

commit;
