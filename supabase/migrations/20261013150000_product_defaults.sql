-- =====================================================================
-- 0005 · Preenchimento automático no cadastro de produtos
--  * Marca = nome fantasia do fornecedor principal (quando a marca vier vazia)
--  * SKU interno = código do fornecedor (quando vier vazio e o código
--    ainda não for SKU interno de outro produto)
-- Vale na criação do produto (importação de NF-e ou cadastro manual).
-- Depois de criado, o usuário pode alterar ou apagar livremente.
-- =====================================================================

create or replace function public.product_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(btrim(new.brand), '') = '' and new.main_supplier_id is not null then
    select nullif(btrim(s.trade_name), '') into new.brand
    from public.suppliers s where s.id = new.main_supplier_id;
  end if;

  if coalesce(btrim(new.internal_sku), '') = '' and coalesce(btrim(new.supplier_sku), '') <> ''
     and not exists (select 1 from public.products p where lower(p.internal_sku) = lower(btrim(new.supplier_sku))) then
    new.internal_sku := btrim(new.supplier_sku);
  end if;
  return new;
end;
$$;

revoke execute on function public.product_defaults() from public, anon, authenticated;

create trigger products_defaults before insert on public.products
  for each row execute function public.product_defaults();

-- Produtos já cadastrados: preenche somente o que estiver vazio
update public.products p
   set brand = s.trade_name
  from public.suppliers s
 where s.id = p.main_supplier_id
   and p.brand is null
   and nullif(btrim(s.trade_name), '') is not null;

update public.products p
   set internal_sku = btrim(p.supplier_sku)
 where p.internal_sku is null
   and nullif(btrim(p.supplier_sku), '') is not null
   and not exists (select 1 from public.products o where o.id <> p.id and lower(o.internal_sku) = lower(btrim(p.supplier_sku)))
   and (select count(*) from public.products d where lower(btrim(d.supplier_sku)) = lower(btrim(p.supplier_sku))) = 1;
