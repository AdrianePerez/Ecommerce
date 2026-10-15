-- 0011b · Privilégios do monitor de notas
revoke all on public.invoice_monitor from anon;
revoke execute on function public.set_invoice_received(uuid, date) from public, anon;
grant execute on function public.set_invoice_received(uuid, date) to authenticated;
