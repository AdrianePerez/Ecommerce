-- =====================================================================
-- 0003 · Ajustes apontados pelo Security/Performance Advisor do Supabase
-- =====================================================================

-- Funções de gatilho não precisam ser chamáveis pela API (/rest/v1/rpc).
-- Gatilhos continuam funcionando sem o privilégio EXECUTE.
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.protect_profile_privileges() from public, anon, authenticated;
revoke execute on function public.sync_primary_identifiers() from public, anon, authenticated;

-- is_staff()/is_admin() são usadas pelas políticas RLS e precisam continuar
-- executáveis por usuários autenticados (só informam sobre o próprio usuário).
-- O anônimo não precisa delas.
revoke execute on function public.is_staff() from anon;
revoke execute on function public.is_admin() from anon;

-- Avalia auth.uid() uma vez por consulta, e não uma vez por linha
drop policy "profiles: equipe consulta" on public.profiles;
create policy "profiles: equipe consulta" on public.profiles
  for select to authenticated using ((select public.is_staff()) or id = (select auth.uid()));

drop policy "profiles: próprio usuário ou admin altera" on public.profiles;
create policy "profiles: próprio usuário ou admin altera" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- Índice para a chave estrangeira usada na busca por fornecedor
create index if not exists product_identifiers_supplier_idx on public.product_identifiers (supplier_id);
