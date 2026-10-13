-- =====================================================================
-- 0007 · Catálogos de fornecedores (PDF)
--  * supplier_catalogs: um registro por PDF (impressão digital SHA-256 única)
--  * catalog_pages: cada página do catálogo vira uma imagem no Storage
--    (páginas duplas são divididas em duas); guarda também o texto da página
--  * catalog_items: produtos identificados numa página, com a área da foto
--    (bbox normalizado 0–1), dados lidos, confiança e situação da revisão
--  * Aprovar um item só preenche campos VAZIOS do produto; divergências
--    só são aplicadas quando o usuário escolhe explicitamente.
--  * O PDF original NÃO é guardado (decisão da operação): ficam as imagens
--    das páginas e a impressão digital SHA-256 do arquivo. Catálogos antigos
--    podem ser excluídos para liberar espaço; os dados já aprovados
--    continuam nos produtos com a referência textual da origem.
-- =====================================================================

create type public.catalog_status as enum (
  'enviando', 'aguardando_processamento', 'em_processamento', 'processado',
  'processado_parcialmente', 'erro', 'aguardando_revisao'
);
create type public.catalog_page_status as enum ('pendente', 'processada', 'sem_produtos', 'erro');
create type public.catalog_item_status as enum ('aguardando_revisao', 'aprovado', 'rejeitado');

create table public.supplier_catalogs (
  id               uuid primary key default gen_random_uuid(),
  supplier_id      uuid references public.suppliers (id) on delete restrict,
  brand            text,
  name             text not null check (length(btrim(name)) > 0),
  collection_year  smallint check (collection_year between 1990 and 2100),
  received_at      date,
  notes            text,
  file_name        text not null,
  file_size        bigint not null check (file_size > 0),
  file_sha256      text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_page_count   integer not null check (pdf_page_count > 0),
  page_count       integer not null default 0,
  pages_uploaded   integer not null default 0,
  split_spreads    boolean not null default true,
  status           public.catalog_status not null default 'enviando',
  status_message   text,
  archived_at      timestamptz,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index supplier_catalogs_sha_key on public.supplier_catalogs (file_sha256);
create index supplier_catalogs_supplier_idx on public.supplier_catalogs (supplier_id);
create index supplier_catalogs_created_by_idx on public.supplier_catalogs (created_by);
comment on table public.supplier_catalogs is 'Catálogos PDF dos fornecedores. O mesmo arquivo (SHA-256) não é enviado duas vezes.';

create table public.catalog_pages (
  id            uuid primary key default gen_random_uuid(),
  catalog_id    uuid not null references public.supplier_catalogs (id) on delete cascade,
  page_number   integer not null check (page_number > 0),
  pdf_page      integer not null check (pdf_page > 0),
  side          text not null default 'F' check (side in ('F', 'L', 'R')),
  image_path    text not null,
  width         integer not null check (width > 0),
  height        integer not null check (height > 0),
  text_content  text,
  status        public.catalog_page_status not null default 'pendente',
  error         text,
  processed_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (catalog_id, page_number)
);
comment on table public.catalog_pages is 'Página do catálogo como imagem. Páginas duplas do PDF viram L (esquerda) e R (direita).';

create table public.catalog_items (
  id               uuid primary key default gen_random_uuid(),
  catalog_id       uuid not null references public.supplier_catalogs (id) on delete cascade,
  page_id          uuid not null references public.catalog_pages (id) on delete cascade,
  code             text,
  ean              text check (ean is null or ean ~ '^(\d{8}|\d{12}|\d{13}|\d{14})$'),
  name             text,
  description      text,
  height_mm        numeric(10, 1) check (height_mm > 0),
  width_mm         numeric(10, 1) check (width_mm > 0),
  depth_mm         numeric(10, 1) check (depth_mm > 0),
  weight_g         numeric(10, 1) check (weight_g > 0),
  material         text,
  capacity_text    text,
  size_label       text,
  color_code       text,
  box_qty          integer check (box_qty > 0),
  suggested_price  numeric(12, 2) check (suggested_price >= 0),
  features         text[],
  bbox             jsonb check (bbox is null or (
                     (bbox ->> 'x')::numeric between 0 and 1 and (bbox ->> 'y')::numeric between 0 and 1 and
                     (bbox ->> 'w')::numeric > 0 and (bbox ->> 'h')::numeric > 0 and
                     (bbox ->> 'x')::numeric + (bbox ->> 'w')::numeric <= 1.0001 and
                     (bbox ->> 'y')::numeric + (bbox ->> 'h')::numeric <= 1.0001)),
  image_path       text,
  source           public.data_source not null default 'manual',
  confidence       numeric(3, 2) check (confidence between 0 and 1),
  status           public.catalog_item_status not null default 'aguardando_revisao',
  product_id       uuid references public.products (id) on delete restrict,
  match_reason     text,
  reviewed_by      uuid references auth.users (id) on delete set null,
  reviewed_at      timestamptz,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint catalog_items_has_identity check (coalesce(btrim(code), '') <> '' or coalesce(btrim(name), '') <> ''),
  constraint catalog_items_approved_link check (status <> 'aprovado' or product_id is not null)
);
create index catalog_items_page_idx on public.catalog_items (page_id);
create index catalog_items_catalog_idx on public.catalog_items (catalog_id, status);
create index catalog_items_code_idx on public.catalog_items (upper(code));
create index catalog_items_product_idx on public.catalog_items (product_id);
create index catalog_items_reviewed_by_idx on public.catalog_items (reviewed_by);
create index catalog_items_created_by_idx on public.catalog_items (created_by);
comment on table public.catalog_items is 'Produto identificado numa página de catálogo. bbox = área da foto na página (fração 0–1).';

-- Resumo por catálogo
create view public.catalog_overview
with (security_invoker = true) as
select c.*,
       s.name as supplier_name,
       (select count(*) from public.catalog_items i where i.catalog_id = c.id)::int as items_total,
       (select count(*) from public.catalog_items i where i.catalog_id = c.id and i.status = 'aguardando_revisao')::int as items_pending,
       (select count(*) from public.catalog_items i where i.catalog_id = c.id and i.status = 'aprovado')::int as items_approved
from public.supplier_catalogs c
left join public.suppliers s on s.id = c.supplier_id;

-- ---------------------------------------------------------------------
-- Correspondência de código do catálogo com produtos
-- O código da nota costuma ser o código do catálogo + sufixo de cor/unidade
-- (ex.: catálogo IS43531SR → nota IS43531SR0200UN).
-- ---------------------------------------------------------------------
create or replace function public.match_catalog_code(p_code text, p_ean text default null)
returns table (product_id uuid, name text, supplier_sku text, internal_sku text, ean text, match_reason text, exact boolean)
language sql stable
set search_path = ''
as $$
  with c as (select upper(btrim(p_code)) as code, nullif(btrim(p_ean), '') as ean)
  select distinct on (p.id)
         p.id, coalesce(p.commercial_name, p.nf_description), p.supplier_sku, p.internal_sku, p.ean,
         case
           when c.ean is not null and exists (select 1 from public.product_identifiers i
                where i.product_id = p.id and i.id_type = 'ean' and i.value = c.ean) then 'EAN igual ao do catálogo'
           when upper(p.supplier_sku) = c.code or upper(p.internal_sku) = c.code then 'Código igual ao do catálogo'
           else 'Código do fornecedor começa com o código do catálogo'
         end,
         (c.ean is not null and exists (select 1 from public.product_identifiers i
            where i.product_id = p.id and i.id_type = 'ean' and i.value = c.ean))
           or upper(p.supplier_sku) = c.code or upper(p.internal_sku) = c.code
  from public.products p, c
  where p.archived_at is null
    and (
      (c.ean is not null and exists (select 1 from public.product_identifiers i
         where i.product_id = p.id and i.id_type = 'ean' and i.value = c.ean))
      or (length(c.code) >= 5 and (
           upper(p.supplier_sku) like c.code || '%' or upper(p.internal_sku) like c.code || '%'
           or exists (select 1 from public.product_identifiers i
                      where i.product_id = p.id and i.id_type = 'supplier_sku' and upper(i.value) like c.code || '%')))
    )
  order by p.id
  limit 20;
$$;

-- ---------------------------------------------------------------------
-- Aprovação de um item do catálogo
-- p_overrides: lista de campos em que o usuário escolheu substituir o valor
-- atual do produto pelo do catálogo (divergências). Os demais só preenchem
-- o que estiver vazio.
-- ---------------------------------------------------------------------
create or replace function public.approve_catalog_item(p_item_id uuid, p_product_id uuid, p_overrides text[] default '{}')
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  it   public.catalog_items;
  cat  public.supplier_catalogs;
  pg   public.catalog_pages;
  ref  text;
  ow   text[] := coalesce(p_overrides, '{}');
begin
  if not public.is_staff() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into it from public.catalog_items where id = p_item_id for update;
  if it.id is null then raise exception 'Item do catálogo não encontrado' using errcode = '23503'; end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Produto não encontrado' using errcode = '23503';
  end if;
  if exists (select 1 from unnest(ow) o where o not in ('height_mm','width_mm','depth_mm','weight_g','material','ean')) then
    raise exception 'Campo inválido para substituição' using errcode = '22023';
  end if;
  select * into cat from public.supplier_catalogs where id = it.catalog_id;
  select * into pg from public.catalog_pages where id = it.page_id;
  ref := format('Catálogo "%s", página %s', cat.name, pg.page_number);

  update public.products p set
    height_mm = case when 'height_mm' = any(ow) then coalesce(it.height_mm, p.height_mm) else coalesce(p.height_mm, it.height_mm) end,
    width_mm  = case when 'width_mm'  = any(ow) then coalesce(it.width_mm,  p.width_mm)  else coalesce(p.width_mm,  it.width_mm)  end,
    depth_mm  = case when 'depth_mm'  = any(ow) then coalesce(it.depth_mm,  p.depth_mm)  else coalesce(p.depth_mm,  it.depth_mm)  end,
    weight_g  = case when 'weight_g'  = any(ow) then coalesce(it.weight_g,  p.weight_g)  else coalesce(p.weight_g,  it.weight_g)  end,
    material  = case when 'material'  = any(ow) then coalesce(nullif(btrim(it.material), ''), p.material)
                     else coalesce(p.material, nullif(btrim(it.material), '')) end,
    ean       = case when 'ean' = any(ow) then coalesce(it.ean, p.ean) else coalesce(p.ean, it.ean) end,
    model     = coalesce(p.model, nullif(btrim(it.code), '')),
    collection = coalesce(p.collection, cat.name),
    collection_year = coalesce(p.collection_year, cat.collection_year)
  where p.id = p_product_id;

  -- Atributos extras com a fonte registrada (o confirmado anterior, se houver, é mantido)
  insert into public.product_attributes (product_id, attr_key, label, value_text, value_num, unit, source, source_ref, validation_status)
  select p_product_id, a.k, a.l, a.t, a.n, a.u, 'catalogo', ref,
         case when exists (select 1 from public.product_attributes x where x.product_id = p_product_id
                            and x.attr_key = a.k and x.validation_status = 'confirmada')
              then 'encontrada'::public.validation_status else 'confirmada'::public.validation_status end
  from (values
    ('preco_sugerido_catalogo', 'Preço sugerido (catálogo)', null::text, it.suggested_price::numeric, 'R$'),
    ('qtd_por_caixa', 'Quantidade por caixa', null, it.box_qty::numeric, 'un'),
    ('codigo_cor', 'Código de cor', nullif(btrim(it.color_code), ''), null, null),
    ('tamanho', 'Tamanho', nullif(btrim(it.size_label), ''), null, null),
    ('capacidade_catalogo', 'Capacidade (catálogo)', nullif(btrim(it.capacity_text), ''), null, null),
    ('codigo_catalogo', 'Código no catálogo', nullif(btrim(it.code), ''), null, null)
  ) as a(k, l, t, n, u)
  where (a.t is not null or a.n is not null)
    and not exists (select 1 from public.product_attributes x where x.product_id = p_product_id and x.attr_key = a.k
                    and coalesce(x.value_text, '') = coalesce(a.t, '') and x.value_num is not distinct from a.n);

  if it.features is not null and cardinality(it.features) > 0 then
    insert into public.product_attributes (product_id, attr_key, label, value_text, source, source_ref, validation_status)
    select p_product_id, 'destaques_catalogo', 'Destaques (catálogo)', array_to_string(it.features, '; '), 'catalogo', ref,
           case when exists (select 1 from public.product_attributes x where x.product_id = p_product_id
                              and x.attr_key = 'destaques_catalogo' and x.validation_status = 'confirmada')
                then 'encontrada'::public.validation_status else 'confirmada'::public.validation_status end;
  end if;

  -- Código do catálogo como identificador do produto (se ainda livre)
  if nullif(btrim(it.code), '') is not null and not exists (
       select 1 from public.product_identifiers where id_type = 'outro' and upper(value) = upper(btrim(it.code)) and product_id = p_product_id) then
    insert into public.product_identifiers (product_id, id_type, value, supplier_id, source, match_reason, confirmed_by, confirmed_at)
    values (p_product_id, 'outro', btrim(it.code), cat.supplier_id, 'catalogo', 'Código no ' || ref, auth.uid(), now());
  end if;

  update public.catalog_items
     set status = 'aprovado', product_id = p_product_id, reviewed_by = auth.uid(), reviewed_at = now(),
         match_reason = coalesce(match_reason, 'Aprovado na revisão'), updated_at = now()
   where id = p_item_id;
end;
$$;

-- ---------------------------------------------------------------------
-- updated_at, auditoria e RLS
-- ---------------------------------------------------------------------
create trigger supplier_catalogs_updated_at before update on public.supplier_catalogs
  for each row execute function public.set_updated_at();
create trigger catalog_items_updated_at before update on public.catalog_items
  for each row execute function public.set_updated_at();
create trigger supplier_catalogs_audit after insert or update or delete on public.supplier_catalogs
  for each row execute function public.audit_row();
create trigger catalog_items_audit after update or delete on public.catalog_items
  for each row execute function public.audit_row();

alter table public.supplier_catalogs enable row level security;
alter table public.catalog_pages enable row level security;
alter table public.catalog_items enable row level security;

create policy "catalogs: equipe consulta" on public.supplier_catalogs for select to authenticated using ((select public.is_staff()));
create policy "catalogs: equipe cadastra" on public.supplier_catalogs for insert to authenticated with check ((select public.is_staff()));
create policy "catalogs: equipe altera" on public.supplier_catalogs for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "catalogs: equipe exclui" on public.supplier_catalogs for delete to authenticated
  using ((select public.is_staff()));

create policy "catalog_pages: equipe consulta" on public.catalog_pages for select to authenticated using ((select public.is_staff()));
create policy "catalog_pages: equipe cadastra" on public.catalog_pages for insert to authenticated with check ((select public.is_staff()));
create policy "catalog_pages: equipe altera" on public.catalog_pages for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "catalog_items: equipe consulta" on public.catalog_items for select to authenticated using ((select public.is_staff()));
create policy "catalog_items: equipe cadastra" on public.catalog_items for insert to authenticated
  with check ((select public.is_staff()) and status <> 'aprovado');
-- Aprovação só pela função approve_catalog_item; edição livre enquanto não aprovado
create policy "catalog_items: equipe altera" on public.catalog_items for update to authenticated
  using ((select public.is_staff()) and status <> 'aprovado') with check ((select public.is_staff()) and status <> 'aprovado');
create policy "catalog_items: equipe remove pendentes" on public.catalog_items for delete to authenticated
  using ((select public.is_staff()) and status <> 'aprovado');

-- Imagens das páginas: leitura e envio pela equipe já existem (0001). Permite reenviar a mesma
-- página (retomada de envio interrompido) no bucket de catálogos.
create policy "storage: equipe reenvia páginas de catálogo" on storage.objects
  for update to authenticated
  using (bucket_id = 'catalogs' and (select public.is_staff()))
  with check (bucket_id = 'catalogs' and (select public.is_staff()));
create policy "storage: equipe exclui páginas de catálogo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'catalogs' and (select public.is_staff()));

revoke all on public.supplier_catalogs, public.catalog_pages, public.catalog_items, public.catalog_overview from anon;
revoke execute on function public.match_catalog_code(text, text) from public, anon;
revoke execute on function public.approve_catalog_item(uuid, uuid, text[]) from public, anon;
grant execute on function public.match_catalog_code(text, text) to authenticated;
grant execute on function public.approve_catalog_item(uuid, uuid, text[]) to authenticated;
