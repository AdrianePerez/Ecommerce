-- Preenchimento automático de marca e SKU interno
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b2', 'operador.teste@dualshop.local');
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000b2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

insert into public.suppliers (id, name, trade_name, cnpj) values
  ('10000000-0000-0000-0000-000000000001', 'SESTINI MERCANTIL LTDA', 'SESTINI', '12345678000199'),
  ('10000000-0000-0000-0000-000000000002', 'OUTRO LTDA', null, '02345678000199');

-- Importação cria produto: marca e SKU interno preenchidos
select public.import_invoice($j${
  "invoice": {"access_key":"42261012345678000199550010000001011000000011","number":"101","issued_at":"2026-09-01T10:00:00-03:00",
    "purpose":1,"issuer_cnpj":"12345678000199","issuer_name":"SESTINI MERCANTIL LTDA"},
  "items": [{"item_number":1,"supplier_code":"MC1601","description":"MOCHILA","qty_com":1,"total_products":10,"action":"create"}]}$j$::jsonb);
do $$ begin
  if (select brand from public.products where supplier_sku = 'MC1601') is distinct from 'SESTINI'
     or (select internal_sku from public.products where supplier_sku = 'MC1601') is distinct from 'MC1601' then
    raise exception 'FALHOU: marca/SKU não preenchidos na importação';
  end if;
  raise notice 'OK  importação preenche marca (nome fantasia) e SKU interno (código do fornecedor)';
end $$;

-- Valores informados não são substituídos
insert into public.products (commercial_name, brand, internal_sku, supplier_sku, main_supplier_id)
values ('B', 'Up4you', 'DS-1', 'X1', '10000000-0000-0000-0000-000000000001');
-- Código já usado como SKU interno de outro produto: fica vazio (sem erro)
insert into public.products (commercial_name, supplier_sku, main_supplier_id)
values ('C', 'mc1601', '10000000-0000-0000-0000-000000000002');
do $$ begin
  if (select brand || '/' || internal_sku from public.products where commercial_name = 'B') <> 'Up4you/DS-1' then
    raise exception 'FALHOU: valores informados foram substituídos';
  end if;
  if (select internal_sku from public.products where commercial_name = 'C') is not null
     or (select brand from public.products where commercial_name = 'C') is not null then
    raise exception 'FALHOU: SKU repetido ou fornecedor sem nome fantasia deveria deixar vazio';
  end if;
  raise notice 'OK  não substitui valores informados; SKU repetido e fornecedor sem fantasia ficam vazios';
end $$;

-- Usuário pode apagar a marca depois (o preenchimento só vale na criação)
update public.products set brand = null where supplier_sku = 'MC1601';
do $$ begin
  if (select brand from public.products where supplier_sku = 'MC1601') is not null then raise exception 'FALHOU: marca voltou'; end if;
  raise notice 'OK  depois de criado, o usuário altera livremente';
end $$;

reset role;
select 'TODOS OS TESTES PASSARAM' as resultado;
rollback;
