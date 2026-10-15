-- Caixa de entrada de XML: chaves de integração e marcação automática
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f7', 'adm7@dualshop.local'), ('00000000-0000-0000-0000-0000000000f8', 'op8@dualshop.local');
update public.profiles set role = 'admin', active = true where id = '00000000-0000-0000-0000-0000000000f7';
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000f8';

-- linha criada pela Edge Function (service role)
insert into public.nfe_inbox (access_key, source, xml_path, number, issuer_name, total_invoice)
values ('42261012345678000199550010000077011000000771', 'email', '42261012345678000199550010000077011000000771.xml', '7701', 'FORNECEDOR X', 100);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f8","role":"authenticated"}';
do $$ begin
  begin
    perform public.create_integration_token('teste');
    raise exception 'FALHOU: operador gerou chave';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.nfe_inbox (access_key, source, xml_path) values (repeat('1', 44), 'email', 'x');
    raise exception 'FALHOU: equipe inseriu na caixa';
  exception when insufficient_privilege then null; end;
  begin
    update public.nfe_inbox set total_invoice = 1 where number = '7701';
    raise exception 'FALHOU: alterou valor';
  exception when insufficient_privilege then null; end;
  update public.nfe_inbox set status = 'ignorada', ignored_reason = 'brinde' where number = '7701';
  update public.nfe_inbox set status = 'nova', ignored_reason = null where number = '7701';
  raise notice 'OK  caixa de entrada: equipe só ignora/reabre; inclusão só pelo servidor; chave só por admin';

  perform public.import_invoice($j${
    "invoice": {"access_key":"42261012345678000199550010000077011000000771","number":"7701","series":"1","model":"55",
      "issued_at":"2026-10-01T10:00:00-03:00","purpose":1,"issuer_cnpj":"12345678000199",
      "issuer_name":"FORNECEDOR X","totals":{"products":100,"ipi":0,"invoice":100}},
    "items": [{"item_number":1,"supplier_code":"X1","description":"MOCHILA X","unit_com":"UN","qty_com":1,"unit_price_com":100,
       "total_products":100,"conversion_factor":1,"action":"create"}]}$j$::jsonb);
  if (select status from public.nfe_inbox where number = '7701') <> 'importada'
     or (select invoice_id from public.nfe_inbox where number = '7701') is null then
    raise exception 'FALHOU: importação não marcou a caixa';
  end if;
  raise notice 'OK  importar a nota marca a entrada da caixa como importada';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f7","role":"authenticated"}';
create temp table _tok (t text) on commit drop;
grant all on _tok to authenticated;
insert into _tok select public.create_integration_token('Gmail');
reset role;
do $$ declare t text := (select t from _tok); begin
  if t !~ '^dsi_[0-9a-f]{48}$' then raise exception 'FALHOU: formato da chave'; end if;
  if not exists (select 1 from public.integration_tokens where token_hash = encode(extensions.digest(t, 'sha256'), 'hex') and token_hint = right(t, 4)) then
    raise exception 'FALHOU: hash da chave';
  end if;
  if exists (select 1 from public.integration_tokens where token_hash = t) then raise exception 'FALHOU: chave em texto'; end if;
  raise notice 'OK  chave de integração guardada só como hash';
end $$;

reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.nfe_inbox limit 1; raise exception 'FALHOU: anônimo leu caixa';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  anônimo bloqueado na caixa de entrada';
end $$;
rollback;
