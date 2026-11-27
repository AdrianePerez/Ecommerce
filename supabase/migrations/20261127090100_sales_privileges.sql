-- 0017b · Privilégios de vendas: leitura pela equipe; gravação só pelas funções
revoke all on public.sales, public.sales_imports from anon;
revoke insert, update, delete on public.sales, public.sales_imports from authenticated;
revoke execute on function public.import_sales(text, text, jsonb), public.link_sales_sku(text, uuid), public.product_for_sku(text) from public, anon;
grant execute on function public.import_sales(text, text, jsonb), public.link_sales_sku(text, uuid), public.product_for_sku(text) to authenticated;
