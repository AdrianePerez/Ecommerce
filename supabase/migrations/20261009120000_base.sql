-- =====================================================================
-- 0001 · Base do sistema
-- Perfis de usuário, papéis, funções de autorização, auditoria,
-- gatilho de updated_at e buckets privados de armazenamento.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Papéis e perfis
-- ---------------------------------------------------------------------
create type public.user_role as enum ('admin', 'operador');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  role        public.user_role not null default 'operador',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'Usuários internos. Somente perfis ativos acessam os dados operacionais.';

-- Usuário autenticado e ativo
create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Cria o perfil quando um usuário é convidado/criado.
-- O primeiro usuário do sistema vira administrador.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'operador'::public.user_role
         else 'admin'::public.user_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Somente administradores alteram papel ou situação de um perfil.
-- (security invoker: current_user é o papel da requisição; operações de
--  manutenção feitas pelo painel do Supabase ou service_role não são bloqueadas.)
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and not public.is_admin() then
    raise exception 'Somente administradores podem alterar papel ou situação de usuários'
      using errcode = '42501';
  end if;
  if old.id = auth.uid() and new.active = false then
    raise exception 'Você não pode desativar o seu próprio usuário' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_privileges();

alter table public.profiles enable row level security;

create policy "profiles: equipe consulta" on public.profiles
  for select to authenticated using (public.is_staff() or id = auth.uid());

create policy "profiles: próprio usuário ou admin altera" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   uuid,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  actor_id    uuid,
  created_at  timestamptz not null default now()
);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id, created_at desc);
comment on table public.audit_logs is 'Registro imutável das alterações em tabelas críticas.';

create or replace function public.audit_row()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  rec_id uuid;
begin
  if tg_op = 'DELETE' then
    rec_id := (to_jsonb(old) ->> 'id')::uuid;
  else
    rec_id := (to_jsonb(new) ->> 'id')::uuid;
  end if;

  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, actor_id)
  values (
    tg_table_name,
    rec_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;

alter table public.audit_logs enable row level security;
create policy "audit_logs: equipe consulta" on public.audit_logs
  for select to authenticated using (public.is_staff());
-- Sem políticas de insert/update/delete: só o gatilho (security definer) grava.

-- ---------------------------------------------------------------------
-- Defesa adicional: o papel anônimo não acessa nenhuma tabela
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.audit_logs from anon;

-- ---------------------------------------------------------------------
-- Armazenamento: buckets privados
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('nfe-xml', 'nfe-xml', false),
  ('catalogs', 'catalogs', false),
  ('product-images', 'product-images', false)
on conflict (id) do nothing;

create policy "storage: equipe lê arquivos internos" on storage.objects
  for select to authenticated
  using (bucket_id in ('nfe-xml', 'catalogs', 'product-images') and public.is_staff());

create policy "storage: equipe envia arquivos internos" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('nfe-xml', 'catalogs', 'product-images') and public.is_staff());

create policy "storage: equipe atualiza imagens" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_staff())
  with check (bucket_id = 'product-images' and public.is_staff());
-- XML de notas e catálogos originais não podem ser sobrescritos nem apagados pelo app.
