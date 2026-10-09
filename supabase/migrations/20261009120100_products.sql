-- =====================================================================
-- 0002 · Cadastro mestre: fornecedores, produtos, identificadores e
-- atributos rastreáveis.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.product_status as enum (
  'novo',
  'cadastro_fiscal_pendente',
  'pesquisando',
  'aguardando_revisao',
  'em_preparacao',
  'pronto',
  'publicado',
  'arquivado'
);

create type public.data_source as enum ('manual', 'nfe', 'catalogo', 'pesquisa', 'ia');

create type public.validation_status as enum (
  'encontrada',
  'aguardando_revisao',
  'confirmada',
  'rejeitada',
  'divergente',
  'nao_encontrada'
);

create type public.identifier_type as enum ('ean', 'supplier_sku', 'outro');

-- ---------------------------------------------------------------------
-- Fornecedores
-- ---------------------------------------------------------------------
create table public.suppliers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) > 0),
  trade_name   text,
  cnpj         text check (cnpj ~ '^\d{14}$'),
  notes        text,
  archived_at  timestamptz,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index suppliers_cnpj_key on public.suppliers (cnpj) where cnpj is not null;
create index suppliers_name_idx on public.suppliers (lower(name));
comment on table public.suppliers is 'Fornecedores. CNPJ armazenado só com dígitos e único quando informado.';

-- ---------------------------------------------------------------------
-- Produtos (cadastro mestre)
-- Unidades explícitas no nome das colunas: _mm (milímetros) e _g (gramas).
-- Dimensões do produto e da embalagem ficam em colunas separadas.
-- ---------------------------------------------------------------------
create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  internal_sku       text check (internal_sku is null or length(btrim(internal_sku)) > 0),
  supplier_sku       text,
  ean                text check (ean is null or ean ~ '^(\d{8}|\d{12}|\d{13}|\d{14})$'),
  nf_description     text,
  commercial_name    text,
  brand              text,
  model              text,
  collection         text,
  collection_year    smallint check (collection_year between 1990 and 2100),
  main_supplier_id   uuid references public.suppliers (id) on delete restrict,

  -- Dados fiscais (origem registrada em fiscal_source)
  ncm                text check (ncm is null or ncm ~ '^\d{8}$'),
  cest               text check (cest is null or cest ~ '^\d{7}$'),
  fiscal_origin      smallint check (fiscal_origin between 0 and 8),
  fiscal_source      public.data_source,
  unit               text,

  -- Características
  material           text,
  color              text,
  capacity_value     numeric(12, 3) check (capacity_value > 0),
  capacity_unit      text check (capacity_unit in ('L', 'mL', 'kg', 'g', 'un')),

  -- Dimensões e peso do PRODUTO
  height_mm          numeric(10, 1) check (height_mm > 0),
  width_mm           numeric(10, 1) check (width_mm > 0),
  depth_mm           numeric(10, 1) check (depth_mm > 0),
  weight_g           numeric(10, 1) check (weight_g > 0),

  -- Dimensões e peso da EMBALAGEM de transporte
  pkg_height_mm      numeric(10, 1) check (pkg_height_mm > 0),
  pkg_width_mm       numeric(10, 1) check (pkg_width_mm > 0),
  pkg_depth_mm       numeric(10, 1) check (pkg_depth_mm > 0),
  gross_weight_g     numeric(10, 1) check (gross_weight_g > 0),

  notes              text,
  status             public.product_status not null default 'novo',
  archived_at        timestamptz,
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint products_has_name check (
    coalesce(btrim(commercial_name), '') <> '' or coalesce(btrim(nf_description), '') <> ''
  ),
  constraint products_capacity_pair check ((capacity_value is null) = (capacity_unit is null)),
  constraint products_fiscal_source check (
    fiscal_source is not null or (ncm is null and cest is null and fiscal_origin is null)
  ),
  constraint products_fiscal_not_ai check (fiscal_source is distinct from 'ia'),
  -- "Pronto"/"Publicado" exigem o cadastro mestre completo (mesmos critérios de missing_count)
  constraint products_ready_requires_complete check (
    status not in ('pronto', 'publicado') or (
      coalesce(btrim(commercial_name), '') <> '' and brand is not null
      and (ean is not null or supplier_sku is not null) and ncm is not null
      and height_mm is not null and width_mm is not null and depth_mm is not null
      and weight_g is not null
    )
  )
);

create unique index products_internal_sku_key on public.products (lower(internal_sku))
  where internal_sku is not null;
create index products_status_idx on public.products (status) where archived_at is null;
create index products_brand_idx on public.products (lower(brand));
create index products_collection_idx on public.products (lower(collection));
create index products_supplier_idx on public.products (main_supplier_id);
create index products_updated_idx on public.products (updated_at desc);
create index products_search_trgm on public.products using gin (
  (coalesce(commercial_name, '') || ' ' || coalesce(nf_description, '') || ' ' ||
   coalesce(model, '') || ' ' || coalesce(brand, '')) extensions.gin_trgm_ops
);

comment on table public.products is 'Cadastro mestre: um registro por produto, independente de notas e anúncios.';
comment on column public.products.fiscal_source is 'Origem dos dados fiscais (NCM, CEST, origem). IA nunca é aceita como origem fiscal.';
comment on column public.products.supplier_sku is 'Código principal do fornecedor principal. Todos os códigos ficam em product_identifiers.';
comment on column public.products.ean is 'EAN/GTIN principal. Todos os códigos ficam em product_identifiers.';

-- ---------------------------------------------------------------------
-- Identificadores (EAN, códigos de fornecedor...)
-- Um EAN pertence a um único produto; um código de fornecedor é único por fornecedor.
-- ---------------------------------------------------------------------
create table public.product_identifiers (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  id_type       public.identifier_type not null,
  value         text not null check (length(btrim(value)) > 0),
  supplier_id   uuid references public.suppliers (id) on delete restrict,
  source        public.data_source not null default 'manual',
  match_reason  text,
  confirmed_by  uuid references auth.users (id) on delete set null,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  constraint identifiers_ean_format check (id_type <> 'ean' or value ~ '^(\d{8}|\d{12}|\d{13}|\d{14})$')
);
create unique index product_identifiers_ean_key on public.product_identifiers (value)
  where id_type = 'ean';
create unique index product_identifiers_supplier_sku_key on public.product_identifiers (
  coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(value)
) where id_type = 'supplier_sku';
create index product_identifiers_product_idx on public.product_identifiers (product_id);
create index product_identifiers_value_idx on public.product_identifiers (lower(value));
comment on table public.product_identifiers is 'Todos os códigos que identificam o produto, com origem e motivo do vínculo.';

-- Mantém os identificadores principais do produto espelhados em product_identifiers.
-- Se o EAN/código já pertencer a outro produto, a gravação falha (duplicidade).
create or replace function public.sync_primary_identifiers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ean is not null and (tg_op = 'INSERT' or new.ean is distinct from old.ean) then
    if exists (select 1 from public.product_identifiers
               where id_type = 'ean' and value = new.ean and product_id <> new.id) then
      raise exception 'O EAN % já está vinculado a outro produto', new.ean using errcode = '23505';
    end if;
    insert into public.product_identifiers (product_id, id_type, value, source, match_reason)
    values (new.id, 'ean', new.ean, 'manual', 'EAN principal do cadastro')
    on conflict do nothing;
  end if;

  if new.supplier_sku is not null
     and (tg_op = 'INSERT' or new.supplier_sku is distinct from old.supplier_sku
          or new.main_supplier_id is distinct from old.main_supplier_id) then
    if exists (select 1 from public.product_identifiers
               where id_type = 'supplier_sku'
                 and lower(value) = lower(new.supplier_sku)
                 and supplier_id is not distinct from new.main_supplier_id
                 and product_id <> new.id) then
      raise exception 'O código % deste fornecedor já está vinculado a outro produto', new.supplier_sku
        using errcode = '23505';
    end if;
    insert into public.product_identifiers (product_id, id_type, value, supplier_id, source, match_reason)
    values (new.id, 'supplier_sku', new.supplier_sku, new.main_supplier_id, 'manual',
            'Código principal do fornecedor no cadastro')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger products_sync_identifiers
  after insert or update of ean, supplier_sku, main_supplier_id on public.products
  for each row execute function public.sync_primary_identifiers();

-- ---------------------------------------------------------------------
-- Atributos rastreáveis (extensíveis sem alterar o esquema)
-- Vários valores candidatos por atributo; no máximo um confirmado.
-- ---------------------------------------------------------------------
create table public.product_attributes (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references public.products (id) on delete cascade,
  attr_key           text not null check (attr_key ~ '^[a-z0-9_]{2,60}$'),
  label              text,
  value_text         text,
  value_num          numeric(14, 4),
  unit               text,
  source             public.data_source not null default 'manual',
  source_ref         text,
  confidence         numeric(3, 2) check (confidence between 0 and 1),
  validation_status  public.validation_status not null default 'confirmada',
  notes              text,
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint product_attributes_has_value check (value_text is not null or value_num is not null)
);
create unique index product_attributes_confirmed_key on public.product_attributes (product_id, attr_key)
  where validation_status = 'confirmada';
create index product_attributes_product_idx on public.product_attributes (product_id);
comment on table public.product_attributes is 'Atributos adicionais com fonte, confiança e estado de validação.';

-- ---------------------------------------------------------------------
-- Visão de listagem com indicadores de completude
-- (security_invoker: respeita a RLS de quem consulta)
-- ---------------------------------------------------------------------
create view public.product_overview
with (security_invoker = true) as
select
  p.*,
  s.name as supplier_name,
  (p.height_mm is null or p.width_mm is null or p.depth_mm is null) as missing_dimensions,
  (p.weight_g is null) as missing_weight,
  (p.ncm is null) as missing_fiscal,
  (p.commercial_name is null or btrim(p.commercial_name) = '') as missing_commercial_name,
  (
    (p.commercial_name is null or btrim(p.commercial_name) = '')::int +
    (p.brand is null)::int + (p.ean is null and p.supplier_sku is null)::int +
    (p.ncm is null)::int +
    (p.height_mm is null or p.width_mm is null or p.depth_mm is null)::int +
    (p.weight_g is null)::int
  ) as missing_count
from public.products p
left join public.suppliers s on s.id = p.main_supplier_id;

comment on view public.product_overview is 'Produtos com fornecedor e indicadores do que falta preencher.';

-- ---------------------------------------------------------------------
-- Gatilhos de updated_at e auditoria
-- ---------------------------------------------------------------------
create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger product_attributes_updated_at before update on public.product_attributes
  for each row execute function public.set_updated_at();

create trigger suppliers_audit after insert or update or delete on public.suppliers
  for each row execute function public.audit_row();
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit_row();
create trigger product_identifiers_audit after insert or update or delete on public.product_identifiers
  for each row execute function public.audit_row();
create trigger product_attributes_audit after insert or update or delete on public.product_attributes
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- RLS
-- Produtos e fornecedores não são apagados fisicamente: são arquivados.
-- ---------------------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.product_identifiers enable row level security;
alter table public.product_attributes enable row level security;

create policy "suppliers: equipe consulta" on public.suppliers
  for select to authenticated using (public.is_staff());
create policy "suppliers: equipe cadastra" on public.suppliers
  for insert to authenticated with check (public.is_staff());
create policy "suppliers: equipe altera" on public.suppliers
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "products: equipe consulta" on public.products
  for select to authenticated using (public.is_staff());
create policy "products: equipe cadastra" on public.products
  for insert to authenticated with check (public.is_staff());
create policy "products: equipe altera" on public.products
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "identifiers: equipe consulta" on public.product_identifiers
  for select to authenticated using (public.is_staff());
create policy "identifiers: equipe cadastra" on public.product_identifiers
  for insert to authenticated with check (public.is_staff());
create policy "identifiers: equipe altera" on public.product_identifiers
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "identifiers: equipe corrige vínculos" on public.product_identifiers
  for delete to authenticated using (public.is_staff());

create policy "attributes: equipe consulta" on public.product_attributes
  for select to authenticated using (public.is_staff());
create policy "attributes: equipe cadastra" on public.product_attributes
  for insert to authenticated with check (public.is_staff());
create policy "attributes: equipe altera" on public.product_attributes
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "attributes: equipe remove" on public.product_attributes
  for delete to authenticated using (public.is_staff());

revoke all on public.suppliers, public.products, public.product_identifiers,
  public.product_attributes, public.product_overview from anon;
revoke delete on public.products, public.suppliers from authenticated;
