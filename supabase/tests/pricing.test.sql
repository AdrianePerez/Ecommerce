-- Fase 5: regras de preço versionadas, simulações e vitrine
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d4', 'op5@dualshop.local');
update public.profiles set role = 'operador', active = true where id = '00000000-0000-0000-0000-0000000000d4';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d5', 'adm5@dualshop.local');
update public.profiles set role = 'admin', active = true where id = '00000000-0000-0000-0000-0000000000d5';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d5","role":"authenticated"}';

do $$ declare ml uuid; r1 uuid; r2 uuid; begin
  select id into ml from public.marketplace_configs where code = 'mercado_livre';
  select id into r1 from public.pricing_rules where marketplace_id = ml and name = 'Clássico' and is_active;
  if r1 is null then raise exception 'FALHOU: regra inicial ausente'; end if;
  begin
    update public.pricing_rules set tax_pct = 6 where id = r1;
    raise exception 'FALHOU: versão alterada';
  exception when check_violation then null; end;
  begin
    insert into public.pricing_rules (marketplace_id, name, version, tiers) values (ml, 'Clássico', 2, '[{"min_price":10,"commission_pct":14,"fixed_fee":0}]');
    raise exception 'FALHOU: faixa sem zero aceita';
  exception when check_violation then null; end;
  insert into public.pricing_rules (marketplace_id, name, version, tiers, tax_pct) values (ml, 'Clássico', 2, '[{"min_price":0,"commission_pct":14,"fixed_fee":6}]', 6)
    returning id into r2;
  perform public.activate_pricing_rule(r2);
  if (select count(*) from public.pricing_rules where marketplace_id = ml and name = 'Clássico' and is_active) <> 1
     or not (select is_active from public.pricing_rules where id = r2) then raise exception 'FALHOU: ativação'; end if;
  raise notice 'OK  regra de preço versionada: versão gravada não muda; ativar nova desativa a anterior';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}';
insert into public.products (id, nf_description, commercial_name, brand) values ('22000000-0000-0000-0000-000000000001', 'MOCHILA C', 'Mochila C', 'LUXCEL');

do $$ declare ml uuid; tt uuid; rml uuid; rtt uuid; l uuid; s uuid; n int; begin
  select id into ml from public.marketplace_configs where code = 'mercado_livre';
  select id into tt from public.marketplace_configs where code = 'tiktok_shop';
  select id into rml from public.pricing_rules where marketplace_id = ml and is_active limit 1;
  select id into rtt from public.pricing_rules where marketplace_id = tt and is_active limit 1;
  begin
    insert into public.pricing_rules (marketplace_id, name, version, tiers) values (ml, 'X', 1, '[{"min_price":0,"commission_pct":1,"fixed_fee":0}]');
    raise exception 'FALHOU: operador criou regra';
  exception when insufficient_privilege then null; end;
  perform public.activate_pricing_rule(rml) ;
  raise exception 'FALHOU: operador ativou regra';
exception when insufficient_privilege then
  raise notice 'OK  só administrador cria ou ativa regras de preço';
end $$;

do $$ declare ml uuid; tt uuid; rml uuid; rtt uuid; l uuid; s uuid; n int; begin
  select id into ml from public.marketplace_configs where code = 'mercado_livre';
  select id into tt from public.marketplace_configs where code = 'tiktok_shop';
  select id into rml from public.pricing_rules where marketplace_id = ml and is_active limit 1;
  select id into rtt from public.pricing_rules where marketplace_id = tt and is_active limit 1;
  insert into public.product_listings (product_id, marketplace_id, title) values ('22000000-0000-0000-0000-000000000001', ml, 'Mochila C') returning id into l;
  begin
    update public.product_listings set pricing_rule_id = rtt where id = l;
    raise exception 'FALHOU: regra de outro canal';
  exception when check_violation then null; end;
  update public.product_listings set pricing_rule_id = rml, suggested_price = 149.9, shipping_cost = 18.5 where id = l;

  insert into public.pricing_simulations (product_id, listing_id, pricing_rule_id, unit_cost, cost_source, price, shipping_fee, profit, margin_pct, results, applied)
  values ('22000000-0000-0000-0000-000000000001', l, rml, 52.3, 'custo_medio', 149.9, 18.5, 30.1, 20.08, '{"commission":20.99}', true) returning id into s;
  begin
    update public.pricing_simulations set price = 1 where id = s;
    raise exception 'FALHOU: simulação alterada';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  anúncio usa só regra do próprio canal; simulação registrada não muda';

  select count(*) into n from public.showcase_rows where product_id = '22000000-0000-0000-0000-000000000001';
  if n <> 1 or (select suggested_price from public.showcase_rows where listing_id = l) <> 149.9
     or (select has_description from public.showcase_rows where listing_id = l) then
    raise exception 'FALHOU: vitrine';
  end if;
  update public.product_listings set status = 'arquivado' where id = l;
  if (select listing_id from public.showcase_rows where product_id = '22000000-0000-0000-0000-000000000001') is not null then
    raise exception 'FALHOU: anúncio arquivado na vitrine';
  end if;
  raise notice 'OK  vitrine: uma linha por anúncio ativo; produto sem anúncio aparece sozinho';
end $$;

reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.showcase_rows limit 1; raise exception 'FALHOU: anônimo leu vitrine';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.pricing_rules limit 1; raise exception 'FALHOU: anônimo leu regras';
  exception when insufficient_privilege then null; end;
  raise notice 'OK  anônimo bloqueado em vitrine e regras de preço';
end $$;
rollback;
