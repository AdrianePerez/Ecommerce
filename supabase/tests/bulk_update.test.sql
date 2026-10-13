-- Alteração em massa
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b2', 'operador.teste@dualshop.local');
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000b2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

insert into public.products (id, commercial_name, material, ncm, fiscal_source) values
  ('20000000-0000-0000-0000-000000000001', 'A', null, '42029200', 'nfe'),
  ('20000000-0000-0000-0000-000000000002', 'B', 'COURO', null, null),
  ('20000000-0000-0000-0000-000000000003', 'C (fora da seleção)', null, null, null);

-- Substituir: material e medidas em A e B
do $$ declare n int; begin
  n := public.bulk_update_products(array['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002']::uuid[],
       '{"material":"POLIESTER","height_mm":"420","width_mm":"300","depth_mm":"150","weight_g":"850.5"}'::jsonb, false);
  if n <> 2 then raise exception 'FALHOU: deveria alterar 2 (veio %)', n; end if;
  if (select string_agg(material || '/' || height_mm || '/' || weight_g, ',' order by commercial_name) from public.products
      where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002')) <> 'POLIESTER/420.0/850.5,POLIESTER/420.0/850.5' then
    raise exception 'FALHOU: valores não aplicados';
  end if;
  if (select material from public.products where commercial_name like 'C%') is not null then raise exception 'FALHOU: alterou produto fora da seleção'; end if;
  raise notice 'OK  substitui os campos marcados só nos produtos selecionados';
end $$;

-- Só preencher vazios: cor e NCM; A já tem NCM da nota (mantém origem nfe), B recebe NCM com origem manual
do $$ begin
  perform public.bulk_update_products(array['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002']::uuid[],
       '{"color":"PRETO","ncm":"42021220"}'::jsonb, true);
  if (select ncm || '/' || fiscal_source from public.products where commercial_name = 'A') <> '42029200/nfe' then
    raise exception 'FALHOU: NCM preenchido não deveria mudar';
  end if;
  if (select ncm || '/' || fiscal_source from public.products where commercial_name = 'B') <> '42021220/manual' then
    raise exception 'FALHOU: NCM vazio deveria ser preenchido com origem manual';
  end if;
  perform public.bulk_update_products(array['20000000-0000-0000-0000-000000000002']::uuid[], '{"material":"NYLON"}'::jsonb, true);
  if (select material from public.products where commercial_name = 'B') <> 'POLIESTER' then raise exception 'FALHOU: só vazios substituiu'; end if;
  raise notice 'OK  "só preencher vazios" não altera valores existentes; NCM manual registra origem';
end $$;

-- Pronto com cadastro incompleto: recusa tudo, nada muda
do $$ begin
  begin
    perform public.bulk_update_products(array['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002']::uuid[],
       '{"status":"pronto","collection":"2027"}'::jsonb, false);
    raise exception 'FALHOU: pronto aceito';
  exception when check_violation then null; end;
  if exists (select 1 from public.products where collection = '2027') then raise exception 'FALHOU: alteração parcial ficou gravada'; end if;
  raise notice 'OK  status pronto com cadastro incompleto é recusado sem alteração parcial';
end $$;

-- Campos não permitidos e valores inválidos
do $$ begin
  begin perform public.bulk_update_products(array['20000000-0000-0000-0000-000000000001']::uuid[], '{"ean":"7891234567895"}'::jsonb);
    raise exception 'FALHOU: EAN em massa aceito'; exception when invalid_parameter_value then null; end;
  begin perform public.bulk_update_products(array['20000000-0000-0000-0000-000000000001']::uuid[], '{"capacity_value":"20"}'::jsonb);
    raise exception 'FALHOU: capacidade sem unidade'; exception when invalid_parameter_value then null; end;
  begin perform public.bulk_update_products(array['20000000-0000-0000-0000-000000000001']::uuid[], '{"ncm":"123"}'::jsonb);
    raise exception 'FALHOU: NCM inválido'; exception when check_violation then null; end;
  begin perform public.bulk_update_products(array['20000000-0000-0000-0000-000000000001']::uuid[], '{"brand; drop table x":"a"}'::jsonb);
    raise exception 'FALHOU: chave maliciosa'; exception when invalid_parameter_value then null; end;
  raise notice 'OK  recusa campos não permitidos, capacidade incompleta e valores inválidos';
end $$;

-- Auditoria registra a alteração de cada produto
do $$ begin
  if (select count(*) from public.audit_logs where table_name = 'products' and action = 'UPDATE'
      and record_id = '20000000-0000-0000-0000-000000000002') < 2 then raise exception 'FALHOU: auditoria'; end if;
  raise notice 'OK  histórico de cada produto registra a alteração em massa';
end $$;

-- Anônimo não executa
reset role;
set local role anon;
do $$ begin
  begin perform public.bulk_update_products(array[gen_random_uuid()], '{"material":"x"}'::jsonb);
    raise exception 'FALHOU: anon executou'; exception when insufficient_privilege then null; end;
  raise notice 'OK  anônimo bloqueado';
end $$;
reset role;
select 'TODOS OS TESTES PASSARAM' as resultado;
rollback;
