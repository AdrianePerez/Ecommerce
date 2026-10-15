-- Monitor de notas: recebimento e estágio do cadastro
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e6', 'op6@dualshop.local');
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000e6';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e6","role":"authenticated"}';

create temp table _m (k text primary key, v uuid) on commit drop;
insert into _m select 'nf', public.import_invoice($j${
  "invoice": {"access_key":"42261012345678000199550010000009011000000091","number":"901","series":"1","model":"55",
    "issued_at":"2026-10-01T10:00:00-03:00","purpose":1,"issuer_cnpj":"12345678000199",
    "issuer_name":"FORNECEDOR MONITOR LTDA","totals":{"products":300,"ipi":0,"invoice":300}},
  "items": [
    {"item_number":1,"supplier_code":"MON01","description":"MOCHILA MONITOR 1","unit_com":"UN","qty_com":1,"unit_price_com":100,
     "total_products":100,"conversion_factor":1,"action":"create"},
    {"item_number":2,"supplier_code":"MON02","description":"MOCHILA MONITOR 2","unit_com":"UN","qty_com":2,"unit_price_com":100,
     "total_products":200,"conversion_factor":1,"action":"create"},
    {"item_number":3,"supplier_code":"DISP9","description":"DISPLAY","unit_com":"UN","qty_com":1,"unit_price_com":0.01,
     "total_products":0.01,"conversion_factor":1,"action":"ignore"}
  ]}$j$::jsonb);

do $$ declare r record; nf uuid := (select v from _m where k = 'nf'); begin
  select * into r from public.invoice_monitor where id = nf;
  if r.stage <> 'em_transito' or r.items_total <> 2 or r.items_ignored <> 1 or r.products_total <> 2 then
    raise exception 'FALHOU: nota nova deveria estar em trânsito (% / % itens)', r.stage, r.items_total;
  end if;
  begin
    perform public.set_invoice_received(nf, current_date + 2);
    raise exception 'FALHOU: data futura aceita';
  exception when invalid_parameter_value then null; end;
  perform public.set_invoice_received(nf, current_date);
  select * into r from public.invoice_monitor where id = nf;
  if r.stage <> 'cadastro_pendente' or r.received_at is null then raise exception 'FALHOU: recebida com cadastro pendente (%)', r.stage; end if;
  raise notice 'OK  nota importada fica em trânsito; ao receber, mostra o cadastro pendente';

  -- completa o cadastro mestre dos dois produtos
  update public.products set commercial_name = 'Mochila', brand = 'X', ncm = '42029200', fiscal_source = 'manual', height_mm = 400, width_mm = 300, depth_mm = 150, weight_g = 500
   where id in (select product_id from public.invoice_items where invoice_id = nf and product_id is not null);
  select * into r from public.invoice_monitor where id = nf;
  if r.stage <> 'em_preparacao' or r.products_incomplete <> 0 or r.products_ready <> 0 then raise exception 'FALHOU: em preparação (%)', r.stage; end if;

  update public.products set status = 'pronto'
   where id in (select product_id from public.invoice_items where invoice_id = nf and item_number = 1);
  select * into r from public.invoice_monitor where id = nf;
  if r.stage <> 'em_preparacao' or r.products_ready <> 1 then raise exception 'FALHOU: 1 de 2 prontos'; end if;

  update public.products set status = 'pronto'
   where id in (select product_id from public.invoice_items where invoice_id = nf and item_number = 2);
  select * into r from public.invoice_monitor where id = nf;
  if r.stage <> 'finalizada' then raise exception 'FALHOU: finalizada (%)', r.stage; end if;

  perform public.set_invoice_received(nf, null);
  if (select stage from public.invoice_monitor where id = nf) <> 'em_transito' then raise exception 'FALHOU: voltar para trânsito'; end if;
  raise notice 'OK  estágio acompanha o cadastro: pendente → em preparação → finalizada; dá para voltar para trânsito';

  begin
    update public.invoices set received_at = now() where id = nf;
    raise exception 'FALHOU: alteração direta da nota';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  recebimento só pela função (nota não aceita alteração direta)';
end $$;

reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.invoice_monitor limit 1; raise exception 'FALHOU: anônimo leu monitor';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  anônimo bloqueado no monitor de notas';
end $$;
rollback;
