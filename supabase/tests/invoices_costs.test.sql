-- Testes da importação de NF-e e do custo médio ponderado.
-- Roda numa transação desfeita no final (ROLLBACK).
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin.teste@dualshop.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'operador.teste@dualshop.local');
update public.profiles set role = 'admin', active = true where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000b2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

-- Nota 1: 10 un a R$ 100,00 (produto novo) + 1 item ignorado (material de ponto de venda)
create temp table _ids (k text primary key, v uuid) on commit drop;
insert into _ids
select 'nf1', public.import_invoice($j${
  "invoice": {"access_key":"42261012345678000199550010000001011000000011","number":"101","series":"1","model":"55",
    "issued_at":"2026-09-01T10:00:00-03:00","purpose":1,"issuer_cnpj":"12345678000199",
    "issuer_name":"FORNECEDOR TESTE LTDA","totals":{"products":1000,"ipi":0,"invoice":1000}},
  "items": [
    {"item_number":1,"supplier_code":"MC1601","ean":"7891234567895","description":"MOCHILA 16 TESTE",
     "ncm":"42029200","fiscal_origin":2,"unit_com":"UN","qty_com":10,"unit_price_com":100,"total_products":1000,
     "ipi_value":0,"conversion_factor":1,"action":"create"},
    {"item_number":2,"supplier_code":"DISP01","description":"DISPLAY DE PAPELAO","unit_com":"UN","qty_com":1,
     "unit_price_com":0.01,"total_products":0.01,"conversion_factor":1,"action":"ignore"}
  ]}$j$::jsonb);

insert into _ids select 'prod', product_id from public.invoice_items
  where invoice_id = (select v from _ids where k = 'nf1') and item_number = 1;

do $$ declare s record; begin
  select * into s from public.product_cost_summary where product_id = (select v from _ids where k = 'prod');
  if s.average_unit_cost <> 100 or s.last_unit_cost <> 100 or s.total_quantity <> 10 then
    raise exception 'FALHOU: custo após nota 1 (médio %, último %, qtd %)', s.average_unit_cost, s.last_unit_cost, s.total_quantity;
  end if;
  if not exists (select 1 from public.suppliers where cnpj = '12345678000199') then
    raise exception 'FALHOU: fornecedor não foi criado pelo CNPJ';
  end if;
  if (select fiscal_source from public.products where id = (select v from _ids where k = 'prod')) <> 'nfe' then
    raise exception 'FALHOU: origem fiscal do produto criado deveria ser nfe';
  end if;
  if (select count(*) from public.product_identifiers
      where product_id = (select v from _ids where k = 'prod') and source = 'nfe') <> 2 then
    raise exception 'FALHOU: identificadores do produto criado não registram origem nfe';
  end if;
  if (select count(*) from public.product_cost_history) <> 1 then
    raise exception 'FALHOU: item ignorado gerou custo';
  end if;
  raise notice 'OK  nota 1: produto criado, fornecedor criado, item ignorado sem custo, custo 100';
end $$;

-- Nota 2: mesmo produto, 20 un a R$ 120,00 + IPI R$ 200,00 (=> R$ 130,00/un)
insert into _ids
select 'nf2', public.import_invoice(jsonb_build_object(
  'invoice', jsonb_build_object('access_key','42261012345678000199550010000001021000000021','number','102',
    'issued_at','2026-09-20T10:00:00-03:00','purpose',1,'issuer_cnpj','12.345.678/0001-99',
    'issuer_name','FORNECEDOR TESTE LTDA','totals', jsonb_build_object('products',2400,'ipi',200,'invoice',2600)),
  'items', jsonb_build_array(jsonb_build_object(
    'item_number',1,'supplier_code','MC1601B','description','MOCHILA 16 TESTE B',
    'unit_com','UN','qty_com',20,'unit_price_com',120,'total_products',2400,'ipi_value',200,
    'conversion_factor',1,'action','link','product_id',(select v from _ids where k = 'prod'),'match_method','manual'),
  jsonb_build_object(
    'item_number',2,'supplier_code','mc1601','ean','7891234567895','description','MOCHILA 16 TESTE',
    'unit_com','UN','qty_com',0.0001,'unit_price_com',0,'total_products',0,'ipi_value',0,
    'conversion_factor',1,'action','ignore'))));

do $$ declare s record; begin
  select * into s from public.product_cost_summary where product_id = (select v from _ids where k = 'prod');
  -- (10 x 100 + 20 x 130) / 30 = 120
  if s.average_unit_cost <> 120 or s.last_unit_cost <> 130 or s.total_quantity <> 30 then
    raise exception 'FALHOU: custo médio esperado 120 / último 130 (veio % / %)', s.average_unit_cost, s.last_unit_cost;
  end if;
  raise notice 'OK  custo médio ponderado (10 x 100 + 20 x 130) / 30 = 120';
end $$;

-- Correspondência automática por EAN e por código do fornecedor (sem diferenciar maiúsculas)
do $$ declare r record; begin
  select * into r from public.match_invoice_items('12.345.678/0001-99',
    '[{"item_number":1,"ean":"7891234567895","supplier_code":"x"},{"item_number":2,"ean":null,"supplier_code":"Mc1601"},{"item_number":3,"supplier_code":"nada"}]'::jsonb)
    where item_number = 1;
  if r.ean_product_id is distinct from (select v from _ids where k = 'prod') then raise exception 'FALHOU: match por EAN'; end if;
  select * into r from public.match_invoice_items('12345678000199',
    '[{"item_number":2,"supplier_code":"Mc1601"}]'::jsonb);
  if r.sku_product_id is distinct from (select v from _ids where k = 'prod') then raise exception 'FALHOU: match por código'; end if;
  select * into r from public.match_invoice_items('99999999000199', '[{"item_number":2,"supplier_code":"MC1601"}]'::jsonb);
  if r.sku_product_id is not null then raise exception 'FALHOU: código de outro fornecedor não deveria corresponder'; end if;
  raise notice 'OK  correspondência por EAN e por código do fornecedor (só do mesmo fornecedor)';
end $$;

-- Mesma nota de novo: recusada, nada gravado
do $$ declare n int; begin
  select count(*) into n from public.product_cost_history;
  begin
    perform public.import_invoice(jsonb_build_object(
      'invoice', jsonb_build_object('access_key','42261012345678000199550010000001021000000021','number','102',
        'issued_at','2026-09-20T10:00:00-03:00','purpose',1,'issuer_cnpj','12345678000199','issuer_name','X'),
      'items', jsonb_build_array(jsonb_build_object('item_number',1,'supplier_code','A','description','A',
        'qty_com',1,'total_products',1,'action','ignore'))));
    raise exception 'FALHOU: nota duplicada foi aceita';
  exception when unique_violation then
    if sqlerrm not like 'NOTA_JA_IMPORTADA:%' then raise exception 'FALHOU: mensagem de duplicidade: %', sqlerrm; end if;
  end;
  if (select count(*) from public.product_cost_history) <> n then raise exception 'FALHOU: duplicada alterou custos'; end if;
  raise notice 'OK  nota duplicada recusada sem alterar custos';
end $$;

-- Falha no meio (item 2 inválido): nada da nota 3 é gravado
do $$ begin
  begin
    perform public.import_invoice(jsonb_build_object(
      'invoice', jsonb_build_object('access_key','42261012345678000199550010000001031000000031','number','103',
        'issued_at','2026-09-25T10:00:00-03:00','purpose',1,'issuer_cnpj','12345678000199','issuer_name','X'),
      'items', jsonb_build_array(
        jsonb_build_object('item_number',1,'supplier_code','NOVO1','description','PRODUTO NOVO',
          'qty_com',5,'total_products',50,'action','create'),
        jsonb_build_object('item_number',2,'supplier_code','B','description','B','qty_com',1,
          'total_products',1,'action','link','product_id','99999999-9999-9999-9999-999999999999'))));
    raise exception 'FALHOU: item inválido foi aceito';
  exception when foreign_key_violation then null;
  end;
  if exists (select 1 from public.invoices where number = '103')
     or exists (select 1 from public.products where supplier_sku = 'NOVO1') then
    raise exception 'FALHOU: importação parcial ficou gravada';
  end if;
  raise notice 'OK  falha no meio da importação não deixa nada gravado';
end $$;

-- Caixa com 12: 2 CX por R$ 240,00 => 24 un a R$ 10,00
insert into _ids
select 'nf4', public.import_invoice(jsonb_build_object(
  'invoice', jsonb_build_object('access_key','42261012345678000199550010000001041000000041','number','104',
    'issued_at','2026-09-26T10:00:00-03:00','purpose',1,'issuer_cnpj','12345678000199','issuer_name','X'),
  'items', jsonb_build_array(jsonb_build_object('item_number',1,'supplier_code','EST01','description','ESTOJO CX12',
    'unit_com','CX','qty_com',2,'total_products',240,'conversion_factor',12,'action','create'))));
do $$ declare s record; begin
  select c.* into s from public.product_cost_summary c join public.products p on p.id = c.product_id
   where p.supplier_sku = 'EST01';
  if s.total_quantity <> 24 or s.average_unit_cost <> 10 then
    raise exception 'FALHOU: conversão de caixa (qtd %, custo %)', s.total_quantity, s.average_unit_cost;
  end if;
  if (select unit from public.products where supplier_sku = 'EST01') <> 'UN' then
    raise exception 'FALHOU: produto de caixa deveria ficar com unidade UN';
  end if;
  raise notice 'OK  conversão de unidade: 2 CX x 12 = 24 un a R$ 10,00';
end $$;

-- Gravação direta nas tabelas de custo/nota é bloqueada
do $$ begin
  begin
    insert into public.product_cost_history (product_id, invoice_item_id, entry_type, occurred_at, quantity,
      products_value, cost_total, unit_cost, cost_rule_id)
    select (select v from _ids where k = 'prod'), id, 'entrada', now(), 1, 1, 1, 1,
           (select id from public.cost_rules where is_active)
    from public.invoice_items limit 1;
    raise exception 'FALHOU: gravação direta no histórico de custo';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.invoices set total_invoice = 0;
    raise exception 'FALHOU: alteração direta de nota';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK  notas e custos só mudam pelas funções de importação';
end $$;

-- Correção de vínculo: move o custo da nota 2 para outro produto, com estorno
insert into public.products (id, commercial_name) values ('30000000-0000-0000-0000-000000000003', 'Mochila certa');

-- EAN que pertence a outro produto impede o vínculo
do $$ begin
  begin
    perform public.relink_invoice_item(
      (select id from public.invoice_items where invoice_id = (select v from _ids where k = 'nf2') and item_number = 2),
      '30000000-0000-0000-0000-000000000003', 'teste de conflito');
    raise exception 'FALHOU: vínculo com EAN de outro produto foi aceito';
  exception when unique_violation then null;
  end;
  raise notice 'OK  correção de vínculo recusa EAN que pertence a outro produto';
end $$;

select public.relink_invoice_item(
  (select id from public.invoice_items where invoice_id = (select v from _ids where k = 'nf2') and item_number = 1),
  '30000000-0000-0000-0000-000000000003', 'Modelo diferente, conferido na etiqueta');
do $$ declare a record; b record; begin
  select * into a from public.product_cost_summary where product_id = (select v from _ids where k = 'prod');
  select * into b from public.product_cost_summary where product_id = '30000000-0000-0000-0000-000000000003';
  if a.average_unit_cost <> 100 or a.total_quantity <> 10 then
    raise exception 'FALHOU: produto antigo deveria voltar a custo 100 (veio %)', a.average_unit_cost;
  end if;
  if b.average_unit_cost <> 130 or b.total_quantity <> 20 then
    raise exception 'FALHOU: produto novo deveria ter custo 130 (veio %)', b.average_unit_cost;
  end if;
  if (select count(*) from public.product_cost_history where entry_type = 'estorno') <> 1 then
    raise exception 'FALHOU: estorno não registrado';
  end if;
  if not exists (select 1 from public.product_identifiers where product_id = '30000000-0000-0000-0000-000000000003'
                 and value = 'MC1601B' and source = 'nfe')
     or exists (select 1 from public.product_identifiers where value = 'MC1601B'
                and product_id = (select v from _ids where k = 'prod')) then
    raise exception 'FALHOU: código do fornecedor não foi movido para o produto correto';
  end if;
  if (select count(*) from public.product_cost_history) <> 5 then
    raise exception 'FALHOU: histórico deveria manter os 5 lançamentos (veio %)', (select count(*) from public.product_cost_history);
  end if;
  raise notice 'OK  correção de vínculo com estorno, histórico preservado';
end $$;

-- Nota de devolução é recusada
do $$ begin
  begin
    perform public.import_invoice(jsonb_build_object(
      'invoice', jsonb_build_object('access_key','42261012345678000199550010000001051000000051','number','105',
        'issued_at','2026-09-27T10:00:00-03:00','purpose',4,'issuer_cnpj','12345678000199','issuer_name','X'),
      'items', jsonb_build_array(jsonb_build_object('item_number',1,'supplier_code','A','description','A',
        'qty_com',1,'total_products',1,'action','ignore'))));
    raise exception 'FALHOU: nota de devolução aceita';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'OK  nota de devolução recusada';
end $$;

-- Operador não ativa regra de custo; admin ativa nova versão
do $$ begin
  begin
    perform public.activate_cost_rule((select id from public.cost_rules where version = 1));
    raise exception 'FALHOU: operador ativou regra';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK  operador não altera a regra de custo';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.cost_rules (version, name, include_ipi, include_freight) values (2, 'Com frete', true, true);
select public.activate_cost_rule((select id from public.cost_rules where version = 2));
do $$ begin
  if (select version from public.cost_rules where is_active) <> 2 then raise exception 'FALHOU: regra 2 não ativou'; end if;
  if (select count(*) from public.cost_rules where is_active) <> 1 then raise exception 'FALHOU: mais de uma regra ativa'; end if;
  raise notice 'OK  admin cria e ativa nova versão da regra (só uma ativa)';
end $$;

-- Anônimo não acessa notas, custos nem funções
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin perform 1 from public.invoices; raise exception 'FALHOU: anon lê notas';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.product_cost_summary; raise exception 'FALHOU: anon lê custos';
  exception when insufficient_privilege then null; end;
  begin perform public.import_invoice('{}'::jsonb); raise exception 'FALHOU: anon importa';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  anônimo bloqueado em notas, custos e importação';
end $$;

reset role;
select 'TODOS OS TESTES PASSARAM' as resultado;
rollback;
