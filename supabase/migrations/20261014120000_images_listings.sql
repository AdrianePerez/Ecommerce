-- =====================================================================
-- 0008 · Fase 4 (sem IA): galeria de imagens, fontes de pesquisa,
--        regras por marketplace e preparação de anúncios
--  * product_images: arquivo no bucket privado product-images; o original
--    nunca é sobrescrito — versões tratadas (ex.: editadas no Canva) são
--    novas linhas com parent_image_id apontando para a original.
--  * product_research_sources: de onde veio uma informação (site do
--    fabricante, distribuidor, anúncio...). Atributos podem apontar para a
--    fonte. A pesquisa automática com IA (fase 4b) vai gravar aqui também.
--  * marketplace_configs: limites e campos obrigatórios por canal, editáveis
--    em Configurações (cada canal tem regras próprias).
--  * product_listings: dados do anúncio por canal, separados do cadastro
--    mestre. Nada é publicado automaticamente.
--  * listing_assets: imagens do anúncio, em ordem.
--  * Validação no servidor: o anúncio só passa para "pronto para publicar"
--    com os campos obrigatórios do canal preenchidos.
-- =====================================================================

create type public.image_kind as enum ('oficial', 'tecnica', 'detalhe', 'referencia', 'capa', 'gerada_editada');
create type public.image_status as enum ('aguardando_revisao', 'aprovada', 'rejeitada');
create type public.image_rights as enum ('a_verificar', 'autorizada', 'fornecedor', 'propria', 'nao_autorizada');
create type public.source_type as enum ('fabricante', 'catalogo_oficial', 'distribuidor', 'marketplace', 'loja', 'outro');
create type public.listing_status as enum ('rascunho', 'em_revisao', 'pronto_para_publicar', 'publicado', 'arquivado');

-- ---------------------------------------------------------------------
-- Fontes de pesquisa
-- ---------------------------------------------------------------------
create table public.product_research_sources (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  source_type   public.source_type not null default 'outro',
  title         text not null check (length(btrim(title)) > 0),
  url           text check (url is null or url ~* '^https?://'),
  accessed_on   date not null default current_date,
  accessible    boolean not null default true,
  notes         text,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index product_research_sources_product_idx on public.product_research_sources (product_id);
comment on table public.product_research_sources is 'Fontes consultadas para um produto (manual ou pesquisa). accessible=false registra fonte bloqueada/indisponível.';

alter table public.product_attributes
  add column research_source_id uuid references public.product_research_sources (id) on delete set null;
create index product_attributes_source_idx on public.product_attributes (research_source_id) where research_source_id is not null;

-- ---------------------------------------------------------------------
-- Imagens
-- ---------------------------------------------------------------------
create table public.product_images (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products (id) on delete restrict,
  parent_image_id  uuid references public.product_images (id) on delete restrict,
  storage_path     text not null unique,
  file_name        text,
  mime_type        text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  width            integer check (width > 0),
  height           integer check (height > 0),
  bytes            integer check (bytes > 0),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  kind             public.image_kind not null default 'referencia',
  status           public.image_status not null default 'aguardando_revisao',
  rights           public.image_rights not null default 'a_verificar',
  rights_notes     text,
  source           public.data_source not null default 'manual',
  source_url       text check (source_url is null or source_url ~* '^https?://'),
  source_ref       text,
  research_source_id uuid references public.product_research_sources (id) on delete set null,
  catalog_item_id  uuid unique references public.catalog_items (id) on delete set null,
  is_main          boolean not null default false,
  position         integer not null default 0,
  notes            text,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint product_images_main_approved check (not is_main or (status = 'aprovada' and rights <> 'nao_autorizada')),
  constraint product_images_no_self_parent check (parent_image_id is distinct from id)
);
create unique index product_images_sha_key on public.product_images (product_id, sha256);
create unique index product_images_one_main on public.product_images (product_id) where is_main;
create index product_images_product_idx on public.product_images (product_id, position);
create index product_images_status_idx on public.product_images (status);
comment on table public.product_images is 'Galeria do produto. Versões tratadas são novas linhas (parent_image_id); o original não é sobrescrito.';

-- Versão tratada precisa ser do mesmo produto
create or replace function public.check_image_parent()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_image_id is not null and not exists (
    select 1 from public.product_images p where p.id = new.parent_image_id and p.product_id = new.product_id
  ) then
    raise exception 'A versão tratada precisa ser do mesmo produto da imagem original.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.storage_path <> old.storage_path then
    raise exception 'O arquivo de uma imagem não pode ser trocado; envie uma nova versão.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger product_images_parent before insert or update on public.product_images
  for each row execute function public.check_image_parent();

-- Define a imagem principal (desmarca a anterior na mesma transação)
create or replace function public.set_main_image(p_image_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_product uuid;
begin
  select product_id into v_product from public.product_images where id = p_image_id;
  if v_product is null then raise exception 'Imagem não encontrada.' using errcode = 'P0002'; end if;
  update public.product_images set is_main = false where product_id = v_product and is_main and id <> p_image_id;
  update public.product_images set is_main = true where id = p_image_id;
end $$;

-- Reordena as imagens de um produto conforme a lista recebida
create or replace function public.reorder_product_images(p_product_id uuid, p_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.product_images i set position = o.ord
  from unnest(p_ids) with ordinality as o(id, ord)
  where i.id = o.id and i.product_id = p_product_id;
end $$;

-- ---------------------------------------------------------------------
-- Regras por marketplace
-- ---------------------------------------------------------------------
create table public.marketplace_configs (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique check (code ~ '^[a-z0-9_]{2,40}$'),
  name                  text not null,
  active                boolean not null default true,
  title_min             integer check (title_min >= 0),
  title_max             integer check (title_max > 0),
  description_max       integer check (description_max > 0),
  description_plain_text boolean not null default true,
  images_min            integer not null default 1 check (images_min >= 0),
  images_max            integer check (images_max > 0),
  keywords_max          integer check (keywords_max >= 0),
  -- Campos do anúncio exigidos: title, description, category, main_image, price, keywords, ean
  required_fields       text[] not null default '{title,description,main_image}',
  -- Atributos do canal: [{"key":"marca","label":"Marca","required":true}]
  attribute_fields      jsonb not null default '[]' check (jsonb_typeof(attribute_fields) = 'array'),
  rules_notes           text,
  rules_checked_on      date,
  updated_at            timestamptz not null default now(),
  constraint marketplace_title_range check (title_min is null or title_max is null or title_min <= title_max),
  constraint marketplace_required_known check (
    required_fields <@ array['title','description','category','main_image','price','keywords','ean']::text[]
  )
);
comment on table public.marketplace_configs is 'Regras por canal (limites, campos obrigatórios). Valores conferidos manualmente; data em rules_checked_on.';

insert into public.marketplace_configs
  (code, name, active, title_min, title_max, description_max, description_plain_text, images_min, images_max, keywords_max,
   required_fields, attribute_fields, rules_notes, rules_checked_on)
values
  ('mercado_livre', 'Mercado Livre', true, null, 60, 50000, true, 1, 12, null,
   '{title,description,category,main_image,price}',
   '[{"key":"marca","label":"Marca","required":true},{"key":"modelo","label":"Modelo","required":true},
     {"key":"gtin","label":"Código universal (EAN)","required":false},{"key":"personagem","label":"Personagem","required":false},
     {"key":"genero","label":"Gênero","required":false},{"key":"idade","label":"Idade recomendada","required":false}]',
   'Título até 60 caracteres; descrição só texto (sem HTML nem imagens). Atributos obrigatórios variam por categoria — conferir no anúncio. Limite de fotos: conferir no Mercado Livre.',
   '2026-10-13'),
  ('tiktok_shop', 'TikTok Shop', true, null, 300, null, false, 1, 9, null,
   '{title,description,category,main_image,price}',
   '[{"key":"marca","label":"Marca (ou \"Sem marca\")","required":true},{"key":"peso_envio","label":"Peso de envio","required":true},
     {"key":"dimensoes_pacote","label":"Dimensões do pacote","required":true}]',
   'Nome até 300 caracteres; até 9 imagens JPG/PNG de até 5 MB, proporção entre 3:4 e 4:3. Peso e dimensões do pacote obrigatórios. Limite da descrição: conferir no Seller Center.',
   '2026-10-13'),
  ('shopee', 'Shopee', false, null, null, null, true, 1, null, null, '{title,description,main_image}', '[]',
   'Ainda não configurado — preencher os limites antes de usar.', null),
  ('amazon', 'Amazon', false, null, null, null, true, 1, null, null, '{title,description,main_image}', '[]',
   'Ainda não configurado — preencher os limites antes de usar.', null);

-- ---------------------------------------------------------------------
-- Anúncios (preparação para publicação manual)
-- ---------------------------------------------------------------------
create table public.product_listings (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references public.products (id) on delete restrict,
  marketplace_id     uuid not null references public.marketplace_configs (id) on delete restrict,
  variant_label      text not null default '',
  title              text,
  description        text,
  category_suggested text,
  category_external_id text,
  attributes         jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  keywords           text[] not null default '{}',
  suggested_price    numeric(12, 2) check (suggested_price > 0),
  main_image_id      uuid references public.product_images (id) on delete set null,
  status             public.listing_status not null default 'rascunho',
  last_reviewed_at   timestamptz,
  reviewed_by        uuid references auth.users (id) on delete set null,
  external_id        text,
  external_url       text check (external_url is null or external_url ~* '^https?://'),
  notes              text,
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index product_listings_one_active on public.product_listings (product_id, marketplace_id, variant_label)
  where status <> 'arquivado';
create index product_listings_status_idx on public.product_listings (status);
create index product_listings_marketplace_idx on public.product_listings (marketplace_id);
comment on table public.product_listings is 'Ficha do anúncio por canal. Separada do cadastro mestre; publicação é manual.';

create table public.listing_assets (
  listing_id  uuid not null references public.product_listings (id) on delete cascade,
  image_id    uuid not null references public.product_images (id) on delete restrict,
  position    integer not null default 0,
  primary key (listing_id, image_id)
);
create index listing_assets_image_idx on public.listing_assets (image_id);

-- Imagens do anúncio precisam ser do mesmo produto e estar aprovadas
create or replace function public.check_listing_image()
returns trigger language plpgsql set search_path = '' as $$
declare v_img uuid; v_product uuid;
begin
  if tg_table_name = 'listing_assets' then
    v_img := new.image_id;
    select product_id into v_product from public.product_listings where id = new.listing_id;
  else
    v_img := new.main_image_id;
    v_product := new.product_id;
  end if;
  if v_img is not null and not exists (
    select 1 from public.product_images i where i.id = v_img and i.product_id = v_product and i.status = 'aprovada'
      and i.rights <> 'nao_autorizada'
  ) then
    raise exception 'Use apenas imagens aprovadas (com uso permitido) do próprio produto no anúncio.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger listing_assets_check before insert or update on public.listing_assets
  for each row execute function public.check_listing_image();
create trigger product_listings_check_image before insert or update of main_image_id, product_id on public.product_listings
  for each row execute function public.check_listing_image();

-- Pendências do anúncio conforme as regras do canal (usada na tela e na validação)
create or replace function public.listing_row_issues(l public.product_listings)
returns text[] language plpgsql stable security invoker set search_path = '' as $$
declare
  m public.marketplace_configs;
  issues text[] := '{}';
  n_img integer;
  f jsonb;
  v_ean text;
begin
  select * into m from public.marketplace_configs where id = l.marketplace_id;
  select count(*) into n_img from public.listing_assets where listing_id = l.id;
  if l.main_image_id is not null and not exists (select 1 from public.listing_assets where listing_id = l.id and image_id = l.main_image_id) then
    n_img := n_img + 1;
  end if;

  if 'title' = any (m.required_fields) and coalesce(btrim(l.title), '') = '' then issues := array_append(issues, 'Título não preenchido'); end if;
  if m.title_max is not null and length(coalesce(l.title, '')) > m.title_max then
    issues := array_append(issues, format('Título com %s caracteres (máximo %s)', length(l.title), m.title_max)); end if;
  if m.title_min is not null and coalesce(btrim(l.title), '') <> '' and length(l.title) < m.title_min then
    issues := array_append(issues, format('Título com %s caracteres (mínimo %s)', length(l.title), m.title_min)); end if;
  if 'description' = any (m.required_fields) and coalesce(btrim(l.description), '') = '' then issues := array_append(issues, 'Descrição não preenchida'); end if;
  if m.description_max is not null and length(coalesce(l.description, '')) > m.description_max then
    issues := array_append(issues, format('Descrição com %s caracteres (máximo %s)', length(l.description), m.description_max)); end if;
  if m.description_plain_text and l.description ~ '<[a-zA-Z/][^>]*>' then
    issues := array_append(issues, 'Descrição contém HTML, e este canal aceita só texto'); end if;
  if 'category' = any (m.required_fields) and coalesce(btrim(l.category_suggested), '') = '' and coalesce(btrim(l.category_external_id), '') = '' then
    issues := array_append(issues, 'Categoria não informada'); end if;
  if 'main_image' = any (m.required_fields) and l.main_image_id is null then issues := array_append(issues, 'Imagem principal não escolhida'); end if;
  if l.main_image_id is not null and not exists (
    select 1 from public.product_images i where i.id = l.main_image_id and i.status = 'aprovada' and i.rights <> 'nao_autorizada'
  ) then issues := array_append(issues, 'Imagem principal não está aprovada ou não tem uso permitido'); end if;
  if exists (
    select 1 from public.listing_assets a join public.product_images i on i.id = a.image_id
    where a.listing_id = l.id and (i.status <> 'aprovada' or i.rights = 'nao_autorizada')
  ) then issues := array_append(issues, 'Há imagens no anúncio que não estão aprovadas ou sem uso permitido'); end if;
  if n_img < m.images_min then issues := array_append(issues, format('Mínimo de %s imagem(ns)', m.images_min)); end if;
  if m.images_max is not null and n_img > m.images_max then issues := array_append(issues, format('%s imagens (máximo %s)', n_img, m.images_max)); end if;
  if 'price' = any (m.required_fields) and l.suggested_price is null then issues := array_append(issues, 'Preço não informado'); end if;
  if 'keywords' = any (m.required_fields) and cardinality(l.keywords) = 0 then issues := array_append(issues, 'Palavras-chave não informadas'); end if;
  if m.keywords_max is not null and cardinality(l.keywords) > m.keywords_max then
    issues := array_append(issues, format('%s palavras-chave (máximo %s)', cardinality(l.keywords), m.keywords_max)); end if;
  if 'ean' = any (m.required_fields) then
    select ean into v_ean from public.products where id = l.product_id;
    if v_ean is null then issues := array_append(issues, 'Produto sem EAN'); end if;
  end if;
  for f in select * from jsonb_array_elements(m.attribute_fields) loop
    if coalesce((f->>'required')::boolean, false) and coalesce(btrim(l.attributes->>(f->>'key')), '') = '' then
      issues := array_append(issues, format('Atributo "%s" não preenchido', f->>'label'));
    end if;
  end loop;
  return issues;
end $$;

create or replace function public.listing_issues(p_listing_id uuid)
returns text[] language sql stable security invoker set search_path = '' as $$
  select coalesce((select public.listing_row_issues(l) from public.product_listings l where l.id = p_listing_id),
                  array['Anúncio não encontrado']);
$$;

-- Não deixa marcar como pronto/publicado com pendências; registra a revisão
create or replace function public.listing_status_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_issues text[];
begin
  if new.status in ('pronto_para_publicar', 'publicado')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    v_issues := public.listing_row_issues(new);
    if cardinality(v_issues) > 0 then
      raise exception 'ANUNCIO_INCOMPLETO:%', array_to_string(v_issues, '; ') using errcode = '23514';
    end if;
    new.last_reviewed_at := now();
    new.reviewed_by := auth.uid();
  end if;
  return new;
end $$;
-- Checa a linha NOVA (título e situação podem mudar no mesmo salvamento)
create trigger product_listings_status_guard before update of status on public.product_listings
  for each row execute function public.listing_status_guard();
create or replace function public.listing_insert_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status not in ('rascunho', 'em_revisao') then
    raise exception 'Crie o anúncio como rascunho e depois marque como pronto.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger product_listings_insert_guard before insert on public.product_listings
  for each row execute function public.listing_insert_guard();

-- ---------------------------------------------------------------------
-- Gatilhos padrão
-- ---------------------------------------------------------------------
create trigger product_research_sources_updated_at before update on public.product_research_sources
  for each row execute function public.set_updated_at();
create trigger product_images_updated_at before update on public.product_images
  for each row execute function public.set_updated_at();
create trigger marketplace_configs_updated_at before update on public.marketplace_configs
  for each row execute function public.set_updated_at();
create trigger product_listings_updated_at before update on public.product_listings
  for each row execute function public.set_updated_at();

create trigger product_research_sources_audit after insert or update or delete on public.product_research_sources
  for each row execute function public.audit_row();
create trigger product_images_audit after insert or update or delete on public.product_images
  for each row execute function public.audit_row();
create trigger marketplace_configs_audit after insert or update or delete on public.marketplace_configs
  for each row execute function public.audit_row();
create trigger product_listings_audit after insert or update or delete on public.product_listings
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.product_research_sources enable row level security;
alter table public.product_images enable row level security;
alter table public.marketplace_configs enable row level security;
alter table public.product_listings enable row level security;
alter table public.listing_assets enable row level security;

create policy "research_sources: equipe consulta" on public.product_research_sources for select to authenticated using ((select public.is_staff()));
create policy "research_sources: equipe cria" on public.product_research_sources for insert to authenticated with check ((select public.is_staff()));
create policy "research_sources: equipe altera" on public.product_research_sources for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "research_sources: equipe remove" on public.product_research_sources for delete to authenticated using ((select public.is_staff()));

create policy "product_images: equipe consulta" on public.product_images for select to authenticated using ((select public.is_staff()));
create policy "product_images: equipe cria" on public.product_images for insert to authenticated with check ((select public.is_staff()));
create policy "product_images: equipe altera" on public.product_images for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
-- Imagem aprovada não é excluída (rejeitar primeiro); usada em anúncio é protegida pela FK
create policy "product_images: equipe remove não aprovadas" on public.product_images for delete to authenticated
  using ((select public.is_staff()) and status <> 'aprovada');

create policy "marketplace_configs: equipe consulta" on public.marketplace_configs for select to authenticated using ((select public.is_staff()));
create policy "marketplace_configs: admin altera" on public.marketplace_configs for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "product_listings: equipe consulta" on public.product_listings for select to authenticated using ((select public.is_staff()));
create policy "product_listings: equipe cria" on public.product_listings for insert to authenticated with check ((select public.is_staff()));
create policy "product_listings: equipe altera" on public.product_listings for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "listing_assets: equipe consulta" on public.listing_assets for select to authenticated using ((select public.is_staff()));
create policy "listing_assets: equipe cria" on public.listing_assets for insert to authenticated with check ((select public.is_staff()));
create policy "listing_assets: equipe altera" on public.listing_assets for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "listing_assets: equipe remove" on public.listing_assets for delete to authenticated using ((select public.is_staff()));

create policy "storage: equipe exclui imagens de produto" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_staff()));

-- Privilégios
revoke all on public.product_research_sources, public.product_images, public.marketplace_configs,
  public.product_listings, public.listing_assets from anon;
revoke delete on public.product_listings, public.marketplace_configs from authenticated;
revoke insert on public.marketplace_configs from authenticated;
revoke execute on function public.check_image_parent(), public.check_listing_image(), public.listing_status_guard(),
  public.listing_insert_guard() from public, anon, authenticated;
revoke execute on function public.set_main_image(uuid), public.reorder_product_images(uuid, uuid[]),
  public.listing_issues(uuid), public.listing_row_issues(public.product_listings) from public, anon;
grant execute on function public.set_main_image(uuid), public.reorder_product_images(uuid, uuid[]),
  public.listing_issues(uuid), public.listing_row_issues(public.product_listings) to authenticated;
