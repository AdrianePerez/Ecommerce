-- Fase 4: galeria, fontes, regras por canal e anúncios
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c3', 'op4@dualshop.local');
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000c3';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

insert into public.products (id, nf_description, commercial_name, brand) values
  ('21000000-0000-0000-0000-000000000001', 'MOCHILA A', 'Mochila A', 'LUXCEL'),
  ('21000000-0000-0000-0000-000000000002', 'MOCHILA B', 'Mochila B', 'LUXCEL');

insert into public.product_images (id, product_id, storage_path, mime_type, sha256, kind) values
  ('61000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'a/1.jpg', 'image/jpeg', repeat('1', 64), 'oficial'),
  ('61000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 'a/2.jpg', 'image/jpeg', repeat('2', 64), 'detalhe'),
  ('61000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000002', 'b/1.jpg', 'image/jpeg', repeat('3', 64), 'oficial');

do $$ begin
  begin
    insert into public.product_images (product_id, storage_path, mime_type, sha256)
    values ('21000000-0000-0000-0000-000000000001', 'a/dup.jpg', 'image/jpeg', repeat('1', 64));
    raise exception 'FALHOU: mesma imagem duas vezes no produto';
  exception when unique_violation then null; end;
  raise notice 'OK  mesma imagem (SHA-256) não entra duas vezes no produto';
end $$;

do $$ begin
  begin
    update public.product_images set is_main = true where id = '61000000-0000-0000-0000-000000000001';
    raise exception 'FALHOU: principal sem aprovação';
  exception when check_violation then null; end;
  update public.product_images set status = 'aprovada' where id in ('61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000003');
  perform public.set_main_image('61000000-0000-0000-0000-000000000001');
  perform public.set_main_image('61000000-0000-0000-0000-000000000002');
  if (select count(*) from public.product_images where product_id = '21000000-0000-0000-0000-000000000001' and is_main) <> 1
     or not (select is_main from public.product_images where id = '61000000-0000-0000-0000-000000000002') then
    raise exception 'FALHOU: troca da principal';
  end if;
  raise notice 'OK  principal só aprovada, e só uma por produto';
end $$;

do $$ begin
  begin
    insert into public.product_images (product_id, parent_image_id, storage_path, mime_type, sha256)
    values ('21000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000001', 'b/v.jpg', 'image/jpeg', repeat('9', 64));
    raise exception 'FALHOU: versão de outro produto';
  exception when check_violation then null; end;
  insert into public.product_images (product_id, parent_image_id, storage_path, mime_type, sha256, kind)
  values ('21000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'a/1_canva.jpg', 'image/jpeg', repeat('8', 64), 'gerada_editada');
  begin
    update public.product_images set storage_path = 'a/outro.jpg' where id = '61000000-0000-0000-0000-000000000001';
    raise exception 'FALHOU: arquivo trocado';
  exception when check_violation then null; end;
  begin
    delete from public.product_images where id = '61000000-0000-0000-0000-000000000001';
    if found then raise exception 'FALHOU: imagem aprovada excluída'; end if;
  end;
  raise notice 'OK  original preservado: versão tratada é nova imagem; aprovada não é excluída';
end $$;

-- Fonte e atributo vinculado
do $$ declare s uuid; begin
  insert into public.product_research_sources (product_id, source_type, title, url)
  values ('21000000-0000-0000-0000-000000000001', 'fabricante', 'Site Luxcel', 'https://luxcel.com.br/x') returning id into s;
  insert into public.product_attributes (product_id, attr_key, label, value_text, source, research_source_id, validation_status)
  values ('21000000-0000-0000-0000-000000000001', 'tecido', 'Tecido', 'Poliéster', 'pesquisa', s, 'aguardando_revisao');
  begin
    insert into public.product_research_sources (product_id, title, url) values ('21000000-0000-0000-0000-000000000001', 'x', 'javascript:alert(1)');
    raise exception 'FALHOU: URL inválida aceita';
  exception when check_violation then null; end;
  raise notice 'OK  fonte registrada (só http/https) e atributo aponta para a fonte';
end $$;

-- Anúncio
do $$ declare ml uuid; l uuid; iss text[]; begin
  select id into ml from public.marketplace_configs where code = 'mercado_livre';
  begin
    insert into public.product_listings (product_id, marketplace_id, status) values ('21000000-0000-0000-0000-000000000001', ml, 'publicado');
    raise exception 'FALHOU: anúncio criado já publicado';
  exception when check_violation then null; end;

  insert into public.product_listings (product_id, marketplace_id, title) values ('21000000-0000-0000-0000-000000000001', ml, repeat('x', 61))
  returning id into l;
  begin
    insert into public.product_listings (product_id, marketplace_id) values ('21000000-0000-0000-0000-000000000001', ml);
    raise exception 'FALHOU: dois anúncios ativos iguais';
  exception when unique_violation then null; end;

  begin
    update public.product_listings set main_image_id = '61000000-0000-0000-0000-000000000003' where id = l;
    raise exception 'FALHOU: imagem de outro produto no anúncio';
  exception when check_violation then null; end;

  iss := public.listing_issues(l);
  if not ('Título com 61 caracteres (máximo 60)' = any (iss)) or not ('Atributo "Marca" não preenchido' = any (iss)) then
    raise exception 'FALHOU: pendências %', iss;
  end if;
  begin
    update public.product_listings set status = 'pronto_para_publicar' where id = l;
    raise exception 'FALHOU: pronto com pendências';
  exception when check_violation then
    if sqlerrm not like 'ANUNCIO_INCOMPLETO:%' then raise; end if;
  end;

  -- Corrige tudo e marca como pronto no MESMO salvamento
  insert into public.listing_assets (listing_id, image_id, position) values (l, '61000000-0000-0000-0000-000000000002', 1);
  update public.product_listings set title = 'Mochila A Luxcel', description = 'Texto', category_suggested = 'Mochilas',
    main_image_id = '61000000-0000-0000-0000-000000000001', suggested_price = 159.9,
    attributes = '{"marca":"Luxcel","modelo":"IS43481SR"}', status = 'pronto_para_publicar' where id = l;
  if (select last_reviewed_at from public.product_listings where id = l) is null then raise exception 'FALHOU: revisão não registrada'; end if;

  update public.product_listings set description = '<p>Texto</p>', status = 'em_revisao' where id = l;
  if not ('Descrição contém HTML, e este canal aceita só texto' = any (public.listing_issues(l))) then raise exception 'FALHOU: HTML'; end if;
  -- imagem do anúncio rejeitada depois: volta a ser pendência
  perform public.set_main_image('61000000-0000-0000-0000-000000000001');
  update public.product_images set status = 'rejeitada' where id = '61000000-0000-0000-0000-000000000002';
  if not ('Há imagens no anúncio que não estão aprovadas ou sem uso permitido' = any (public.listing_issues(l))) then
    raise exception 'FALHOU: imagem rejeitada não apontada';
  end if;
  raise notice 'OK  anúncio só fica pronto com os obrigatórios do canal; imagens do próprio produto';
end $$;

do $$ begin
  begin
    update public.marketplace_configs set title_max = 100 where code = 'mercado_livre';
    if found then raise exception 'FALHOU: operador alterou regra do canal'; end if;
  end;
  raise notice 'OK  regras do canal: só administrador altera';
end $$;

-- Anônimo bloqueado
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.product_listings limit 1;
    raise exception 'FALHOU: anônimo leu anúncios';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  anônimo bloqueado em anúncios e imagens';
end $$;
rollback;
