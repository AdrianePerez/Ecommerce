-- =====================================================================
-- 0012 · Caixa de entrada de XML (e-mail; depois SEFAZ)
--  * integration_tokens: chaves de acesso para integrações externas (ex.:
--    script do Gmail). Guardamos só o hash SHA-256; a chave aparece uma
--    única vez quando o administrador gera. Pode ser revogada.
--  * nfe_inbox: XMLs que chegaram automaticamente e aguardam conferência.
--    Uma linha por chave de acesso. A gravação vem só da Edge Function
--    (service role); a equipe consulta e pode marcar como ignorada.
--    Quando a nota é importada, a linha é marcada "importada" sozinha.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

create table public.integration_tokens (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) > 0),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint    text not null,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
comment on table public.integration_tokens is 'Chaves de integrações externas. Só o hash é guardado.';

-- Gera uma chave nova e devolve o texto UMA vez (somente administrador)
create or replace function public.create_integration_token(p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not public.is_admin() then raise exception 'Somente administradores criam chaves de integração.' using errcode = '42501'; end if;
  v_token := 'dsi_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.integration_tokens (name, token_hash, token_hint)
  values (btrim(p_name), encode(extensions.digest(v_token, 'sha256'), 'hex'), right(v_token, 4));
  return v_token;
end $$;

create table public.nfe_inbox (
  id             uuid primary key default gen_random_uuid(),
  access_key     text not null unique check (access_key ~ '^\d{44}$'),
  source         text not null check (source in ('email', 'sefaz')),
  status         text not null default 'nova' check (status in ('nova', 'importada', 'ignorada', 'cancelada')),
  has_full_xml   boolean not null default true,
  xml_path       text,
  number         text,
  series         text,
  issued_at      timestamptz,
  issuer_cnpj    text,
  issuer_name    text,
  recipient_doc  text,
  total_invoice  numeric(15, 2),
  email_from     text,
  email_subject  text,
  file_name      text,
  invoice_id     uuid references public.invoices (id) on delete set null,
  ignored_reason text,
  received_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint nfe_inbox_xml check (not has_full_xml or xml_path is not null)
);
create index nfe_inbox_status_idx on public.nfe_inbox (status, issued_at desc);
comment on table public.nfe_inbox is 'XMLs recebidos automaticamente (e-mail/SEFAZ) aguardando conferência e importação.';

create trigger nfe_inbox_updated_at before update on public.nfe_inbox
  for each row execute function public.set_updated_at();

-- Só status e motivo podem ser mudados pela equipe
create or replace function public.guard_nfe_inbox_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
       (to_jsonb(new) - array['status', 'ignored_reason', 'updated_at']) is distinct from (to_jsonb(old) - array['status', 'ignored_reason', 'updated_at'])
       or new.status not in ('nova', 'ignorada')) then
    raise exception 'Na caixa de entrada só é possível ignorar ou reabrir uma nota.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger nfe_inbox_guard before update on public.nfe_inbox
  for each row execute function public.guard_nfe_inbox_update();

-- Nota importada → marca a entrada da caixa como importada
create or replace function public.mark_inbox_imported()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.nfe_inbox set status = 'importada', invoice_id = new.id where access_key = new.access_key;
  return new;
end $$;
create trigger invoices_mark_inbox after insert on public.invoices
  for each row execute function public.mark_inbox_imported();

create trigger nfe_inbox_audit after insert or update or delete on public.nfe_inbox
  for each row execute function public.audit_row();
create trigger integration_tokens_audit after insert or update or delete on public.integration_tokens
  for each row execute function public.audit_row();

alter table public.integration_tokens enable row level security;
alter table public.nfe_inbox enable row level security;

create policy "integration_tokens: admin consulta" on public.integration_tokens for select to authenticated using ((select public.is_admin()));
create policy "integration_tokens: admin revoga" on public.integration_tokens for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "nfe_inbox: equipe consulta" on public.nfe_inbox for select to authenticated using ((select public.is_staff()));
create policy "nfe_inbox: equipe ignora ou reabre" on public.nfe_inbox for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
