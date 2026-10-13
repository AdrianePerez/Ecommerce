-- Catálogos: envio, correspondência por código e aprovação
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b2', 'operador.teste@dualshop.local');
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000b2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

insert into public.suppliers (id, name, trade_name, cnpj) values ('10000000-0000-0000-0000-000000000001', 'MAXLOG', 'LUXCEL', '12345678000199');
insert into public.products (id, nf_description, supplier_sku, main_supplier_id, height_mm, material) values
  ('20000000-0000-0000-0000-000000000001', 'MOCHILA CINNAMOROLL AZUL UN', 'IS43481SR0200UN', '10000000-0000-0000-0000-000000000001', 400, null),
  ('20000000-0000-0000-0000-000000000002', 'ESTOJO CINNAMOROLL', 'EI43484SR0200UN', '10000000-0000-0000-0000-000000000001', null, null);

insert into public.supplier_catalogs (id, supplier_id, name, collection_year, file_name, file_size, file_sha256, pdf_page_count)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Volta às aulas 2026', 2026,
        'cat.pdf', 173531218, repeat('a', 64), 128);
insert into public.catalog_pages (id, catalog_id, page_number, pdf_page, side, image_path, width, height)
values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 99, 51, 'L', 'x/p099.jpg', 1052, 1488);

-- Mesmo PDF de novo: recusado
do $$ begin
  begin
    insert into public.supplier_catalogs (name, file_name, file_size, file_sha256, pdf_page_count) values ('X', 'y.pdf', 1, repeat('a', 64), 1);
    raise exception 'FALHOU: PDF repetido aceito';
  exception when unique_violation then null; end;
  raise notice 'OK  mesmo PDF (impressão digital) não é enviado duas vezes';
end $$;

insert into public.catalog_items (id, catalog_id, page_id, code, name, height_mm, width_mm, depth_mm, material,
  suggested_price, box_qty, color_code, size_label, features, bbox, source, confidence)
values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
  'IS43481SR', 'Mochila Cinnamoroll 16', 410, 310, 150, 'Náilon', 59.99, 12, 'AZ-1214', '16"', array['Bolso frontal'],
  '{"x":0.49,"y":0.5,"w":0.34,"h":0.38}', 'manual', null);

-- Área da foto fora da página é recusada
do $$ begin
  begin
    insert into public.catalog_items (catalog_id, page_id, code, bbox) values ('30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001', 'X1', '{"x":0.8,"y":0.1,"w":0.5,"h":0.2}');
    raise exception 'FALHOU: bbox fora da página aceito';
  exception when check_violation then null; end;
  raise notice 'OK  área da foto precisa estar dentro da página';
end $$;

-- Correspondência: código do catálogo é o começo do código da nota
do $$ declare r record; begin
  select * into r from public.match_catalog_code('is43481sr');
  if r.product_id is distinct from '20000000-0000-0000-0000-000000000001' or r.exact then
    raise exception 'FALHOU: correspondência por prefixo';
  end if;
  if (select count(*) from public.match_catalog_code('IS4')) <> 0 then raise exception 'FALHOU: código curto demais casou'; end if;
  raise notice 'OK  código do catálogo encontra o produto da nota (IS43481SR → IS43481SR0200UN)';
end $$;

-- Aprovar: preenche só vazios (altura 400 mantida; largura, profundidade e material preenchidos)
select public.approve_catalog_item('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
do $$ declare p record; begin
  select * into p from public.products where id = '20000000-0000-0000-0000-000000000001';
  if p.height_mm <> 400 or p.width_mm <> 310 or p.depth_mm <> 150 or p.material <> 'Náilon'
     or p.model <> 'IS43481SR' or p.collection <> 'Volta às aulas 2026' or p.collection_year <> 2026 then
    raise exception 'FALHOU: aprovação deveria só preencher vazios (%, %, %)', p.height_mm, p.width_mm, p.material;
  end if;
  if (select value_num from public.product_attributes where product_id = p.id and attr_key = 'preco_sugerido_catalogo') <> 59.99
     or (select source from public.product_attributes where product_id = p.id and attr_key = 'qtd_por_caixa') <> 'catalogo'
     or (select source_ref from public.product_attributes where product_id = p.id and attr_key = 'codigo_cor') not like '%página 99%' then
    raise exception 'FALHOU: atributos do catálogo com fonte';
  end if;
  if (select status from public.catalog_items where id = '50000000-0000-0000-0000-000000000001') <> 'aprovado' then
    raise exception 'FALHOU: item não ficou aprovado';
  end if;
  raise notice 'OK  aprovação preenche só campos vazios e registra atributos com a fonte (catálogo e página)';
end $$;

-- Item aprovado não pode ser editado/removido diretamente
do $$ begin
  update public.catalog_items set code = 'MUDOU' where id = '50000000-0000-0000-0000-000000000001';
  if (select code from public.catalog_items where id = '50000000-0000-0000-0000-000000000001') <> 'IS43481SR' then
    raise exception 'FALHOU: item aprovado foi alterado';
  end if;
  delete from public.catalog_items where id = '50000000-0000-0000-0000-000000000001';
  if not exists (select 1 from public.catalog_items where id = '50000000-0000-0000-0000-000000000001') then
    raise exception 'FALHOU: item aprovado foi removido';
  end if;
  begin
    insert into public.catalog_items (catalog_id, page_id, code, status) values
      ('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Z', 'aprovado');
    raise exception 'FALHOU: inserir já aprovado';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  item aprovado fica protegido; aprovação só pela função';
end $$;

-- Divergência escolhida explicitamente substitui (altura do catálogo 410)
insert into public.catalog_items (id, catalog_id, page_id, code, height_mm)
values ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'IS43481SR', 410);
select public.approve_catalog_item('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', array['height_mm']);
do $$ begin
  if (select height_mm from public.products where id = '20000000-0000-0000-0000-000000000001') <> 410 then
    raise exception 'FALHOU: substituição escolhida não aplicada';
  end if;
  begin
    perform public.approve_catalog_item('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', array['ncm']);
    raise exception 'FALHOU: campo não permitido';
  exception when invalid_parameter_value then null; end;
  raise notice 'OK  divergência só é substituída quando escolhida';
end $$;

-- Excluir o catálogo remove páginas e itens, mas mantém os dados aplicados no produto
delete from public.supplier_catalogs where id = '30000000-0000-0000-0000-000000000001';
do $$ begin
  if exists (select 1 from public.catalog_pages where catalog_id = '30000000-0000-0000-0000-000000000001')
     or exists (select 1 from public.catalog_items where catalog_id = '30000000-0000-0000-0000-000000000001') then
    raise exception 'FALHOU: páginas/itens ficaram após excluir';
  end if;
  if (select width_mm from public.products where id = '20000000-0000-0000-0000-000000000001') <> 310
     or not exists (select 1 from public.product_attributes where product_id = '20000000-0000-0000-0000-000000000001' and source = 'catalogo') then
    raise exception 'FALHOU: dados aprovados sumiram do produto';
  end if;
  raise notice 'OK  excluir catálogo libera páginas e itens; dados aprovados continuam no produto';
end $$;

-- Anônimo
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.supplier_catalogs; raise exception 'FALHOU: anon lê catálogos';
  exception when insufficient_privilege then null; end;
  begin perform public.approve_catalog_item(gen_random_uuid(), gen_random_uuid()); raise exception 'FALHOU: anon aprova';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  anônimo bloqueado';
end $$;
reset role;
select 'TODOS OS TESTES PASSARAM' as resultado;
rollback;
