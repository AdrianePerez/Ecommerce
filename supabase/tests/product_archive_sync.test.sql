-- Arquivar pela alteração em massa também preenche archived_at
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f8', 'op8@dualshop.local');
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000f8';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f8","role":"authenticated"}';
do $$ declare p uuid; begin
  insert into public.products (nf_description) values ('PRODUTO ARQUIVO') returning id into p;
  perform public.bulk_update_products(array[p], '{"status":"arquivado"}'::jsonb, false);
  if (select archived_at from public.products where id = p) is null then raise exception 'FALHOU: em massa não arquivou'; end if;
  perform public.bulk_update_products(array[p], '{"status":"novo"}'::jsonb, false);
  if (select archived_at from public.products where id = p) is not null then raise exception 'FALHOU: reativar não limpou'; end if;
  raise notice 'OK  status Arquivado (inclusive em massa) controla a data de arquivamento';
end $$;
rollback;
