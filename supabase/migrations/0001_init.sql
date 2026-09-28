-- 118-Y Lions Diş Sağlığı Oyunu – anonim analytics şeması
-- Kişisel veri YOKTUR: yalnızca rastgele UUID'ler, olay adları ve süreler.

create table if not exists public.sessions (
  id            uuid        not null,             -- tarayıcıda üretilen rastgele UUID (kimseyi tanımlamaz)
  campaign_id   text        not null,
  first_seen_at timestamptz not null default now(),
  device_class  text        check (device_class in ('mobile', 'tablet', 'desktop')),
  primary key (id, campaign_id)
);

create table if not exists public.events (
  id          uuid        primary key,            -- istemci üretir → tekrar gönderimde çift kayıt olmaz
  session_id  uuid        not null,
  campaign_id text        not null,
  name        text        not null check (name in (
    'landing_view', 'tutorial_started', 'tutorial_completed', 'tutorial_skipped',
    'game_started', 'phase_completed', 'game_completed', 'reward_screen_viewed', 'replay_started'
  )),
  occurred_at timestamptz not null,               -- istemci saati, sunucu sapması düzeltilmiş
  received_at timestamptz not null default now(),
  play_id     uuid,
  play_index  smallint    check (play_index between 1 and 1000),
  duration_ms integer     check (duration_ms between 0 and 7200000),
  phase       smallint    check (phase between 1 and 6),
  foreign key (session_id, campaign_id) references public.sessions (id, campaign_id) on delete cascade
);

create index if not exists events_campaign_time_idx on public.events (campaign_id, occurred_at);
create index if not exists events_campaign_name_idx on public.events (campaign_id, name);
create index if not exists events_session_idx       on public.events (session_id);

-- Güvenlik: RLS açık ve HİÇ policy yok → anon / authenticated anahtarlar hiçbir şeyi okuyamaz/yazamaz.
-- Sunucu, service_role anahtarıyla erişir (RLS'i atlar). Anahtar yalnızca sunucu ortam değişkenindedir.
alter table public.sessions enable row level security;
alter table public.events   enable row level security;

revoke all on public.sessions from anon, authenticated;
revoke all on public.events   from anon, authenticated;
