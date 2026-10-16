-- =====================================================================
-- 0013 · Configurações simples do sistema (chave/valor)
--  * gmail_sync_url: endereço do "app da Web" do script do Gmail, chamado
--    pelo botão Sincronizar.
--  * gmail_sync_secret: segredo que o script confere antes de rodar (sem ele,
--    quem souber o endereço não consegue disparar a varredura).
--  Leitura pela equipe; gravação só por administrador.
-- =====================================================================
create table public.app_settings (
  key         text primary key check (key in ('gmail_sync_url', 'gmail_sync_secret')),
  value       text not null,
  updated_by  uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint app_settings_url check (key <> 'gmail_sync_url' or value ~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$'),
  constraint app_settings_secret check (key <> 'gmail_sync_secret' or value ~ '^[0-9a-f]{32,}$')
);
comment on table public.app_settings is 'Configurações do sistema (chave/valor).';

create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();
create trigger app_settings_audit after insert or update or delete on public.app_settings
  for each row execute function public.audit_row();

alter table public.app_settings enable row level security;
create policy "app_settings: equipe consulta" on public.app_settings for select to authenticated using ((select public.is_staff()));
create policy "app_settings: admin cria" on public.app_settings for insert to authenticated with check ((select public.is_admin()));
create policy "app_settings: admin altera" on public.app_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
