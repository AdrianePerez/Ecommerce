-- 0009b · Privilégios da fase 5 (separado: o aplicador remoto recusa revoke junto com DDL)
revoke all on public.pricing_rules, public.pricing_simulations, public.showcase_rows from anon;
revoke delete on public.pricing_rules, public.pricing_simulations from authenticated;
revoke update on public.pricing_simulations from authenticated;
revoke execute on function public.check_pricing_rule(), public.check_listing_rule() from public, anon, authenticated;
revoke execute on function public.activate_pricing_rule(uuid) from public, anon;
grant execute on function public.activate_pricing_rule(uuid) to authenticated;
