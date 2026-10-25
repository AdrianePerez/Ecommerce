-- =====================================================================
-- 0014 · Status de produto "Fora de linha"
--  Item que continua cadastrado (histórico de custos, notas, fotos), mas
--  não é mais comercializado. Diferente de "Arquivado": não some do
--  sistema e continua sendo reconhecido em notas novas.
--  (O valor novo do enum fica numa migração própria: o Postgres não deixa
--   usar um valor de enum na mesma transação em que ele foi criado.)
-- =====================================================================
alter type public.product_status add value if not exists 'fora_de_linha' after 'publicado';
