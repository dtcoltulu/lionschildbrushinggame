-- DENTINEL – klinik ayrımını sıkılaştırma (0005)
-- 0004'teki geçiş kolaylığını kaldırır: `app.clinic_id` verilmemiş bir istek hiçbir kliniğin satırını
-- göremez ve klinik verisi ekleyemez (kapalı varsayılan). Yeni sürüm yayına çıktıktan SONRA uygulanır.

begin;

do $$
declare
  t text;
  cur constant text := $e$nullif(current_setting('app.clinic_id', true), '')::uuid$e$;
begin
  foreach t in array array['locations', 'device_types', 'fault_causes', 'service_vendors', 'staff', 'staff_locations',
                           'devices', 'device_users', 'faults', 'service_visits', 'audit_log'] loop
    execute format('alter table %I alter column clinic_id set default %s', t, cur);
    if t = 'audit_log' then
      -- Klinik seçilmeden yazılan sistem satırları (ör. ilk genel yöneticinin açılması) klinik içinde görünmez.
      execute format('alter policy klinik_ayrimi on %I using (clinic_id = %s) with check (clinic_id is not distinct from %s)', t, cur, cur);
    else
      execute format('alter policy klinik_ayrimi on %I using (clinic_id = %s) with check (clinic_id = %s)', t, cur, cur);
    end if;
  end loop;
end $$;

-- Giriş hesapları: klinik seçilmeden (giriş sırasında) hepsi okunabilir; klinik içinde o kliniğin hesapları ve
-- genel yöneticiler görünür, ama klinik içinden yalnızca o kliniğin hesapları eklenip değiştirilebilir.
alter policy klinik_ayrimi on app_users
  using (clinic_id is null or nullif(current_setting('app.clinic_id', true), '') is null
         or clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  with check (nullif(current_setting('app.clinic_id', true), '') is null
              or clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);

insert into schema_migrations (version) values ('0005') on conflict do nothing;

commit;
