-- Testes de segurança e integridade do cadastro mestre.
-- Roda dentro de uma transação e desfaz tudo no final (ROLLBACK).
-- Qualquer falha interrompe com erro "FALHOU: ...".
begin;

-- Usuários de teste
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin.teste@dualshop.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'operador.teste@dualshop.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'inativo.teste@dualshop.local');

-- Garante papéis conhecidos independentemente de usuários já existentes
update public.profiles set role = 'admin', active = true where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000b2';
update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000000c3';

do $$ begin
  if (select count(*) from public.profiles where id::text like '00000000-0000-0000-0000-0000000000%') <> 3 then
    raise exception 'FALHOU: perfis não foram criados pelo gatilho de novo usuário';
  end if;
  raise notice 'OK  perfis criados automaticamente';
end $$;

-- Dados como operador
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

insert into public.suppliers (id, name, cnpj)
values ('10000000-0000-0000-0000-000000000001', 'Fornecedor Teste', '12345678000199');

insert into public.products (id, commercial_name, brand, ean, supplier_sku, main_supplier_id)
values ('20000000-0000-0000-0000-000000000001', 'Mochila teste', 'Marca', '7891234567895', 'ABC-1',
        '10000000-0000-0000-0000-000000000001');

do $$ begin
  if (select count(*) from public.product_identifiers
      where product_id = '20000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'FALHOU: EAN e código do fornecedor não foram espelhados em product_identifiers';
  end if;
  raise notice 'OK  identificadores principais espelhados';
end $$;

-- EAN duplicado em outro produto deve ser recusado
do $$ begin
  begin
    insert into public.products (commercial_name, ean) values ('Outro', '7891234567895');
    raise exception 'FALHOU: EAN duplicado foi aceito';
  exception when unique_violation then
    raise notice 'OK  EAN duplicado recusado';
  end;
end $$;

-- Código do mesmo fornecedor duplicado (sem diferenciar maiúsculas) deve ser recusado
do $$ begin
  begin
    insert into public.products (commercial_name, supplier_sku, main_supplier_id)
    values ('Outro', 'abc-1', '10000000-0000-0000-0000-000000000001');
    raise exception 'FALHOU: código de fornecedor duplicado foi aceito';
  exception when unique_violation then
    raise notice 'OK  código de fornecedor duplicado recusado';
  end;
end $$;

-- SKU interno único sem diferenciar maiúsculas
insert into public.products (commercial_name, internal_sku) values ('A', 'DS-0001');
do $$ begin
  begin
    insert into public.products (commercial_name, internal_sku) values ('B', 'ds-0001');
    raise exception 'FALHOU: SKU interno duplicado foi aceito';
  exception when unique_violation then
    raise notice 'OK  SKU interno duplicado recusado';
  end;
end $$;

-- Dado fiscal não pode ter IA como origem nem ficar sem origem
do $$ begin
  begin
    update public.products set ncm = '42029200', fiscal_source = 'ia'
    where id = '20000000-0000-0000-0000-000000000001';
    raise exception 'FALHOU: origem fiscal "ia" foi aceita';
  exception when check_violation then
    raise notice 'OK  origem fiscal por IA recusada';
  end;
  begin
    update public.products set ncm = '42029200', fiscal_source = null
    where id = '20000000-0000-0000-0000-000000000001';
    raise exception 'FALHOU: NCM sem origem foi aceito';
  exception when check_violation then
    raise notice 'OK  NCM sem origem recusado';
  end;
end $$;

-- "Pronto para publicar" exige cadastro completo
do $$ begin
  begin
    update public.products set status = 'pronto' where id = '20000000-0000-0000-0000-000000000001';
    raise exception 'FALHOU: produto incompleto marcado como pronto';
  exception when check_violation then
    raise notice 'OK  "pronto" bloqueado com cadastro incompleto';
  end;
end $$;

-- Exclusão física de produto não é permitida
do $$ begin
  begin
    delete from public.products where id = '20000000-0000-0000-0000-000000000001';
    raise exception 'FALHOU: produto foi excluído fisicamente';
  exception when insufficient_privilege then
    raise notice 'OK  exclusão física de produto bloqueada';
  end;
end $$;

-- Operador não pode se promover a admin
do $$ begin
  begin
    update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b2';
    raise exception 'FALHOU: operador alterou o próprio papel';
  exception when insufficient_privilege then
    raise notice 'OK  operador não altera o próprio papel';
  end;
end $$;

-- Auditoria registrou a criação do produto
do $$ begin
  if not exists (select 1 from public.audit_logs
                 where table_name = 'products' and action = 'INSERT'
                   and record_id = '20000000-0000-0000-0000-000000000001') then
    raise exception 'FALHOU: auditoria não registrou o produto';
  end if;
  raise notice 'OK  auditoria registrada';
end $$;

-- Usuário inativo não enxerga nada
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.products) or exists (select 1 from public.suppliers) then
    raise exception 'FALHOU: usuário inativo consegue ler dados';
  end if;
  begin
    insert into public.products (commercial_name) values ('Invasor');
    raise exception 'FALHOU: usuário inativo conseguiu gravar';
  exception when insufficient_privilege then
    raise notice 'OK  usuário inativo bloqueado (leitura e gravação)';
  end;
end $$;

-- Anônimo não acessa nada
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform 1 from public.products limit 1;
    raise exception 'FALHOU: anônimo leu produtos';
  exception when insufficient_privilege then
    raise notice 'OK  anônimo bloqueado em products';
  end;
  begin
    perform 1 from public.product_overview limit 1;
    raise exception 'FALHOU: anônimo leu product_overview';
  exception when insufficient_privilege then
    raise notice 'OK  anônimo bloqueado em product_overview';
  end;
  begin
    perform 1 from public.profiles limit 1;
    raise exception 'FALHOU: anônimo leu profiles';
  exception when insufficient_privilege then
    raise notice 'OK  anônimo bloqueado em profiles';
  end;
end $$;

-- Admin pode desativar operador
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000000b2';
do $$ begin
  if (select active from public.profiles where id = '00000000-0000-0000-0000-0000000000b2') then
    raise exception 'FALHOU: admin não conseguiu desativar operador';
  end if;
  raise notice 'OK  admin gerencia usuários';
end $$;

select 'TODOS OS TESTES PASSARAM' as resultado;
rollback;
