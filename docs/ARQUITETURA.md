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

## Fase 2 — Entrada de mercadorias e custos

### ADR-10 · Importação somente por função transacional
`import_invoice(payload)` grava nota, itens, produtos novos, identificadores e lançamentos de custo em uma única transação (`SECURITY DEFINER`, verifica `is_staff()`). Usuários não têm INSERT/UPDATE/DELETE em `invoices`, `invoice_items` e `product_cost_history`. A chave de acesso é única: a mesma nota nunca entra duas vezes. Qualquer erro desfaz tudo.

### ADR-11 · Leitura do XML no navegador
O XML é lido no navegador (`src/lib/domain/nfe.ts`) para a conferência imediata e enviado ao banco já estruturado; o arquivo original vai para o bucket privado `nfe-xml/<chave>.xml` com o SHA-256 registrado na nota. Risco aceito: um usuário interno mal-intencionado poderia enviar valores diferentes do XML; o original fica guardado para conferência.

### ADR-12 · Custo gerencial versionado
`cost_rules` define o que entra no custo (padrão v1: produtos + IPI). Cada lançamento guarda a regra e **todos** os componentes (produtos, IPI, frete, seguro, outras, ST, desconto), permitindo recalcular no futuro. Trocar a regra vale para as próximas importações. O cálculo oficial é `compute_item_cost()` no banco; `src/lib/domain/cost.ts` é só a prévia da tela, testada com os mesmos casos.

Custo médio ponderado = Σ custo das entradas vigentes ÷ Σ quantidades (regra simplificada da especificação; não considera saídas de estoque).

### ADR-13 · Unidade da nota × unidade do produto
`invoice_items.conversion_factor` (unidades do produto por unidade comercial) e `base_qty` gerado. Sugestão automática: DZ = 12; ou `qTrib ÷ qCom` quando a unidade tributável é UN. Embalagens (CX, PCT, KIT…) sem pista exigem confirmação do fator antes de gravar.

### ADR-14 · Vínculo de itens
Ordem: EAN → código do fornecedor (pelo CNPJ do emitente) → semelhança de descrição (`pg_trgm`). Semelhança **nunca** vincula sozinha: só sugere. EAN e código apontando produtos diferentes = conflito, exige decisão. Correção posterior (`relink_invoice_item`) gera estorno no produto antigo e nova entrada no novo; identificadores criados por aquele item são movidos (`product_identifiers.source_invoice_item_id`).

### ADR-15 · Dados fiscais vindos da nota
Ao vincular a um produto existente, NCM/CEST/origem só são preenchidos se estiverem vazios e a origem não for manual. Nunca sobrescreve. Produto criado pela nota recebe `fiscal_source = 'nfe'`.

### Limitações conhecidas
- Notas de devolução, complementares e de ajuste são recusadas.
- Itens com o mesmo EAN marcados como "novo cadastro" na mesma nota são bloqueados (crie em um e vincule os demais).
- Não há geração de contas a pagar a partir da nota (prevista para a fase 6, com confirmação).

### ADR-16 · Edição em massa
`bulk_update_products` (security invoker, sujeita à RLS) aceita só uma lista fechada de colunas, até 2.000 produtos por vez, com opção "só preencher vazios". Alterar NCM/CEST/origem marca a origem fiscal como manual.

### ADR-17 · Catálogo: guardar só as imagens das páginas
O PDF do fornecedor (ex.: 173 MB) passa do limite de 50 MB por arquivo do plano gratuito e quase todo o conteúdo é imagem. O navegador renderiza cada página com pdf.js (altura 1500 px, JPEG 0,82), divide páginas duplas e envia só as imagens + miniaturas. A impressão digital SHA-256 do PDF impede envio duplicado e permite retomar um envio interrompido. Excluir o catálogo remove imagens, recortes e marcações; o que já foi aprovado fica no produto.

### ADR-18 · Aprovação de item de catálogo
Itens marcados ficam "aguardando revisão". A aprovação acontece só pela função `approve_catalog_item` (security definer + `is_staff()`): preenche apenas campos vazios, a menos que a divergência seja escolhida, e grava atributos com `source = 'catalogo'` e referência "Catálogo X, página N". Item aprovado não pode ser alterado nem excluído. A ligação com a nota usa o código do catálogo como prefixo do código da nota (≥ 5 caracteres) ou o EAN.

### ADR-19 · Leitura automática com IA (pendente)
Como as páginas são imagens achatadas (sem texto além dos preços), a extração automática exige um modelo com visão, rodando numa Edge Function com a chave da Anthropic como segredo. Resultado sempre entra como "aguardando revisão".
