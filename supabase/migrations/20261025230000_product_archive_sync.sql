-- =====================================================================
-- 0015 · archived_at acompanha o status "Arquivado"
--  A tela de produto já preenchia archived_at ao arquivar, mas a
--  alteração em massa de status não. Agora o banco garante: status
--  arquivado ⇒ archived_at preenchido; outro status ⇒ archived_at vazio.
-- =====================================================================
create or replace function public.sync_product_archived()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'arquivado' then
    new.archived_at := coalesce(new.archived_at, now());
  else
    new.archived_at := null;
  end if;
  return new;
end $$;
create trigger products_sync_archived before insert or update of status, archived_at on public.products
  for each row execute function public.sync_product_archived();

update public.products set archived_at = coalesce(archived_at, now()) where status = 'arquivado' and archived_at is null;
update public.products set archived_at = null where status <> 'arquivado' and archived_at is not null;
