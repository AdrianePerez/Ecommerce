# Dualshop Intelligence

Plataforma interna da Dualshop para gestão de produtos, custos de aquisição, preparação de anúncios e acompanhamento financeiro simplificado.

**Stack:** React 19 + TypeScript + Vite · Tailwind CSS 4 · TanStack Query · React Router · Zod + react-hook-form · Supabase (Postgres, Auth, Storage, Edge Functions).

## Situação por fase

| Fase | Conteúdo | Situação |
|---|---|---|
| 0 | Diagnóstico e planejamento | concluída |
| 1 | Fundação, autenticação, RLS, cadastro mestre de produtos | **em validação** |
| 2 | Importação de XML de NF-e e custo médio | — |
| 3 | Catálogos PDF | — |
| 4 | Pesquisa com IA, imagens, ficha comercial | — |
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

Chaves de IA e de busca entram nas fases 3 e 4 como segredos das Edge Functions.

## Banco de dados

As migrações ficam em `supabase/migrations/` e são aplicadas em ordem:

1. `20261009120000_base.sql` — perfis, papéis (`admin`, `operador`), `is_staff()`/`is_admin()`, auditoria, buckets privados.
2. `20261009120100_products.sql` — fornecedores, produtos, identificadores, atributos rastreáveis, view `product_overview`.

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

## Validação manual da fase 1

1. Entrar com o usuário convidado; sair; usar "Esqueci minha senha".
2. Configurações → Fornecedores: cadastrar um fornecedor com CNPJ válido; tentar repetir o CNPJ (deve recusar).
3. Produtos → Novo produto: cadastrar com nome, marca, EAN, medidas em cm (vírgula) e peso em g.
4. Abrir o produto: conferir o painel "O que falta", a aba Identificadores (EAN espelhado) e o Histórico.
5. Cadastrar outro produto com o mesmo EAN (deve recusar com mensagem clara).
6. Tentar marcar como "Pronto para publicar" com campos faltando (deve recusar e listar o que falta).
7. Buscar por parte do nome, pelo EAN e pelo código do fornecedor; usar os filtros de pendência.
8. Com um segundo usuário operador: confirmar que ele não altera papéis em Configurações → Usuários.
