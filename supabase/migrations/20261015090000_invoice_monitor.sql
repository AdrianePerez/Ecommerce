-- =====================================================================
-- 0011 · Monitor de notas de entrada
--  * invoices.received_at: quando a mercadoria chegou. Vazio = em trânsito.
--    Registrado só pela função set_invoice_received (notas continuam
--    sem update direto pela equipe).
--  * invoice_monitor: cada nota com o andamento do cadastro dos produtos
--    e um estágio único para o monitor:
--      em_transito       → mercadoria ainda não recebida
--      cadastro_pendente → recebida; há produto com cadastro mestre incompleto
--      em_preparacao     → cadastro completo; falta anúncio pronto em algum produto
--      finalizada        → todos os produtos prontos (status Pronto/Publicado
--                          ou anúncio "pronto para publicar"/"publicado")
--  Notas já importadas antes desta migração são consideradas recebidas
--  na data da importação (ajustável na tela).
-- =====================================================================

alter table public.invoices add column received_at timestamptz;
comment on column public.invoices.received_at is 'Data de recebimento da mercadoria. Vazio = em trânsito.';
update public.invoices set received_at = imported_at where received_at is null;

create or replace function public.set_invoice_received(p_invoice_id uuid, p_received_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  if p_received_on is not null and p_received_on > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A data de recebimento não pode ser no futuro.' using errcode = '22023';
  end if;
  update public.invoices
     set received_at = case when p_received_on is null then null
                            else (p_received_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo' end
   where id = p_invoice_id;
  if not found then raise exception 'Nota não encontrada.' using errcode = 'P0002'; end if;
end $$;

create view public.invoice_monitor
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
         count(*) filter (where po.missing_count > 0)::int as products_incomplete,
         count(*) filter (where po.status in ('pronto', 'publicado') or exists (
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
comment on view public.invoice_monitor is 'Notas com recebimento e andamento do cadastro dos produtos (estágio do monitor).';
