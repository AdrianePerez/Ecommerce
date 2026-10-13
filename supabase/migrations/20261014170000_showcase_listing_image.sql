-- 0010 · Vitrine: foto da imagem principal do ANÚNCIO (a escolhida no anúncio),
-- além da principal do produto. Coluna nova no fim (create or replace permite).
create or replace view public.showcase_rows
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
  greatest(p.updated_at, l.updated_at)         as updated_at,
  (select i.storage_path from public.product_images i where i.id = l.main_image_id) as listing_image_path
from public.product_overview p
left join public.product_cost_summary c on c.product_id = p.id
left join public.product_listings l on l.product_id = p.id and l.status <> 'arquivado'
left join public.marketplace_configs m on m.id = l.marketplace_id;
