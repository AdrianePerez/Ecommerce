-- =====================================================================
-- 0016 · Último preço de compra por produto
--  Da última entrada vigente (nota não estornada): preço unitário dos
--  produtos + IPI unitário, na unidade de estoque (já aplicada a
--  conversão de caixa/pacote). Não soma frete, ST nem desconto — esses
--  continuam no custo gerencial (product_cost_summary).
-- =====================================================================
create view public.product_last_purchase
with (security_invoker = true) as
select distinct on (h.product_id)
  h.product_id,
  h.occurred_at                                   as purchased_at,
  h.quantity,
  round(h.products_value / h.quantity, 4)         as unit_price,
  round(h.ipi_value / h.quantity, 4)              as unit_ipi,
  round((h.products_value + h.ipi_value) / h.quantity, 4) as unit_price_with_ipi,
  i.id                                            as invoice_id,
  i.number                                        as invoice_number
from public.product_cost_history h
join public.invoice_items ii on ii.id = h.invoice_item_id
join public.invoices i on i.id = ii.invoice_id
where h.entry_type = 'entrada' and not h.is_reversed
order by h.product_id, h.occurred_at desc, h.created_at desc;
comment on view public.product_last_purchase is 'Última compra vigente de cada produto: preço unitário + IPI na unidade de estoque.';
