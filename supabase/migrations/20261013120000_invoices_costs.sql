-- =====================================================================
-- 0004 · Entrada de mercadorias (NF-e) e histórico de custos
--
-- Regras centrais:
--  * Uma NF-e só entra uma vez (chave de acesso única).
--  * Notas, itens e custos só são gravados pelas funções import_invoice()
--    e relink_invoice_item(), em uma única transação. Usuários não
--    inserem/alteram essas tabelas diretamente.
--  * O histórico de custo nunca é sobrescrito: correções geram estorno.
--  * A regra de custo é versionada; cada lançamento guarda a regra usada
--    e todos os componentes separadamente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Regra de custo (gerencial, configurável e versionada)
-- ---------------------------------------------------------------------
create table public.cost_rules (
  id                uuid primary key default gen_random_uuid(),
  version           integer not null unique check (version > 0),
  name              text not null,
  include_ipi       boolean not null default true,
  include_freight   boolean not null default false,
  include_insurance boolean not null default false,
  include_other     boolean not null default false,
  include_st        boolean not null default false,
  subtract_discount boolean not null default false,
  is_active         boolean not null default false,
  notes             text,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now()
);
create unique index cost_rules_single_active on public.cost_rules (is_active) where is_active;
comment on table public.cost_rules is 'Regras gerenciais de custo de aquisição. Uma ativa por vez; cada lançamento registra a regra usada.';

insert into public.cost_rules (version, name, include_ipi, is_active, notes)
values (1, 'Gerencial simplificada: (produtos + IPI) ÷ quantidade', true, true,
        'Regra inicial. Frete, seguro, outras despesas, ICMS-ST e descontos ficam registrados separadamente, mas não entram no custo.');

-- ---------------------------------------------------------------------
-- Notas fiscais
-- ---------------------------------------------------------------------
create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  access_key       text not null unique check (access_key ~ '^\d{44}$'),
  number           text not null,
  series           text,
  model            text not null default '55',
  issued_at        timestamptz not null,
  nature           text,
  purpose          smallint check (purpose between 1 and 4),
  supplier_id      uuid not null references public.suppliers (id) on delete restrict,
  issuer_cnpj      text not null,
  issuer_name      text not null,
  recipient_doc    text,
  total_products   numeric(15, 2) not null default 0,
  total_freight    numeric(15, 2) not null default 0,
  total_insurance  numeric(15, 2) not null default 0,
  total_discount   numeric(15, 2) not null default 0,
  total_ipi        numeric(15, 2) not null default 0,
  total_st         numeric(15, 2) not null default 0,
  total_other      numeric(15, 2) not null default 0,
  total_invoice    numeric(15, 2) not null default 0,
  protocol_status  text,
  xml_path         text,
  xml_sha256       text,
  notes            text,
  imported_by      uuid default auth.uid() references auth.users (id) on delete set null,
  imported_at      timestamptz not null default now()
);
create index invoices_supplier_idx on public.invoices (supplier_id, issued_at desc);
create index invoices_issued_idx on public.invoices (issued_at desc);
comment on table public.invoices is 'NF-e de compra importadas. A chave de acesso impede importação duplicada.';

create type public.match_method as enum ('ean', 'supplier_sku', 'manual', 'novo', 'ignorado');

create table public.invoice_items (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.invoices (id) on delete restrict,
  item_number        integer not null check (item_number > 0),
  product_id         uuid references public.products (id) on delete restrict,
  supplier_code      text not null,
  ean                text,
  ean_trib           text,
  description        text not null,
  ncm                text,
  cest               text,
  cfop               text,
  fiscal_origin      smallint,
  unit_com           text,
  qty_com            numeric(15, 4) not null check (qty_com > 0),
  unit_price_com     numeric(21, 10),
  unit_trib          text,
  qty_trib           numeric(15, 4),
  total_products     numeric(15, 2) not null check (total_products >= 0),
  discount           numeric(15, 2) not null default 0,
  freight            numeric(15, 2) not null default 0,
  insurance          numeric(15, 2) not null default 0,
  other              numeric(15, 2) not null default 0,
  ipi_rate           numeric(7, 4),
  ipi_value          numeric(15, 2) not null default 0,
  st_value           numeric(15, 2) not null default 0,
  conversion_factor  numeric(12, 4) not null default 1 check (conversion_factor > 0),
  base_qty           numeric(15, 4) generated always as (qty_com * conversion_factor) stored,
  match_method       public.match_method not null,
  match_reason       text,
  unique (invoice_id, item_number),
  constraint invoice_items_link check ((product_id is null) = (match_method = 'ignorado'))
);
create index invoice_items_product_idx on public.invoice_items (product_id);
comment on table public.invoice_items is 'Itens das notas com os valores originais. conversion_factor converte a unidade comercial em unidades do produto.';
comment on column public.invoice_items.conversion_factor is 'Unidades do produto por unidade comercial da nota (ex.: CX com 12 = 12).';

-- Origem do identificador quando ele veio de um item de nota (permite desfazer vínculo errado)
alter table public.product_identifiers
  add column source_invoice_item_id uuid references public.invoice_items (id) on delete set null;
create index product_identifiers_source_item_idx on public.product_identifiers (source_invoice_item_id);

-- ---------------------------------------------------------------------
-- Histórico de custos (somente inclusão; correções por estorno)
-- ---------------------------------------------------------------------
create type public.cost_entry_type as enum ('entrada', 'estorno');

create table public.product_cost_history (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products (id) on delete restrict,
  invoice_item_id  uuid not null references public.invoice_items (id) on delete restrict,
  entry_type       public.cost_entry_type not null,
  occurred_at      timestamptz not null,
  supplier_id      uuid references public.suppliers (id) on delete restrict,
  quantity         numeric(15, 4) not null check (quantity <> 0),
  products_value   numeric(15, 2) not null,
  ipi_value        numeric(15, 2) not null default 0,
  freight_value    numeric(15, 2) not null default 0,
  insurance_value  numeric(15, 2) not null default 0,
  other_value      numeric(15, 2) not null default 0,
  st_value         numeric(15, 2) not null default 0,
  discount_value   numeric(15, 2) not null default 0,
  cost_total       numeric(15, 4) not null,
  unit_cost        numeric(15, 6) not null,
  cost_rule_id     uuid not null references public.cost_rules (id) on delete restrict,
  is_reversed      boolean not null default false,
  reverses_id      uuid references public.product_cost_history (id) on delete restrict,
  reason           text,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint cost_sign check (
    (entry_type = 'entrada' and quantity > 0 and reverses_id is null) or
    (entry_type = 'estorno' and quantity < 0 and reverses_id is not null and not is_reversed)
  )
);
create unique index cost_history_one_active_entry on public.product_cost_history (invoice_item_id)
  where entry_type = 'entrada' and not is_reversed;
create index cost_history_product_idx on public.product_cost_history (product_id, occurred_at desc);
create index cost_history_supplier_idx on public.product_cost_history (supplier_id);
create index cost_history_rule_idx on public.product_cost_history (cost_rule_id);
create index cost_history_reverses_idx on public.product_cost_history (reverses_id);
comment on table public.product_cost_history is 'Lançamentos de custo por entrada. Nunca alterados; vínculos corrigidos geram estorno e nova entrada.';

-- Resumo por produto: custo médio ponderado e última compra
create view public.product_cost_summary
with (security_invoker = true) as
with active as (
  select * from public.product_cost_history where entry_type = 'entrada' and not is_reversed
),
last_entry as (
  select distinct on (product_id) product_id, unit_cost, occurred_at, supplier_id, quantity
  from active order by product_id, occurred_at desc, created_at desc
)
select
  a.product_id,
  count(*)::int                                   as entries,
  sum(a.quantity)                                 as total_quantity,
  sum(a.cost_total)                               as total_cost,
  round(sum(a.cost_total) / sum(a.quantity), 6)   as average_unit_cost,
  l.unit_cost                                     as last_unit_cost,
  l.occurred_at                                   as last_purchase_at,
  l.supplier_id                                   as last_supplier_id,
  l.quantity                                      as last_quantity
from active a
join last_entry l on l.product_id = a.product_id
group by a.product_id, l.unit_cost, l.occurred_at, l.supplier_id, l.quantity;
comment on view public.product_cost_summary is 'Custo médio ponderado = soma dos custos das entradas vigentes ÷ soma das quantidades. Regra gerencial simplificada, não é custo contábil.';

-- ---------------------------------------------------------------------
-- Cálculo do custo de um item (fonte única da regra no banco)
-- ---------------------------------------------------------------------
create or replace function public.compute_item_cost(
  p_rule public.cost_rules,
  p_products numeric, p_ipi numeric, p_freight numeric, p_insurance numeric,
  p_other numeric, p_st numeric, p_discount numeric
) returns numeric
language sql immutable
set search_path = ''
as $$
  select p_products
       + case when p_rule.include_ipi       then p_ipi       else 0 end
       + case when p_rule.include_freight   then p_freight   else 0 end
       + case when p_rule.include_insurance then p_insurance else 0 end
       + case when p_rule.include_other     then p_other     else 0 end
       + case when p_rule.include_st        then p_st        else 0 end
       - case when p_rule.subtract_discount then p_discount  else 0 end;
$$;

-- ---------------------------------------------------------------------
-- Importação transacional
-- p_payload = {
--   invoice: { access_key, number, series, model, issued_at, nature, purpose,
--              issuer_cnpj, issuer_name, issuer_trade_name, recipient_doc,
--              totals: {products, freight, insurance, discount, ipi, st, other, invoice},
--              protocol_status, xml_path, xml_sha256 },
--   items: [ { item_number, supplier_code, ean, ean_trib, description, ncm, cest, cfop,
--              fiscal_origin, unit_com, qty_com, unit_price_com, unit_trib, qty_trib,
--              total_products, discount, freight, insurance, other, ipi_rate, ipi_value,
--              st_value, conversion_factor,
--              action: 'link'|'create'|'ignore', product_id, match_method, match_reason } ]
-- }
-- ---------------------------------------------------------------------
create or replace function public.import_invoice(p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  inv        jsonb := p_payload -> 'invoice';
  it         jsonb;
  v_rule     public.cost_rules;
  v_supplier uuid;
  v_invoice  uuid;
  v_item     uuid;
  v_product  uuid;
  v_existing uuid;
  v_action   text;
  v_method   public.match_method;
  v_factor   numeric;
  v_base_qty numeric;
  v_cost     numeric;
  v_issued   timestamptz;
  v_cnpj     text;
  v_ean      text;
  v_code     text;
  v_reason   text;
  v_count    int := 0;
begin
  if not public.is_staff() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if inv is null or jsonb_typeof(p_payload -> 'items') <> 'array'
     or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'Dados da nota incompletos' using errcode = '22023';
  end if;

  -- Duplicidade (verificação amigável; a constraint unique garante de qualquer forma)
  select id into v_existing from public.invoices where access_key = inv ->> 'access_key';
  if v_existing is not null then
    raise exception 'NOTA_JA_IMPORTADA:%', v_existing using errcode = '23505';
  end if;

  if coalesce((inv ->> 'purpose')::int, 1) <> 1 then
    raise exception 'Somente notas de finalidade normal podem ser importadas nesta versão' using errcode = '22023';
  end if;

  select * into v_rule from public.cost_rules where is_active;
  if v_rule.id is null then
    raise exception 'Nenhuma regra de custo ativa' using errcode = '22023';
  end if;

  -- Fornecedor pelo CNPJ (cria se não existir)
  v_cnpj := regexp_replace(coalesce(inv ->> 'issuer_cnpj', ''), '\D', '', 'g');
  if v_cnpj !~ '^\d{14}$' then
    raise exception 'CNPJ do emitente inválido' using errcode = '22023';
  end if;
  select id into v_supplier from public.suppliers where cnpj = v_cnpj;
  if v_supplier is null then
    insert into public.suppliers (name, trade_name, cnpj, notes)
    values (inv ->> 'issuer_name', nullif(inv ->> 'issuer_trade_name', ''), v_cnpj,
            'Cadastrado automaticamente na importação da NF-e ' || (inv ->> 'number'))
    returning id into v_supplier;
  end if;

  v_issued := (inv ->> 'issued_at')::timestamptz;

  insert into public.invoices (
    access_key, number, series, model, issued_at, nature, purpose, supplier_id,
    issuer_cnpj, issuer_name, recipient_doc,
    total_products, total_freight, total_insurance, total_discount, total_ipi, total_st, total_other, total_invoice,
    protocol_status, xml_path, xml_sha256
  ) values (
    inv ->> 'access_key', inv ->> 'number', nullif(inv ->> 'series', ''), coalesce(inv ->> 'model', '55'),
    v_issued, inv ->> 'nature', coalesce((inv ->> 'purpose')::smallint, 1), v_supplier,
    v_cnpj, inv ->> 'issuer_name', nullif(inv ->> 'recipient_doc', ''),
    coalesce((inv #>> '{totals,products}')::numeric, 0), coalesce((inv #>> '{totals,freight}')::numeric, 0),
    coalesce((inv #>> '{totals,insurance}')::numeric, 0), coalesce((inv #>> '{totals,discount}')::numeric, 0),
    coalesce((inv #>> '{totals,ipi}')::numeric, 0), coalesce((inv #>> '{totals,st}')::numeric, 0),
    coalesce((inv #>> '{totals,other}')::numeric, 0), coalesce((inv #>> '{totals,invoice}')::numeric, 0),
    nullif(inv ->> 'protocol_status', ''), nullif(inv ->> 'xml_path', ''), nullif(inv ->> 'xml_sha256', '')
  ) returning id into v_invoice;

  for it in select * from jsonb_array_elements(p_payload -> 'items') loop
    v_action := it ->> 'action';
    v_factor := coalesce((it ->> 'conversion_factor')::numeric, 1);
    v_ean    := nullif(it ->> 'ean', '');
    v_code   := it ->> 'supplier_code';
    v_product := null;

    if v_factor <= 0 then
      raise exception 'Item %: fator de conversão deve ser maior que zero', it ->> 'item_number' using errcode = '22023';
    end if;

    if v_action = 'link' then
      v_product := (it ->> 'product_id')::uuid;
      if not exists (select 1 from public.products where id = v_product) then
        raise exception 'Item %: produto vinculado não encontrado', it ->> 'item_number' using errcode = '23503';
      end if;
      v_method := coalesce(nullif(it ->> 'match_method', ''), 'manual')::public.match_method;
      if v_method in ('novo', 'ignorado') then v_method := 'manual'; end if;
    elsif v_action = 'create' then
      v_method := 'novo';
    elsif v_action = 'ignore' then
      v_method := 'ignorado';
    else
      raise exception 'Item %: ação inválida (%)', it ->> 'item_number', v_action using errcode = '22023';
    end if;

    -- Conflitos de identificador: EAN/código da nota já pertencem a OUTRO produto?
    if v_action = 'link' then
      if v_ean is not null and exists (
        select 1 from public.product_identifiers
        where id_type = 'ean' and value = v_ean and product_id <> v_product) then
        raise exception 'Item %: o EAN % pertence a outro produto. Revise o vínculo.', it ->> 'item_number', v_ean
          using errcode = '23505';
      end if;
      if exists (
        select 1 from public.product_identifiers
        where id_type = 'supplier_sku' and supplier_id = v_supplier
          and lower(value) = lower(v_code) and product_id <> v_product) then
        raise exception 'Item %: o código % deste fornecedor pertence a outro produto. Revise o vínculo.',
          it ->> 'item_number', v_code using errcode = '23505';
      end if;
    end if;

    if v_action = 'create' then
      insert into public.products (
        nf_description, supplier_sku, ean, main_supplier_id, ncm, cest, fiscal_origin, fiscal_source, unit, status
      ) values (
        it ->> 'description', v_code, v_ean, v_supplier,
        nullif(it ->> 'ncm', ''), nullif(it ->> 'cest', ''), (it ->> 'fiscal_origin')::smallint,
        case when nullif(it ->> 'ncm', '') is not null or nullif(it ->> 'cest', '') is not null
                  or (it ->> 'fiscal_origin') is not null then 'nfe'::public.data_source end,
        case when v_factor = 1 then nullif(it ->> 'unit_com', '') else 'UN' end,
        'novo'
      ) returning id into v_product;
    end if;

    insert into public.invoice_items (
      invoice_id, item_number, product_id, supplier_code, ean, ean_trib, description, ncm, cest, cfop,
      fiscal_origin, unit_com, qty_com, unit_price_com, unit_trib, qty_trib, total_products, discount,
      freight, insurance, other, ipi_rate, ipi_value, st_value, conversion_factor, match_method, match_reason
    ) values (
      v_invoice, (it ->> 'item_number')::int, v_product, v_code, v_ean, nullif(it ->> 'ean_trib', ''),
      it ->> 'description', nullif(it ->> 'ncm', ''), nullif(it ->> 'cest', ''), nullif(it ->> 'cfop', ''),
      (it ->> 'fiscal_origin')::smallint, nullif(it ->> 'unit_com', ''), (it ->> 'qty_com')::numeric,
      (it ->> 'unit_price_com')::numeric, nullif(it ->> 'unit_trib', ''), (it ->> 'qty_trib')::numeric,
      (it ->> 'total_products')::numeric, coalesce((it ->> 'discount')::numeric, 0),
      coalesce((it ->> 'freight')::numeric, 0), coalesce((it ->> 'insurance')::numeric, 0),
      coalesce((it ->> 'other')::numeric, 0), (it ->> 'ipi_rate')::numeric,
      coalesce((it ->> 'ipi_value')::numeric, 0), coalesce((it ->> 'st_value')::numeric, 0),
      v_factor, v_method, nullif(it ->> 'match_reason', '')
    ) returning id, base_qty into v_item, v_base_qty;

    if v_product is null then
      continue; -- item ignorado: registrado na nota, sem efeito no custo
    end if;

    v_reason := case v_method
      when 'ean' then 'EAN da NF-e ' || (inv ->> 'number')
      when 'supplier_sku' then 'Código do fornecedor na NF-e ' || (inv ->> 'number')
      when 'novo' then 'Cadastro criado a partir da NF-e ' || (inv ->> 'number')
      else 'Vínculo confirmado manualmente na NF-e ' || (inv ->> 'number') end;

    if v_action = 'create' then
      -- o gatilho do produto já criou os identificadores principais; registra a origem
      update public.product_identifiers
         set source = 'nfe', match_reason = v_reason, source_invoice_item_id = v_item,
             confirmed_by = auth.uid(), confirmed_at = now()
       where product_id = v_product;
    else
      if v_ean is not null and not exists (
        select 1 from public.product_identifiers where id_type = 'ean' and value = v_ean) then
        insert into public.product_identifiers (product_id, id_type, value, source, match_reason,
                                                source_invoice_item_id, confirmed_by, confirmed_at)
        values (v_product, 'ean', v_ean, 'nfe', v_reason, v_item, auth.uid(), now());
      end if;
      if not exists (
        select 1 from public.product_identifiers where id_type = 'supplier_sku'
          and supplier_id = v_supplier and lower(value) = lower(v_code)) then
        insert into public.product_identifiers (product_id, id_type, value, supplier_id, source, match_reason,
                                                source_invoice_item_id, confirmed_by, confirmed_at)
        values (v_product, 'supplier_sku', v_code, v_supplier, 'nfe', v_reason, v_item, auth.uid(), now());
      end if;
      -- Dados fiscais: só preenche o que está vazio; nunca sobrescreve
      update public.products
         set ncm = coalesce(ncm, nullif(it ->> 'ncm', '')),
             cest = coalesce(cest, nullif(it ->> 'cest', '')),
             fiscal_origin = coalesce(fiscal_origin, (it ->> 'fiscal_origin')::smallint),
             fiscal_source = case when ncm is null and cest is null and fiscal_origin is null
                                   and (nullif(it ->> 'ncm', '') is not null or nullif(it ->> 'cest', '') is not null
                                        or (it ->> 'fiscal_origin') is not null)
                                  then 'nfe'::public.data_source else fiscal_source end
       where id = v_product
         and (ncm is null or cest is null or fiscal_origin is null)
         and fiscal_source is distinct from 'manual';
    end if;

    v_cost := public.compute_item_cost(
      v_rule, (it ->> 'total_products')::numeric, coalesce((it ->> 'ipi_value')::numeric, 0),
      coalesce((it ->> 'freight')::numeric, 0), coalesce((it ->> 'insurance')::numeric, 0),
      coalesce((it ->> 'other')::numeric, 0), coalesce((it ->> 'st_value')::numeric, 0),
      coalesce((it ->> 'discount')::numeric, 0));

    insert into public.product_cost_history (
      product_id, invoice_item_id, entry_type, occurred_at, supplier_id, quantity, products_value, ipi_value,
      freight_value, insurance_value, other_value, st_value, discount_value, cost_total, unit_cost, cost_rule_id, reason
    ) values (
      v_product, v_item, 'entrada', v_issued, v_supplier, v_base_qty, (it ->> 'total_products')::numeric,
      coalesce((it ->> 'ipi_value')::numeric, 0), coalesce((it ->> 'freight')::numeric, 0),
      coalesce((it ->> 'insurance')::numeric, 0), coalesce((it ->> 'other')::numeric, 0),
      coalesce((it ->> 'st_value')::numeric, 0), coalesce((it ->> 'discount')::numeric, 0),
      v_cost, round(v_cost / v_base_qty, 6), v_rule.id, v_reason
    );
    v_count := v_count + 1;
  end loop;

  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------
-- Correção de vínculo de um item (estorno + nova entrada)
-- p_new_product_id nulo = desvincular (item deixa de contar no custo)
-- ---------------------------------------------------------------------
create or replace function public.relink_invoice_item(p_item_id uuid, p_new_product_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item   public.invoice_items;
  v_inv    public.invoices;
  v_entry  public.product_cost_history;
  v_rule   public.cost_rules;
  v_cost   numeric;
begin
  if not public.is_staff() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo da correção' using errcode = '22023';
  end if;

  select * into v_item from public.invoice_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'Item da nota não encontrado' using errcode = '23503';
  end if;
  if v_item.product_id is not distinct from p_new_product_id then
    raise exception 'O item já está vinculado a este produto' using errcode = '22023';
  end if;
  if p_new_product_id is not null and not exists (select 1 from public.products where id = p_new_product_id) then
    raise exception 'Produto não encontrado' using errcode = '23503';
  end if;
  select * into v_inv from public.invoices where id = v_item.invoice_id;

  -- Conflito de identificador no novo produto
  if p_new_product_id is not null then
    if v_item.ean is not null and exists (
      select 1 from public.product_identifiers where id_type = 'ean' and value = v_item.ean
        and product_id <> p_new_product_id
        and source_invoice_item_id is distinct from v_item.id) then
      raise exception 'O EAN % pertence a outro produto' , v_item.ean using errcode = '23505';
    end if;
  end if;

  -- Estorna a entrada vigente
  select * into v_entry from public.product_cost_history
   where invoice_item_id = v_item.id and entry_type = 'entrada' and not is_reversed
   for update;
  if v_entry.id is not null then
    update public.product_cost_history set is_reversed = true where id = v_entry.id;
    insert into public.product_cost_history (
      product_id, invoice_item_id, entry_type, occurred_at, supplier_id, quantity, products_value, ipi_value,
      freight_value, insurance_value, other_value, st_value, discount_value, cost_total, unit_cost,
      cost_rule_id, reverses_id, reason
    ) values (
      v_entry.product_id, v_item.id, 'estorno', v_entry.occurred_at, v_entry.supplier_id, -v_entry.quantity,
      -v_entry.products_value, -v_entry.ipi_value, -v_entry.freight_value, -v_entry.insurance_value,
      -v_entry.other_value, -v_entry.st_value, -v_entry.discount_value, -v_entry.cost_total, v_entry.unit_cost,
      v_entry.cost_rule_id, v_entry.id, 'Correção de vínculo: ' || p_reason
    );
  end if;

  -- Remove identificadores que este item tinha criado no produto anterior
  delete from public.product_identifiers where source_invoice_item_id = v_item.id;

  update public.invoice_items
     set product_id = p_new_product_id,
         match_method = case when p_new_product_id is null then 'ignorado' else 'manual' end::public.match_method,
         match_reason = p_reason
   where id = v_item.id;

  if p_new_product_id is null then
    return;
  end if;

  -- Identificadores no novo produto
  if v_item.ean is not null and not exists (
    select 1 from public.product_identifiers where id_type = 'ean' and value = v_item.ean) then
    insert into public.product_identifiers (product_id, id_type, value, source, match_reason,
                                            source_invoice_item_id, confirmed_by, confirmed_at)
    values (p_new_product_id, 'ean', v_item.ean, 'nfe', 'Correção de vínculo: ' || p_reason, v_item.id, auth.uid(), now());
  end if;
  if not exists (
    select 1 from public.product_identifiers where id_type = 'supplier_sku'
      and supplier_id = v_inv.supplier_id and lower(value) = lower(v_item.supplier_code)) then
    insert into public.product_identifiers (product_id, id_type, value, supplier_id, source, match_reason,
                                            source_invoice_item_id, confirmed_by, confirmed_at)
    values (p_new_product_id, 'supplier_sku', v_item.supplier_code, v_inv.supplier_id, 'nfe',
            'Correção de vínculo: ' || p_reason, v_item.id, auth.uid(), now());
  end if;

  -- Nova entrada com a mesma regra da entrada original (ou a ativa, se o item estava ignorado)
  if v_entry.id is not null then
    select * into v_rule from public.cost_rules where id = v_entry.cost_rule_id;
  else
    select * into v_rule from public.cost_rules where is_active;
  end if;
  v_cost := public.compute_item_cost(v_rule, v_item.total_products, v_item.ipi_value, v_item.freight,
                                     v_item.insurance, v_item.other, v_item.st_value, v_item.discount);
  insert into public.product_cost_history (
    product_id, invoice_item_id, entry_type, occurred_at, supplier_id, quantity, products_value, ipi_value,
    freight_value, insurance_value, other_value, st_value, discount_value, cost_total, unit_cost, cost_rule_id, reason
  ) values (
    p_new_product_id, v_item.id, 'entrada', v_inv.issued_at, v_inv.supplier_id, v_item.base_qty,
    v_item.total_products, v_item.ipi_value, v_item.freight, v_item.insurance, v_item.other, v_item.st_value,
    v_item.discount, v_cost, round(v_cost / v_item.base_qty, 6), v_rule.id, 'Correção de vínculo: ' || p_reason
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Sugestões de produto por semelhança de texto (para itens sem vínculo)
-- ---------------------------------------------------------------------
create or replace function public.suggest_products(p_text text, p_limit int default 5)
returns table (id uuid, name text, brand text, supplier_sku text, ean text, score real)
language sql stable
set search_path = ''
as $$
  select p.id, coalesce(p.commercial_name, p.nf_description), p.brand, p.supplier_sku, p.ean,
         extensions.similarity(
           coalesce(p.commercial_name, '') || ' ' || coalesce(p.nf_description, '') || ' ' ||
           coalesce(p.model, '') || ' ' || coalesce(p.brand, ''), p_text) as score
  from public.products p
  where p.archived_at is null
    and extensions.similarity(
          coalesce(p.commercial_name, '') || ' ' || coalesce(p.nf_description, '') || ' ' ||
          coalesce(p.model, '') || ' ' || coalesce(p.brand, ''), p_text) > 0.2
  order by score desc
  limit least(greatest(p_limit, 1), 20);
$$;

-- Correspondência dos itens de uma nota com produtos existentes (EAN e código do fornecedor)
-- p_items = [{ "item_number": 1, "ean": "...", "supplier_code": "..." }, ...]
create or replace function public.match_invoice_items(p_issuer_cnpj text, p_items jsonb)
returns table (item_number int, ean_product_id uuid, ean_product_name text,
               sku_product_id uuid, sku_product_name text)
language sql stable
set search_path = ''
as $$
  with sup as (
    select id from public.suppliers where cnpj = regexp_replace(coalesce(p_issuer_cnpj, ''), '\D', '', 'g')
  ), it as (
    select (x ->> 'item_number')::int as n, nullif(x ->> 'ean', '') as ean, x ->> 'supplier_code' as code
    from jsonb_array_elements(p_items) x
  )
  select it.n,
         pe.id, coalesce(pe.commercial_name, pe.nf_description),
         ps.id, coalesce(ps.commercial_name, ps.nf_description)
  from it
  left join public.product_identifiers ie on ie.id_type = 'ean' and ie.value = it.ean
  left join public.products pe on pe.id = ie.product_id
  left join public.product_identifiers isk on isk.id_type = 'supplier_sku'
        and isk.supplier_id = (select id from sup) and lower(isk.value) = lower(it.code)
  left join public.products ps on ps.id = isk.product_id
  order by it.n;
$$;
revoke execute on function public.match_invoice_items(text, jsonb) from public, anon;
grant execute on function public.match_invoice_items(text, jsonb) to authenticated;

-- Ativa uma versão da regra de custo (somente admin)
create or replace function public.activate_cost_rule(p_rule_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores alteram a regra de custo' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cost_rules where id = p_rule_id) then
    raise exception 'Regra não encontrada' using errcode = '23503';
  end if;
  update public.cost_rules set is_active = false where is_active and id <> p_rule_id;
  update public.cost_rules set is_active = true where id = p_rule_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function public.audit_row();
create trigger invoice_items_audit after update or delete on public.invoice_items
  for each row execute function public.audit_row();
create trigger cost_rules_audit after insert or update or delete on public.cost_rules
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Permissões e RLS
-- Leitura para a equipe; gravação somente pelas funções acima.
-- ---------------------------------------------------------------------
alter table public.cost_rules enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.product_cost_history enable row level security;

create policy "cost_rules: equipe consulta" on public.cost_rules
  for select to authenticated using ((select public.is_staff()));
create policy "cost_rules: admin cria versão" on public.cost_rules
  for insert to authenticated with check ((select public.is_admin()) and not is_active);
create policy "invoices: equipe consulta" on public.invoices
  for select to authenticated using ((select public.is_staff()));
create policy "invoice_items: equipe consulta" on public.invoice_items
  for select to authenticated using ((select public.is_staff()));
create policy "cost_history: equipe consulta" on public.product_cost_history
  for select to authenticated using ((select public.is_staff()));

revoke all on public.cost_rules, public.invoices, public.invoice_items, public.product_cost_history,
  public.product_cost_summary from anon;
revoke insert, update, delete on public.invoices, public.invoice_items, public.product_cost_history from authenticated;
revoke update, delete on public.cost_rules from authenticated;

revoke execute on function public.import_invoice(jsonb) from public, anon;
revoke execute on function public.relink_invoice_item(uuid, uuid, text) from public, anon;
revoke execute on function public.activate_cost_rule(uuid) from public, anon;
revoke execute on function public.suggest_products(text, int) from public, anon;
revoke execute on function public.compute_item_cost(public.cost_rules, numeric, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.import_invoice(jsonb) to authenticated;
grant execute on function public.relink_invoice_item(uuid, uuid, text) to authenticated;
grant execute on function public.activate_cost_rule(uuid) to authenticated;
grant execute on function public.suggest_products(text, int) to authenticated;
grant execute on function public.compute_item_cost(public.cost_rules, numeric, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- Armazenamento do XML original: caminho determinístico pela chave (<chave>.xml)
-- (políticas de leitura/envio do bucket nfe-xml já existem na migração 0001)
