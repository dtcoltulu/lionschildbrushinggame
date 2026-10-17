-- Koşuyolu Park Cihaz Takip – çalışanın birden fazla oda / ünitesi olabilir (0003)
-- Eklemeli geçiştir: eski sürüm çalışırken uygulanabilir. Mevcut tek oda bilgileri yeni tabloya kopyalanır.

begin;

create table staff_locations (
  staff_id uuid not null references staff(id) on delete cascade,
  location_id uuid not null references locations(id),
  primary key (staff_id, location_id)
);
create index staff_locations_location_idx on staff_locations (location_id);

insert into staff_locations (staff_id, location_id)
select id, location_id from staff where location_id is not null
on conflict do nothing;

comment on column staff.location_id is 'Kullanılmıyor (0003): odalar staff_locations tablosunda. Eski sürümle uyum için bırakıldı.';

-- 0001'deki güvenlik kuralının aynısı: veri API'si (anon/authenticated) bu tabloya erişemez.
alter table staff_locations enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table staff_locations from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table staff_locations from authenticated';
  end if;
end $$;

insert into schema_migrations (version) values ('0003') on conflict do nothing;

commit;
