# Dualshop Intelligence

Plataforma interna da Dualshop para gestão de produtos, custos de aquisição, preparação de anúncios e acompanhamento financeiro simplificado.

**Stack:** React 19 + TypeScript + Vite · Tailwind CSS 4 · TanStack Query · React Router · Zod + react-hook-form · Supabase (Postgres, Auth, Storage, Edge Functions).

## Situação por fase

| Fase | Conteúdo | Situação |
|---|---|---|
| 0 | Diagnóstico e planejamento | concluída |
| 1 | Fundação, autenticação, RLS, cadastro mestre de produtos | concluída |
| 2 | Importação de XML de NF-e e custo médio, edição em massa | concluída |
| 3 | Catálogos PDF: envio, revisão manual por página, aprovação | concluída (leitura com IA depende da chave da API) |
| 4 | Galeria de imagens, fontes, ficha comercial, preparação de anúncios | **em validação** — parte sem IA; pesquisa e textos com IA depois da chave |
| 5 | Precificação e vitrine | — |
| 6 | Financeiro | — |

Os módulos das próximas fases aparecem no menu desabilitados, com a fase indicada.

## Como rodar

Pré-requisitos: Node.js 20 ou superior e um projeto Supabase com as migrações aplicadas.

```bash
npm install
cp .env.example .env.local     # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev                    # http://localhost:5173
```

Outros comandos:

```bash
npm test            # testes unitários (Vitest)
npm run typecheck   # verificação de tipos
npm run build       # build de produção em dist/
npm run test:db     # migrações + testes de segurança num Postgres local (precisa de psql; ver abaixo)
```

### Variáveis de ambiente

| Variável | Onde | Observação |
|---|---|---|
| `VITE_SUPABASE_URL` | frontend | URL do projeto (pública) |
| `VITE_SUPABASE_ANON_KEY` | frontend | chave pública; a proteção dos dados vem da RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **somente** Edge Functions | nunca no frontend nem no repositório |

Chaves de IA e de busca entram como segredos das Edge Functions (Supabase → Edge Functions → Secrets), nunca no `.env` do frontend.

## Banco de dados

As migrações ficam em `supabase/migrations/` e são aplicadas em ordem:

1. `20261009120000_base.sql` — perfis, papéis (`admin`, `operador`), `is_staff()`/`is_admin()`, auditoria, buckets privados.
2. `20261009120100_products.sql` — fornecedores, produtos, identificadores, atributos rastreáveis, view `product_overview`.
3. `20261009150000_hardening.sql` — ajustes do Security Advisor.
4. `20261013120000_invoices_costs.sql` — notas, itens, regra de custo versionada, histórico de custos (com estorno), `product_cost_summary`, funções `import_invoice`, `relink_invoice_item`, `match_invoice_items`, `suggest_products`, `activate_cost_rule`.
5. `20261013150000_product_defaults.sql` — marca = nome fantasia do fornecedor e SKU interno = código do fornecedor quando vazios.
6. `20261013160000_bulk_update.sql` — `bulk_update_products` (edição em massa com lista de campos permitidos).
7. `20261013170000_catalogs.sql` — `supplier_catalogs`, `catalog_pages`, `catalog_items`, view `catalog_overview`, `match_catalog_code`, `approve_catalog_item`, políticas do bucket `catalogs`.
8. `20261014120000_images_listings.sql` — `product_images` (galeria com versões), `product_research_sources`, `marketplace_configs` (Mercado Livre, TikTok Shop; Shopee e Amazon inativos), `product_listings`, `listing_assets`, `listing_issues`, `set_main_image`, `reorder_product_images`.

### Edge Functions

- `supabase/functions/importar-imagem` — baixa uma imagem de um link público para a galeria (só equipe; bloqueia endereços internos; até 15 MB; JPG/PNG/WebP). Publicada com verificação de JWT.

Detalhes do modelo e decisões em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

### Configuração do Supabase Auth (painel)

- **Authentication → Sign In / Providers → Email:** desativar *Allow new users to sign up* (usuários entram só por convite).
- **Authentication → URL Configuration:** *Site URL* = endereço publicado do app; incluir `http://localhost:5173/**` e o endereço publicado em *Redirect URLs* (necessário para o link de redefinição de senha).
- Convidar usuários em **Authentication → Users → Invite user**. O primeiro usuário criado vira administrador.

### Testes de segurança do banco

`supabase/tests/products_rls.test.sql` verifica, dentro de uma transação desfeita no final:

- anônimo bloqueado em todas as tabelas e na view;
- usuário inativo não lê nem grava;
- operador não altera o próprio papel; admin gerencia usuários;
- EAN, código de fornecedor e SKU interno duplicados são recusados;
- dado fiscal não aceita IA como origem nem fica sem origem;
- produto não pode ser excluído fisicamente;
- auditoria registra as alterações.

Para rodar localmente sem Supabase: um Postgres 15+ com `pg_trgm`, e
`PGHOST=... PGPORT=... npm run test:db` (o script cria o banco `dualshop_test` e simula `auth`/`storage`).

## Validação manual da fase 4 (sem IA)

1. Produto → aba **Imagens**: enviar 2–3 fotos (escolher tipo e direito de uso). Aprovar, definir a principal (★), mudar a ordem (← →).
2. **Adicionar por link**: colar o endereço de uma foto (botão direito → “Copiar endereço da imagem”).
3. **Nova versão** (ícone de camadas): enviar a versão editada no Canva; a original continua lá.
4. **Baixar aprovadas**: sai um .zip com nomes `SKU_01_foto-oficial.jpg`.
5. Aprovar um item num catálogo: o recorte aparece na aba Imagens do produto como “Referência”, a revisar. Para itens aprovados antes, usar “Trazer recortes do catálogo”.
6. Aba **Fontes**: registrar a página do fabricante. Na aba **Atributos**, adicionar um valor escolhendo essa fonte.
7. Aba **Ficha comercial**: conferir os dados confirmados e “Copiar ficha”.
8. Aba **Anúncios** (ou Central de preparação → Novo anúncio): criar o rascunho do Mercado Livre. Título, descrição, atributos e imagens já vêm montados. Conferir o contador de 60 caracteres.
9. Tentar “Marcar como pronto para publicar” sem preço/categoria: o sistema lista o que falta. Completar e marcar. Depois de publicar no Mercado Livre, “Já publiquei no canal” com o código MLB.
10. Galeria de imagens (menu): filtrar “A revisar”, selecionar várias e aprovar em massa.
11. Configurações → **Marketplaces**: conferir os limites de cada canal e a data da conferência.

## Validação manual da fase 3

O PDF original **não** é guardado: o navegador converte cada página em imagem JPEG (páginas duplas são divididas ao meio) e só as imagens vão para o bucket privado `catalogs`. Um catálogo de 128 páginas / 173 MB vira ~256 imagens, ~49 MB.

1. Catálogos → Enviar catálogo: escolher fornecedor, nome da coleção, ano e o PDF. Acompanhar a barra de progresso.
2. Interromper no meio e enviar o mesmo PDF de novo: o envio continua de onde parou.
3. Enviar um PDF já concluído: aparece o aviso de catálogo já enviado.
4. Abrir o catálogo: miniaturas das páginas; busca por código.
5. Abrir uma página: arrastar sobre a foto do produto para marcar; o código é sugerido a partir do texto da página quando houver. Ajustar o recorte pelos cantos. ←/→ trocam de página.
6. Preencher medidas, material, preço sugerido etc. e Salvar. Aprovar: escolher o produto (sugestões pelo código, ex. IS43531SR → IS43531SR0200UN) e marcar quais divergências substituir.
7. No produto aprovado: campos vazios preenchidos e atributos com fonte "Catálogo \"nome\", página N".
8. Excluir catálogo: imagens, recortes e marcações somem; dados aprovados continuam nos produtos.

## Validação manual da fase 2

1. Entrada de mercadorias → Importar XML: selecionar 1 ou mais XMLs de NF-e (não o PDF).
2. Conferir cabeçalho, avisos e itens. Itens com EAN ou código já cadastrados aparecem vinculados; os demais viram novo cadastro ou pedem confirmação quando há descrição parecida.
3. Para notas em caixa/dúzia, conferir o **fator** (unidades por embalagem) e o custo unitário.
4. Gravar. Importar o mesmo XML de novo: deve aparecer "já foi importada" e o botão ficar bloqueado.
5. Abrir um produto → aba "Custos e compras" e quadro "Custo de aquisição": custo médio, última compra e histórico.
6. Importar uma segunda nota do mesmo produto com outro preço e conferir o custo médio ponderado.
7. Na nota, "Corrigir vínculo" de um item: o custo sai do produto antigo (estorno) e entra no novo.
8. Configurações → Regra de custo: ver a regra ativa (produtos + IPI). Uma nova versão só vale para as próximas importações.

## Validação manual da fase 1

1. Entrar com o usuário convidado; sair; usar "Esqueci minha senha".
2. Configurações → Fornecedores: cadastrar um fornecedor com CNPJ válido; tentar repetir o CNPJ (deve recusar).
3. Produtos → Novo produto: cadastrar com nome, marca, EAN, medidas em cm (vírgula) e peso em g.
4. Abrir o produto: conferir o painel "O que falta", a aba Identificadores (EAN espelhado) e o Histórico.
5. Cadastrar outro produto com o mesmo EAN (deve recusar com mensagem clara).
6. Tentar marcar como "Pronto para publicar" com campos faltando (deve recusar e listar o que falta).
7. Buscar por parte do nome, pelo EAN e pelo código do fornecedor; usar os filtros de pendência.
8. Com um segundo usuário operador: confirmar que ele não altera papéis em Configurações → Usuários.
