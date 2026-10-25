-- Status "Fora de linha": não é pendência no monitor de notas e bloqueia anúncio novo
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f7', 'op7@dualshop.local');
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000f7';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f7","role":"authenticated"}';

create temp table _d (k text primary key, v uuid) on commit drop;
insert into _d select 'nf', public.import_invoice($j${
  "invoice": {"access_key":"42261012345678000199550010000009021000000096","number":"902","series":"1","model":"55",
    "issued_at":"2026-10-01T10:00:00-03:00","purpose":1,"issuer_cnpj":"12345678000199",
    "issuer_name":"FORNECEDOR LINHA LTDA","totals":{"products":200,"ipi":0,"invoice":200}},
  "items": [
    {"item_number":1,"supplier_code":"LIN01","description":"MOCHILA LINHA 1","unit_com":"UN","qty_com":1,"unit_price_com":100,
     "total_products":100,"conversion_factor":1,"action":"create"},
    {"item_number":2,"supplier_code":"LIN02","description":"MOCHILA LINHA 2","unit_com":"UN","qty_com":1,"unit_price_com":100,
     "total_products":100,"conversion_factor":1,"action":"create"}
  ]}$j$::jsonb);

do $$ declare r record; nf uuid := (select v from _d where k = 'nf'); p1 uuid; p2 uuid; ml uuid; l uuid; begin
  select product_id into p1 from public.invoice_items where invoice_id = nf and item_number = 1;
  select product_id into p2 from public.invoice_items where invoice_id = nf and item_number = 2;
  select id into ml from public.marketplace_configs where code = 'mercado_livre';
  perform public.set_invoice_received(nf, current_date);

  -- p1 com cadastro incompleto, mas fora de linha; p2 completo e pronto
  update public.products set status = 'fora_de_linha' where id = p1;
  update public.products set commercial_name = 'Mochila', brand = 'X', ncm = '42029200', fiscal_source = 'manual',
    height_mm = 400, width_mm = 300, depth_mm = 150, weight_g = 500, status = 'pronto' where id = p2;
  if (select archived_at from public.products where id = p1) is not null then raise exception 'FALHOU: fora de linha não deve arquivar'; end if;
  select * into r from public.invoice_monitor where id = nf;
  if r.stage <> 'finalizada' or r.products_incomplete <> 0 or r.products_ready <> 2 then
    raise exception 'FALHOU: nota deveria finalizar com item fora de linha (% / inc % / ok %)', r.stage, r.products_incomplete, r.products_ready;
  end if;
  raise notice 'OK  produto fora de linha não deixa a nota pendente no monitor';

  begin
    insert into public.product_listings (product_id, marketplace_id) values (p1, ml);
    raise exception 'FALHOU: anúncio novo para produto fora de linha';
  exception when check_violation then null; end;

  -- anúncio criado antes de sair de linha: pode arquivar, não pode marcar como pronto
  update public.products set status = 'em_preparacao' where id = p1;
  insert into public.product_listings (product_id, marketplace_id) values (p1, ml) returning id into l;
  update public.products set status = 'fora_de_linha' where id = p1;
  begin
    update public.product_listings set status = 'pronto_para_publicar' where id = l;
    raise exception 'FALHOU: anúncio de produto fora de linha marcado como pronto';
  exception when check_violation then null; end;
  update public.product_listings set status = 'arquivado' where id = l;
  raise notice 'OK  fora de linha bloqueia anúncio novo/pronto e deixa arquivar o existente';
end $$;
rollback;
