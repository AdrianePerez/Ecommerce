-- =====================================================================
-- 0014b · Regras do status "Fora de linha"
--  * Monitor de notas: produto fora de linha não é pendência — não conta
--    como cadastro incompleto e conta como resolvido (a nota pode ficar
--    "finalizada" mesmo com itens que você não vai mais vender).
--  * Anúncios: produto fora de linha não ganha anúncio novo nem tem
--    anúncio marcado como pronto/publicado. Arquivar continua liberado.
-- =====================================================================

create or replace view public.invoice_monitor
with (security_invoker = true) as
with it as (
  select ii.invoice_id,
         count(*) filter (where ii.match_method <> 'ignorado')::int as items_total,
         count(*) filter (where ii.match_method = 'ignorado')::int  as items_ignored
  from public.invoice_items ii
  group by ii.invoice_id
), prods as (
  select distinct ii.invoice_id, ii.product_id
  from public.invoice_items ii
  where ii.product_id is not null
), ps as (
  select pr.invoice_id,
         count(*)::int as products_total,
         count(*) filter (where po.missing_count > 0 and po.status <> 'fora_de_linha')::int as products_incomplete,
         count(*) filter (where po.status in ('pronto', 'publicado', 'fora_de_linha') or exists (
           select 1 from public.product_listings l
           where l.product_id = pr.product_id and l.status in ('pronto_para_publicar', 'publicado')
         ))::int as products_ready
  from prods pr
  join public.product_overview po on po.id = pr.product_id
  group by pr.invoice_id
)
select
  i.*,
  s.name       as supplier_name,
  s.trade_name as supplier_trade_name,
  coalesce(it.items_total, 0)          as items_total,
  coalesce(it.items_ignored, 0)        as items_ignored,
  coalesce(ps.products_total, 0)       as products_total,
  coalesce(ps.products_incomplete, 0)  as products_incomplete,
  coalesce(ps.products_ready, 0)       as products_ready,
  case
    when i.received_at is null then 'em_transito'
    when coalesce(ps.products_incomplete, 0) > 0 then 'cadastro_pendente'
    when coalesce(ps.products_ready, 0) < coalesce(ps.products_total, 0) then 'em_preparacao'
    else 'finalizada'
  end as stage
from public.invoices i
left join public.suppliers s on s.id = i.supplier_id
left join it on it.invoice_id = i.id
left join ps on ps.invoice_id = i.id;

create or replace function public.listing_discontinued_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.status is distinct from old.status)
     and new.status <> 'arquivado'
     and (tg_op = 'INSERT' or new.status in ('pronto_para_publicar', 'publicado'))
     and exists (select 1 from public.products p where p.id = new.product_id and p.status = 'fora_de_linha') then
    raise exception 'Produto fora de linha: mude o status do produto para voltar a anunciar.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger product_listings_discontinued_guard before insert or update of status on public.product_listings
  for each row execute function public.listing_discontinued_guard();
