-- 0012b · Privilégios da caixa de entrada de XML
revoke all on public.integration_tokens, public.nfe_inbox from anon;
revoke insert, delete on public.integration_tokens, public.nfe_inbox from authenticated;
revoke execute on function public.guard_nfe_inbox_update(), public.mark_inbox_imported() from public, anon, authenticated;
revoke execute on function public.create_integration_token(text) from public, anon;
grant execute on function public.create_integration_token(text) to authenticated;
