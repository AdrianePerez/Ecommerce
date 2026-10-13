-- =====================================================================
-- 0006 · Alteração em massa de produtos
-- Uma única transação: ou altera todos os produtos selecionados, ou nenhum.
-- Respeita a RLS (security invoker) e fica registrada na auditoria de
-- cada produto (gatilho products_audit).
-- Campos permitidos: características comuns a vários itens. Nome,
-- descrição, EAN e SKUs ficam de fora (são próprios de cada produto).
-- =====================================================================

create or replace function public.bulk_update_products(p_ids uuid[], p_changes jsonb, p_only_empty boolean default false)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  allowed constant jsonb := '{
    "brand":"text","collection":"text","collection_year":"smallint","model":"text","material":"text",
    "color":"text","unit":"text","capacity_value":"numeric","capacity_unit":"text",
    "height_mm":"numeric","width_mm":"numeric","depth_mm":"numeric","weight_g":"numeric",
    "pkg_height_mm":"numeric","pkg_width_mm":"numeric","pkg_depth_mm":"numeric","gross_weight_g":"numeric",
    "ncm":"text","cest":"text","fiscal_origin":"smallint","status":"public.product_status","main_supplier_id":"uuid"
  }'::jsonb;
  k        text;
  v        jsonb;
  expr     text;
  sets     text[] := '{}';
  fis_new  text[] := array['ncm', 'cest', 'fiscal_origin'];
  fis_expr text[];
  sql      text;
  n        integer;
  missing  integer;
begin
  if not public.is_staff() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Nenhum produto selecionado' using errcode = '22023';
  end if;
  if cardinality(p_ids) > 2000 then
    raise exception 'Selecione no máximo 2.000 produtos por vez' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'Nenhum campo para alterar' using errcode = '22023';
  end if;

  select count(*) into missing from unnest(p_ids) i where not exists (select 1 from public.products p where p.id = i);
  if missing > 0 then
    raise exception '% produto(s) selecionado(s) não foram encontrados. Atualize a lista.', missing using errcode = '23503';
  end if;

  if (p_changes ? 'capacity_value') <> (p_changes ? 'capacity_unit') then
    raise exception 'Informe valor e unidade da capacidade juntos' using errcode = '22023';
  end if;

  for k, v in select * from jsonb_each(p_changes) loop
    if not allowed ? k then
      raise exception 'Campo não permitido na alteração em massa: %', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) = 'null' or btrim(v #>> '{}') = '' then
      raise exception 'O campo % está marcado mas sem valor', k using errcode = '22023';
    end if;
    expr := format('%L::%s', v #>> '{}', allowed ->> k);
    if p_only_empty and k <> 'status' then
      expr := format('coalesce(%I, %s)', k, expr);
    end if;
    sets := sets || format('%I = %s', k, expr);
    fis_new := array_replace(fis_new, k, expr);
  end loop;

  -- Dado fiscal alterado na mão passa a ter origem "manual"
  if p_changes ?| array['ncm', 'cest', 'fiscal_origin'] then
    fis_expr := array[
      case when fis_new[1] = 'ncm' then 'ncm' else fis_new[1] end,
      case when fis_new[2] = 'cest' then 'cest' else fis_new[2] end,
      case when fis_new[3] = 'fiscal_origin' then 'fiscal_origin' else fis_new[3] end];
    sets := sets || format(
      'fiscal_source = case when (%s, %s, %s) is distinct from (ncm, cest, fiscal_origin) then %L::public.data_source else fiscal_source end',
      fis_expr[1], fis_expr[2], fis_expr[3], 'manual');
  end if;

  sql := format('update public.products set %s where id = any($1)', array_to_string(sets, ', '));
  begin
    execute sql using p_ids;
  exception
    when check_violation then
      if sqlerrm like '%products_ready_requires_complete%' then
        raise exception 'Alguns produtos selecionados não podem ser marcados como prontos ou publicados porque o cadastro está incompleto (nome comercial, marca, EAN ou código, NCM, dimensões e peso).'
          using errcode = '23514';
      end if;
      raise exception 'Valor fora das regras do cadastro: %', sqlerrm using errcode = '23514';
  end;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.bulk_update_products(uuid[], jsonb, boolean) from public, anon;
grant execute on function public.bulk_update_products(uuid[], jsonb, boolean) to authenticated;
