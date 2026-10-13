-- =====================================================================
-- 0009 · Fase 5: precificação por canal e vitrine
--  * pricing_rules: regras por canal e modalidade (ex.: Mercado Livre
--    Clássico), VERSIONADAS. Parâmetros nunca mudam numa versão gravada;
--    alterar = criar nova versão e ativá-la. Uma ativa por canal+nome.
--    Comissão e tarifa fixa variam por faixa de preço (tiers).
--  * pricing_simulations: registro (só inclusão) de cada preço aplicado ou
--    simulação salva, com o custo e a regra usados e o resultado.
--  * product_listings ganha a regra de preço escolhida e o frete do anúncio.
--  * showcase_rows: uma linha por anúncio ativo (ou por produto sem anúncio)
--    para a vitrine e seus filtros.
--  Valores iniciais das regras vêm de fontes públicas (conferir no canal);
--  impostos, embalagem e frete ficam zerados até a empresa informar.
-- =====================================================================

create table public.pricing_rules (
  id                  uuid primary key default gen_random_uuid(),
  marketplace_id      uuid not null references public.marketplace_configs (id) on delete restrict,
  name                text not null check (length(btrim(name)) > 0),
  version             integer not null check (version > 0),
  is_active           boolean not null default false,
  -- [{"min_price":0,"commission_pct":14,"fixed_fee":6}, ...] — a faixa vale a partir de min_price
  tiers               jsonb not null check (jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) > 0),
  shipping_fee        numeric(10, 2) not null default 0 check (shipping_fee >= 0),
  shipping_min_price  numeric(10, 2) check (shipping_min_price >= 0),
  extra_pct           numeric(6, 3) not null default 0 check (extra_pct >= 0 and extra_pct < 100),
  tax_pct             numeric(6, 3) not null default 0 check (tax_pct >= 0 and tax_pct < 100),
  packaging_cost      numeric(10, 2) not null default 0 check (packaging_cost >= 0),
  other_fixed         numeric(10, 2) not null default 0 check (other_fixed >= 0),
  other_pct           numeric(6, 3) not null default 0 check (other_pct >= 0 and other_pct < 100),
  target_margin_pct   numeric(6, 3) not null default 20 check (target_margin_pct >= 0 and target_margin_pct < 100),
  notes               text,
  checked_on          date,
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (marketplace_id, name, version)
);
create unique index pricing_rules_one_active on public.pricing_rules (marketplace_id, lower(name)) where is_active;
comment on table public.pricing_rules is 'Regras de preço por canal, versionadas. Uma versão gravada não muda; só pode ser ativada/desativada.';

-- Faixas bem formadas: começa em 0, sem repetição, valores válidos
create or replace function public.check_pricing_rule()
returns trigger language plpgsql set search_path = '' as $$
declare t jsonb; mins numeric[] := '{}';
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'is_active') is distinct from (to_jsonb(old) - 'is_active') then
      raise exception 'Uma versão gravada da regra de preço não pode ser alterada. Crie uma nova versão.' using errcode = '23514';
    end if;
    return new;
  end if;
  for t in select * from jsonb_array_elements(new.tiers) loop
    if jsonb_typeof(t->'min_price') <> 'number' or jsonb_typeof(t->'commission_pct') <> 'number' or jsonb_typeof(t->'fixed_fee') <> 'number'
       or (t->>'min_price')::numeric < 0 or (t->>'fixed_fee')::numeric < 0
       or (t->>'commission_pct')::numeric < 0 or (t->>'commission_pct')::numeric >= 100 then
      raise exception 'Faixa de preço inválida na regra.' using errcode = '23514';
    end if;
    mins := mins || (t->>'min_price')::numeric;
  end loop;
  if not (0 = any (mins)) then raise exception 'A primeira faixa precisa começar em R$ 0,00.' using errcode = '23514'; end if;
  if cardinality(mins) <> (select count(distinct x) from unnest(mins) x) then
    raise exception 'Duas faixas começam no mesmo preço.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger pricing_rules_check before insert or update on public.pricing_rules
  for each row execute function public.check_pricing_rule();

-- Ativa uma versão e desativa a anterior do mesmo canal+nome
create or replace function public.activate_pricing_rule(p_rule_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare r public.pricing_rules;
begin
  select * into r from public.pricing_rules where id = p_rule_id;
  if not found then raise exception 'Regra não encontrada.' using errcode = 'P0002'; end if;
  update public.pricing_rules set is_active = false
   where marketplace_id = r.marketplace_id and lower(name) = lower(r.name) and is_active and id <> r.id;
  update public.pricing_rules set is_active = true where id = r.id;
  if not found then raise exception 'Somente administradores alteram regras de preço.' using errcode = '42501'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Anúncio: regra de preço e frete do anúncio
-- ---------------------------------------------------------------------
alter table public.product_listings
  add column pricing_rule_id uuid references public.pricing_rules (id) on delete set null,
  add column shipping_cost numeric(10, 2) check (shipping_cost >= 0);
comment on column public.product_listings.shipping_cost is 'Frete por conta do vendedor neste anúncio (R$). Vazio = valor da regra.';

create or replace function public.check_listing_rule()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.pricing_rule_id is not null and not exists (
    select 1 from public.pricing_rules r where r.id = new.pricing_rule_id and r.marketplace_id = new.marketplace_id
  ) then
    raise exception 'A regra de preço escolhida é de outro canal.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger product_listings_check_rule before insert or update of pricing_rule_id, marketplace_id on public.product_listings
  for each row execute function public.check_listing_rule();

-- ---------------------------------------------------------------------
-- Simulações registradas (histórico, só inclusão)
-- ---------------------------------------------------------------------
create table public.pricing_simulations (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products (id) on delete restrict,
  listing_id            uuid references public.product_listings (id) on delete set null,
  pricing_rule_id       uuid not null references public.pricing_rules (id) on delete restrict,
  unit_cost             numeric(14, 4) not null check (unit_cost > 0),
  cost_source           text not null check (cost_source in ('custo_medio', 'manual')),
  price                 numeric(12, 2) not null check (price > 0),
  shipping_fee          numeric(10, 2) not null default 0 check (shipping_fee >= 0),
  target_margin_pct     numeric(6, 3),
  min_price_for_target  numeric(12, 2),
  profit                numeric(12, 2) not null,
  margin_pct            numeric(8, 3),
  -- detalhamento completo (comissão, impostos, tarifa fixa...) no momento da simulação
  results               jsonb not null check (jsonb_typeof(results) = 'object'),
  applied               boolean not null default false,
  note                  text,
  created_by            uuid default auth.uid() references auth.users (id) on delete set null,
  created_at            timestamptz not null default now()
);
create index pricing_simulations_product_idx on public.pricing_simulations (product_id, created_at desc);
create index pricing_simulations_listing_idx on public.pricing_simulations (listing_id, created_at desc) where listing_id is not null;
comment on table public.pricing_simulations is 'Histórico de simulações/preços aplicados com o custo e a versão da regra usados. Estimativas, não resultado contábil.';

-- ---------------------------------------------------------------------
-- Vitrine
-- ---------------------------------------------------------------------
create view public.showcase_rows
with (security_invoker = true) as
select
  coalesce(l.id, p.id)                         as row_id,
  p.id                                         as product_id,
  p.commercial_name, p.nf_description, p.internal_sku, p.supplier_sku, p.ean, p.brand, p.model,
  p.collection, p.main_supplier_id, p.supplier_name, p.status as product_status, p.archived_at,
  p.missing_count, p.missing_dimensions, p.missing_weight,
  c.average_unit_cost,
  (select count(*) from public.product_images i where i.product_id = p.id and i.status = 'aprovada')::int as approved_images,
  (select i.storage_path from public.product_images i where i.product_id = p.id and i.is_main) as main_image_path,
  l.id                                         as listing_id,
  l.marketplace_id,
  m.name                                       as marketplace_name,
  l.variant_label,
  l.status                                     as listing_status,
  l.title,
  (coalesce(btrim(l.title), '') <> '')         as has_title,
  (coalesce(btrim(l.description), '') <> '')   as has_description,
  l.suggested_price,
  l.pricing_rule_id,
  l.shipping_cost,
  greatest(p.updated_at, l.updated_at)         as updated_at
from public.product_overview p
left join public.product_cost_summary c on c.product_id = p.id
left join public.product_listings l on l.product_id = p.id and l.status <> 'arquivado'
left join public.marketplace_configs m on m.id = l.marketplace_id;
comment on view public.showcase_rows is 'Vitrine: uma linha por anúncio ativo, ou uma linha para o produto sem anúncio.';

-- ---------------------------------------------------------------------
-- Valores iniciais (conferir no canal; impostos/embalagem/frete a preencher)
-- ---------------------------------------------------------------------
insert into public.pricing_rules (marketplace_id, name, version, is_active, tiers, shipping_fee, shipping_min_price, extra_pct, tax_pct,
  packaging_cost, other_fixed, other_pct, target_margin_pct, notes, checked_on)
select m.id, v.name, 1, true, v.tiers::jsonb, 0, v.ship_min, v.extra, 0, 0, 0, 0, 20, v.notes, '2026-10-13'
from public.marketplace_configs m
join (values
  ('mercado_livre', 'Clássico', '[{"min_price":0,"commission_pct":14,"fixed_fee":5.5},{"min_price":20.01,"commission_pct":14,"fixed_fee":6},{"min_price":79,"commission_pct":14,"fixed_fee":0}]', 79::numeric, 0::numeric,
   'Valores iniciais de fontes públicas (comissão de moda/acessórios; custo fixo abaixo de R$ 79). Conferir a comissão da categoria Mochilas na Central do Vendedor. Preencher impostos, embalagem e o frete médio pago em vendas a partir de R$ 79.'),
  ('mercado_livre', 'Premium', '[{"min_price":0,"commission_pct":19,"fixed_fee":5.5},{"min_price":20.01,"commission_pct":19,"fixed_fee":6},{"min_price":79,"commission_pct":19,"fixed_fee":0}]', 79::numeric, 0::numeric,
   'Valores iniciais de fontes públicas. Conferir a comissão da categoria na Central do Vendedor. Preencher impostos, embalagem e frete.'),
  ('tiktok_shop', 'Padrão', '[{"min_price":0,"commission_pct":10,"fixed_fee":4},{"min_price":50,"commission_pct":6,"fixed_fee":6}]', null::numeric, 6::numeric,
   'Valores iniciais de fontes públicas (vigentes a partir de 15/07/2026): abaixo de R$ 50, 10% + R$ 4; a partir de R$ 50, 6% + R$ 6. "Outras taxas" = 6% do Programa de Frete Grátis (zerar se não participar). Comissão de afiliados não incluída. Conferir no Seller Center.')
) as v(code, name, tiers, ship_min, extra, notes) on v.code = m.code;

-- ---------------------------------------------------------------------
-- Gatilhos, RLS e privilégios
-- ---------------------------------------------------------------------
create trigger pricing_rules_audit after insert or update or delete on public.pricing_rules
  for each row execute function public.audit_row();

alter table public.pricing_rules enable row level security;
alter table public.pricing_simulations enable row level security;

create policy "pricing_rules: equipe consulta" on public.pricing_rules for select to authenticated using ((select public.is_staff()));
create policy "pricing_rules: admin cria" on public.pricing_rules for insert to authenticated with check ((select public.is_admin()));
create policy "pricing_rules: admin ativa" on public.pricing_rules for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "pricing_simulations: equipe consulta" on public.pricing_simulations for select to authenticated using ((select public.is_staff()));
create policy "pricing_simulations: equipe registra" on public.pricing_simulations for insert to authenticated with check ((select public.is_staff()));
