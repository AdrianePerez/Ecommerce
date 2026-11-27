-- =====================================================================
-- 0017 · Vendas (importação de relatórios dos marketplaces)
--  * sales_imports: cada arquivo importado (quem, quando, quantas linhas).
--  * sales: uma linha por item vendido (anúncio/SKU) — para pacotes e kits
--    do Mercado Livre, uma linha por produto, com os valores do pacote
--    rateados pelo preço de cada item (o rateio é feito no leitor).
--    Reimportar o mesmo relatório ATUALIZA as vendas (status muda: a caminho
--    → entregue → devolvida), nunca duplica: chave (canal, nº da venda).
--  * Não guardamos dados pessoais do comprador (nome, CPF, endereço):
--    só a UF de destino, para análise regional.
--  * product_id é ligado pelo SKU do anúncio (EAN, SKU interno, código do
--    fornecedor ou identificador cadastrado). SKU sem produto fica pendente
--    até ser vinculado (link_sales_sku), e o vínculo vale para as próximas.
-- =====================================================================
create table public.sales_imports (
  id           uuid primary key default gen_random_uuid(),
  channel      text not null check (channel in ('mercado_livre', 'tiktok_shop', 'shopee')),
  file_name    text not null check (length(file_name) between 1 and 300),
  rows_total   int not null default 0,
  rows_new     int not null default 0,
  rows_updated int not null default 0,
  period_start timestamptz,
  period_end   timestamptz,
  imported_by  uuid default auth.uid() references auth.users (id) on delete set null,
  imported_at  timestamptz not null default now()
);
comment on table public.sales_imports is 'Arquivos de vendas importados (relatórios dos marketplaces).';

create table public.sales (
  id             uuid primary key default gen_random_uuid(),
  channel        text not null check (channel in ('mercado_livre', 'tiktok_shop', 'shopee')),
  order_id       text not null check (length(order_id) between 1 and 60),
  pack_id        text,
  sold_at        timestamptz not null,
  status_text    text,
  status_group   text not null check (status_group in ('ativa', 'cancelada', 'devolvida')),
  sku            text,
  product_id     uuid references public.products (id) on delete set null,
  listing_ext_id text,
  kit_ext_id     text,
  title          text,
  variation      text,
  listing_type   text,
  units          numeric(12,3) not null check (units >= 0),
  unit_price     numeric(14,2),
  gross_revenue  numeric(14,2) not null default 0,  -- receita por produtos
  sale_fees      numeric(14,2) not null default 0,  -- tarifa de venda e impostos (negativo)
  shipping_net   numeric(14,2) not null default 0,  -- receita por envio + tarifas de envio
  discounts      numeric(14,2) not null default 0,  -- descontos e bônus
  refunds        numeric(14,2) not null default 0,  -- cancelamentos e reembolsos (negativo)
  net_total      numeric(14,2) not null default 0,  -- total que o marketplace repassa
  shipping_mode  text,
  buyer_state    text,
  from_ads       boolean not null default false,
  import_id      uuid references public.sales_imports (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (channel, order_id)
);
create index sales_sold_at_idx on public.sales (sold_at);
create index sales_product_idx on public.sales (product_id);
create index sales_sku_idx on public.sales (channel, upper(sku));
comment on table public.sales is 'Itens vendidos nos marketplaces (sem dados pessoais do comprador).';

alter table public.sales_imports enable row level security;
alter table public.sales enable row level security;
create policy "sales_imports: equipe consulta" on public.sales_imports for select to authenticated using ((select public.is_staff()));
create policy "sales: equipe consulta" on public.sales for select to authenticated using ((select public.is_staff()));

-- Produto de um SKU de anúncio: igualdade exata (sem diferenciar maiúsculas) em EAN,
-- SKU interno, código do fornecedor ou identificador. Mais de um produto → nenhum (ambíguo).
create or replace function public.product_for_sku(p_sku text)
returns uuid language sql stable security invoker set search_path = '' as $$
  with c as (
    select p.id from public.products p
     where p.archived_at is null and upper(btrim(p_sku)) in (upper(p.ean), upper(p.internal_sku), upper(p.supplier_sku))
    union
    select i.product_id from public.product_identifiers i
      join public.products p on p.id = i.product_id and p.archived_at is null
     where upper(i.value) = upper(btrim(p_sku))
  )
  select case when count(*) = 1 then min(id::text)::uuid end from c
$$;

-- Importa (ou atualiza) as vendas de um arquivo. p_rows: lista já tratada pelo leitor.
create or replace function public.import_sales(p_channel text, p_file_name text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_import uuid; r jsonb; v_new int := 0; v_upd int := 0; v_ins boolean;
begin
  if not public.is_staff() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhuma venda no arquivo.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Arquivo grande demais (máx. 20.000 linhas).' using errcode = '22023'; end if;

  insert into public.sales_imports (channel, file_name, rows_total)
  values (p_channel, left(btrim(p_file_name), 300), jsonb_array_length(p_rows)) returning id into v_import;

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.sales as s (
      channel, order_id, pack_id, sold_at, status_text, status_group, sku, product_id, listing_ext_id, kit_ext_id,
      title, variation, listing_type, units, unit_price, gross_revenue, sale_fees, shipping_net, discounts, refunds,
      net_total, shipping_mode, buyer_state, from_ads, import_id)
    values (
      p_channel, r->>'order_id', nullif(r->>'pack_id', ''), (r->>'sold_at')::timestamptz, left(r->>'status_text', 300),
      r->>'status_group', nullif(btrim(r->>'sku'), ''), public.product_for_sku(r->>'sku'),
      nullif(r->>'listing_ext_id', ''), nullif(r->>'kit_ext_id', ''), left(r->>'title', 500), left(r->>'variation', 300),
      nullif(r->>'listing_type', ''), coalesce((r->>'units')::numeric, 0), (r->>'unit_price')::numeric,
      coalesce((r->>'gross_revenue')::numeric, 0), coalesce((r->>'sale_fees')::numeric, 0),
      coalesce((r->>'shipping_net')::numeric, 0), coalesce((r->>'discounts')::numeric, 0),
      coalesce((r->>'refunds')::numeric, 0), coalesce((r->>'net_total')::numeric, 0),
      nullif(r->>'shipping_mode', ''), nullif(r->>'buyer_state', ''), coalesce((r->>'from_ads')::boolean, false), v_import)
    on conflict (channel, order_id) do update set
      pack_id = excluded.pack_id, sold_at = excluded.sold_at, status_text = excluded.status_text,
      status_group = excluded.status_group, sku = excluded.sku,
      product_id = coalesce(excluded.product_id, s.product_id),
      listing_ext_id = excluded.listing_ext_id, kit_ext_id = excluded.kit_ext_id, title = excluded.title,
      variation = excluded.variation, listing_type = excluded.listing_type, units = excluded.units,
      unit_price = excluded.unit_price, gross_revenue = excluded.gross_revenue, sale_fees = excluded.sale_fees,
      shipping_net = excluded.shipping_net, discounts = excluded.discounts, refunds = excluded.refunds,
      net_total = excluded.net_total, shipping_mode = excluded.shipping_mode, buyer_state = excluded.buyer_state,
      from_ads = excluded.from_ads, import_id = excluded.import_id, updated_at = now()
    returning (xmax = 0) into v_ins;
    if v_ins then v_new := v_new + 1; else v_upd := v_upd + 1; end if;
  end loop;

  update public.sales_imports i set rows_new = v_new, rows_updated = v_upd,
    period_start = (select min(sold_at) from public.sales where import_id = v_import),
    period_end   = (select max(sold_at) from public.sales where import_id = v_import)
   where i.id = v_import;
  return jsonb_build_object('import_id', v_import, 'novas', v_new, 'atualizadas', v_upd,
    'sem_produto', (select count(distinct upper(sku)) from public.sales where import_id = v_import and product_id is null));
end $$;

-- Liga um SKU de anúncio a um produto: grava o identificador (vale para as próximas
-- importações) e atualiza as vendas já importadas com esse SKU.
create or replace function public.link_sales_sku(p_sku text, p_product_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int; v_sku text := btrim(p_sku);
begin
  if not public.is_staff() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  if v_sku = '' then raise exception 'SKU vazio.' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_product_id and archived_at is null) then
    raise exception 'Produto não encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.product_identifiers where product_id = p_product_id and upper(value) = upper(v_sku)) then
    insert into public.product_identifiers (product_id, id_type, value, source, match_reason, confirmed_by, confirmed_at)
    values (p_product_id, 'outro', v_sku, 'manual', 'SKU de anúncio vinculado na tela Vendas', auth.uid(), now());
  end if;
  update public.sales set product_id = p_product_id, updated_at = now() where upper(sku) = upper(v_sku);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
