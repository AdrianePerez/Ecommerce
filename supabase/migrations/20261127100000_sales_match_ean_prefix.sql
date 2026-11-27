-- =====================================================================
-- 0018 · Vendas: SKU de anúncio que começa com o EAN
--  Ex.: "6926845748058-AZ" (EAN + sufixo da cor). Se o SKU inteiro não
--  encontra produto, tenta o EAN do começo (8, 12, 13 ou 14 dígitos,
--  seguido de -, _, espaço, / ou .). Só liga se der exatamente 1 produto.
--  Além disso, cada importação revisa as vendas antigas ainda sem produto
--  (ex.: produto cadastrado depois), e as já importadas são revisadas agora.
-- =====================================================================
create or replace function public.product_for_sku(p_sku text)
returns uuid language sql stable security invoker set search_path = '' as $$
  with k as (
    select upper(btrim(p_sku)) as full_sku,
           (regexp_match(btrim(p_sku), '^(\d{14}|\d{13}|\d{12}|\d{8})[-_ /.]'))[1] as ean_prefix
  ),
  exact as (
    select p.id from public.products p, k
     where p.archived_at is null and k.full_sku in (upper(p.ean), upper(p.internal_sku), upper(p.supplier_sku))
    union
    select i.product_id from public.product_identifiers i
      join public.products p on p.id = i.product_id and p.archived_at is null, k
     where upper(i.value) = k.full_sku
  ),
  by_ean as (
    select p.id from public.products p, k
     where k.ean_prefix is not null and p.archived_at is null and p.ean = k.ean_prefix
    union
    select i.product_id from public.product_identifiers i
      join public.products p on p.id = i.product_id and p.archived_at is null, k
     where k.ean_prefix is not null and i.id_type = 'ean' and i.value = k.ean_prefix
  )
  select case
    when (select count(*) from exact) = 1 then (select min(id::text)::uuid from exact)
    when (select count(*) from exact) = 0 and (select count(*) from by_ean) = 1 then (select min(id::text)::uuid from by_ean)
  end
$$;

-- Revisa vendas sem produto (chamado no fim de cada importação)
create or replace function public.rematch_sales()
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not public.is_staff() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  update public.sales s set product_id = m.pid, updated_at = now()
    from (select id, public.product_for_sku(sku) as pid from public.sales where product_id is null and sku is not null) m
   where s.id = m.id and m.pid is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Revisão das vendas já importadas (rodando como dono da migração, sem checar equipe)
update public.sales s set product_id = m.pid, updated_at = now()
  from (select id, public.product_for_sku(sku) as pid from public.sales where product_id is null and sku is not null) m
 where s.id = m.id and m.pid is not null;
