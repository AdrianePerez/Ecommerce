-- 0013b · Privilégios de app_settings
revoke all on public.app_settings from anon;
revoke delete on public.app_settings from authenticated;
