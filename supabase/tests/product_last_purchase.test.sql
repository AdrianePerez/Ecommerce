-- Último preço de compra (preço + IPI por unidade de estoque)
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f9', 'op9@dualshop.local');
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000f9';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f9","role":"authenticated"}';
create temp table _lp (k text primary key, v uuid) on commit drop;
insert into _lp select 'nf', public.import_invoice($j${
  "invoice": {"access_key":"42261012345678000199550010000009031000000090","number":"903","series":"1","model":"55",
    "issued_at":"2026-10-01T10:00:00-03:00","purpose":1,"issuer_cnpj":"12345678000199",
    "issuer_name":"FORNECEDOR PRECO LTDA","totals":{"products":240,"ipi":24,"invoice":264}},
  "items": [
    {"item_number":1,"supplier_code":"PRC01","description":"MOCHILA PRECO","unit_com":"CX","qty_com":2,"unit_price_com":120,
     "total_products":240,"ipi_value":24,"freight":10,"conversion_factor":6,"action":"create"}
  ]}$j$::jsonb);
do $$ declare r record; begin
  select lp.* into r from public.product_last_purchase lp
    join public.invoice_items ii on ii.product_id = lp.product_id
   where ii.invoice_id = (select v from _lp where k = 'nf');
  if r.unit_price <> 20 or r.unit_ipi <> 2 or r.unit_price_with_ipi <> 22 or r.invoice_number <> '903' then
    raise exception 'FALHOU: último preço (% + % = %)', r.unit_price, r.unit_ipi, r.unit_price_with_ipi;
  end if;
  raise notice 'OK  último preço de compra = (produtos + IPI) ÷ quantidade em unidades, sem frete';
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.product_last_purchase limit 1; raise exception 'FALHOU: anônimo leu último preço';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  anônimo bloqueado no último preço de compra';
end $$;
rollback;
