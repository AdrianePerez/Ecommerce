# Arquitetura e decisões

## Visão geral

- **Frontend** (SPA React) fala direto com o Supabase usando a chave pública. Toda a proteção dos dados está nas políticas RLS do Postgres.
- **Regras críticas no banco**: unicidade de identificadores, origem fiscal, proibição de exclusão física, auditoria e (fase 2) importação transacional de notas ficam em constraints, gatilhos e funções SQL — não dependem do navegador.
- **Regras de cálculo** (conversões, validações, custo, preço) ficam em `src/lib/domain/`, puras e testadas. Quando precisarem rodar no servidor (Edge Functions), o mesmo módulo é reutilizado.
- **Operações demoradas** (fase 3+): tabela `processing_jobs` + fila (pgmq/pg_cron) + Edge Function processando lotes pequenos.

## Estrutura de pastas

```
src/
  app/            rotas, layout, autenticação
  components/ui/  componentes reutilizáveis (botões, campos, tabela, modal, estados)
  lib/
    domain/       regras puras e testadas (números pt-BR, validadores, produto)
    supabase.ts   cliente + tradução de erros do banco
    format.ts     moeda, datas e medidas no padrão brasileiro
  modules/<módulo>/  páginas, componentes e api.ts de cada módulo
supabase/
  migrations/     SQL versionado
  tests/          testes SQL de segurança e integridade
docs/
```

## Decisões

### ADR-01 · Papéis simples, sem multiempresa
Uma operação interna. `profiles.role` (`admin`, `operador`) e `profiles.active`. As políticas usam `is_staff()` (autenticado e ativo). Multiempresa pode ser adicionada depois com uma coluna `org_id` e políticas por organização.

### ADR-02 · Unidades explícitas
Medidas em milímetros (`*_mm`) e pesos em gramas (`*_g`), em `numeric`. A interface recebe cm e g com vírgula decimal e converte com `decimal.js` (sem ponto flutuante). Produto e embalagem de transporte têm colunas separadas.

### ADR-03 · Identificadores
`products.ean` e `products.supplier_sku` guardam os códigos principais (para exibição e busca rápida). **Todos** os códigos ficam em `product_identifiers`, com origem e motivo do vínculo; um gatilho espelha os principais. Unicidade:
- EAN: um produto por EAN;
- código de fornecedor: único por fornecedor (sem diferenciar maiúsculas).
A correção de vínculos remove a linha de `product_identifiers` (auditada); o histórico de notas (fase 2) referencia o item da nota, não o identificador, então não se perde.

### ADR-04 · Dados fiscais com origem
`fiscal_source` registra de onde vieram NCM/CEST/origem (`nfe`, `manual`, `catalogo`, `pesquisa`). Constraint impede `ia` e impede dado fiscal sem origem. Editar manualmente um dado vindo da nota muda a origem para `manual`.

### ADR-05 · Atributos extensíveis e rastreáveis
`product_attributes` guarda atributos que variam por categoria, com fonte, referência, confiança e estado de validação. Vários candidatos podem coexistir; no máximo um `confirmada` por atributo. Valores confirmados nunca são substituídos silenciosamente.

### ADR-06 · Sem exclusão física
Produtos e fornecedores são arquivados (`archived_at`); o privilégio de DELETE é revogado. `audit_logs` registra INSERT/UPDATE/DELETE das tabelas críticas com o usuário.

### ADR-07 · "Pronto para publicar" exige cadastro completo
Constraint `products_ready_requires_complete` impede os status `pronto`/`publicado` sem nome comercial, marca, EAN ou código, NCM, dimensões e peso. Na fase 5 os requisitos por canal (fotos, título, preço) passam a ser verificados por anúncio.

### ADR-09 · Avisos aceitos do Security Advisor
`is_staff()` e `is_admin()` são `SECURITY DEFINER` e executáveis por usuários autenticados (aviso 0029 do Supabase). É intencional: as políticas RLS dependem delas e elas só respondem sobre o próprio usuário logado (verdadeiro/falso), sem expor dados. O anônimo não pode executá-las, e as funções de gatilho não são chamáveis pela API (migração 0003).

### ADR-08 · Concorrência otimista
A atualização de produto compara `updated_at`; se outra pessoa salvou antes, a gravação é recusada com aviso para recarregar.

## Modelo de dados — fase 1

| Tabela | Finalidade | Chaves e restrições principais |
|---|---|---|
| `profiles` | usuários internos | PK = `auth.users.id`; papel e situação só alterados por admin |
| `audit_logs` | auditoria imutável | só gravada por gatilho |
| `suppliers` | fornecedores | CNPJ (14 dígitos) único quando informado |
| `products` | cadastro mestre | SKU interno único (case-insensitive); checks de EAN, NCM, CEST, origem 0–8, origem fiscal, completude para "pronto" |
| `product_identifiers` | todos os códigos | EAN único; (fornecedor, código) único |
| `product_attributes` | atributos extras com fonte | um confirmado por (produto, atributo) |
| `product_overview` (view) | listagem com pendências | `security_invoker` (respeita RLS) |

Buckets privados criados: `nfe-xml`, `catalogs`, `product-images`. XML e catálogos originais não podem ser sobrescritos nem apagados pelo app.

## Próximas migrações (planejadas)

| Migração | Conteúdo |
|---|---|
| 0003 | `invoices`, `invoice_items`, `cost_rules`, `product_cost_history` (com fator de conversão de unidade e estornos), view de custo médio, função `import_invoice()` transacional e idempotente pela chave de acesso |
| 0004 | `supplier_catalogs`, `catalog_pages`, `catalog_products`, `processing_jobs` |
| 0005 | `product_research`, `product_research_sources`, `product_images`, `product_listings`, `listing_assets` |
| 0006 | `marketplace_configs`, `pricing_rules` (versionadas), `pricing_simulations` |
| 0007 | `financial_accounts`, `financial_categories`, `financial_recurrences`, `financial_titles`, `financial_title_events` |
