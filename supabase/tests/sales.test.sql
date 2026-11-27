-- Vendas: importar, reimportar sem duplicar, vínculo de SKU e permissões
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000fa', 'opv@dualshop.local');
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000fa';
insert into public.sales (channel, order_id, sold_at, status_group, sku, units) values ('mercado_livre', 'OLD1', now(), 'ativa', 'NOVO-01', 1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000fa","role":"authenticated"}';

do $$ declare r jsonb; p1 uuid; p2 uuid; n int; begin
  insert into public.products (nf_description, ean) values ('MOCHILA VENDA', '7899650150684') returning id into p1;
  insert into public.products (nf_description, supplier_sku) values ('ESTOJO VENDA', 'EST-01') returning id into p2;

  r := public.import_sales('mercado_livre', 'vendas.xlsx', '[
    {"order_id":"A1","sold_at":"2026-11-20T10:00:00-03:00","status_text":"A caminho","status_group":"ativa","sku":"7899650150684","units":1,"unit_price":150,"gross_revenue":150,"sale_fees":-20,"shipping_net":-15,"net_total":115,"buyer_state":"SP"},
    {"order_id":"A2","pack_id":"P1","sold_at":"2026-11-21T10:00:00-03:00","status_text":"A caminho","status_group":"ativa","sku":"est-01","units":2,"gross_revenue":100,"net_total":80},
    {"order_id":"A3","sold_at":"2026-11-22T10:00:00-03:00","status_text":"A caminho","status_group":"ativa","sku":"XYZ-9","units":1,"gross_revenue":50,"net_total":40}
  ]'::jsonb);
  if (r->>'novas')::int <> 3 or (r->>'sem_produto')::int <> 1 then raise exception 'FALHOU: importação %', r; end if;
  if (select product_id from public.sales where order_id = 'A1') <> p1 or (select product_id from public.sales where order_id = 'A2') <> p2 then
    raise exception 'FALHOU: vínculo por EAN / código do fornecedor';
  end if;
  raise notice 'OK  importação liga o produto pelo EAN e pelo código do fornecedor (sem diferenciar maiúsculas)';

  r := public.import_sales('mercado_livre', 'vendas2.xlsx', '[
    {"order_id":"A1","sold_at":"2026-11-20T10:00:00-03:00","status_text":"Devolução revisada","status_group":"devolvida","sku":"7899650150684","units":1,"gross_revenue":150,"refunds":-115,"net_total":0}
  ]'::jsonb);
  if (r->>'novas')::int <> 0 or (r->>'atualizadas')::int <> 1 or (select count(*) from public.sales) <> 4
     or (select status_group from public.sales where order_id = 'A1') <> 'devolvida' then raise exception 'FALHOU: reimportação %', r; end if;
  raise notice 'OK  reimportar atualiza o status, sem duplicar a venda';

  n := public.link_sales_sku('xyz-9', p2);
  if n <> 1 or (select product_id from public.sales where order_id = 'A3') <> p2 then raise exception 'FALHOU: vincular SKU'; end if;
  if public.product_for_sku('XYZ-9') <> p2 then raise exception 'FALHOU: vínculo não vale para as próximas'; end if;
  raise notice 'OK  vincular SKU atualiza as vendas e vale para as próximas importações';

  -- SKU = EAN + sufixo (ex.: 7899650150684-AZ) liga pelo EAN do começo
  if public.product_for_sku('7899650150684-AZ') <> p1 then raise exception 'FALHOU: EAN no começo do SKU'; end if;
  if public.product_for_sku('7899650150684AZ') is not null then raise exception 'FALHOU: sem separador não deveria ligar'; end if;
  r := public.import_sales('mercado_livre', 'v3.xlsx', '[{"order_id":"A4","sold_at":"2026-11-23T10:00:00-03:00","status_text":"A caminho","status_group":"ativa","sku":"7899650150684-AZ","units":1,"gross_revenue":150,"net_total":110}]'::jsonb);
  if (select product_id from public.sales where order_id = 'A4') <> p1 then raise exception 'FALHOU: importação com EAN + sufixo'; end if;
  raise notice 'OK  SKU que começa com o EAN (ex.: EAN-AZ) é ligado ao produto desse EAN';

  -- produto cadastrado depois: a próxima importação revisa as vendas antigas sem produto
  insert into public.products (nf_description, supplier_sku) values ('PRODUTO NOVO', 'NOVO-01') returning id into p2;
  if public.rematch_sales() < 1 or (select product_id from public.sales where order_id = 'OLD1') <> p2 then raise exception 'FALHOU: revisão de vendas sem produto'; end if;
  raise notice 'OK  vendas antigas sem produto são ligadas quando o produto passa a existir';

  begin
    insert into public.sales (channel, order_id, sold_at, status_group, units) values ('mercado_livre', 'X', now(), 'ativa', 1);
    raise exception 'FALHOU: gravação direta em sales';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  vendas só são gravadas pela importação';
end $$;

reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.sales limit 1; raise exception 'FALHOU: anônimo leu vendas';
  exception when insufficient_privilege then null; end;
  begin perform public.import_sales('mercado_livre', 'x', '[]'::jsonb); raise exception 'FALHOU: anônimo importou';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  anônimo não lê nem importa vendas';
end $$;
rollback;
