# ImobFlux

Fundação do CRM para corretores imobiliários.

## Tecnologias

- Next.js com App Router
- React
- TypeScript
- Tailwind CSS
- ESLint
- Lucide React
- Supabase Auth e PostgreSQL local
- Playwright com o Chrome instalado no sistema

## Requisitos

- Node.js 22 ou superior
- npm

O requisito de Node 22 vem de `@supabase/supabase-js@2.110.8`, cuja propriedade
`engines.node` declara `>=22.0.0`. `@supabase/ssr@0.12.3` não declara requisito
próprio e Next.js 16.2.12 declara `>=20.9.0`.

## Instalação

```bash
npm install
```

Copie `.env.example` para um arquivo local não versionado e preencha:

- a URL local do Supabase;
- a chave pública de baixo privilégio com `PUBLISHABLE_KEY` ou `ANON_KEY`;
- a chave administrativa server-side com `SECRET_KEY` ou `SERVICE_ROLE_KEY`;
- um token de bootstrap de alta entropia, com no mínimo 32 caracteres.

Os nomes das variáveis da aplicação não dependem da geração de chaves legadas
ou novas pelo ambiente Supabase.

## Desenvolvimento

```bash
npm run dev
```

A aplicação ficará disponível em [http://localhost:3000](http://localhost:3000).

## Validação

```bash
npm run lint
npm run build
npm run test:auth
```

## Estrutura

```text
app/         Rotas, layouts e estilos globais
components/  Componentes estruturais, de autenticação e Design System
docs/        Documentação técnica
lib/         Autenticação, clientes Supabase e utilitários compartilhados
public/      Arquivos estáticos
supabase/    Migrations e testes pgTAP locais
tests/       Testes de autenticação e compensação
types/       Tipos TypeScript compartilhados
```

## Escopo atual

O projeto possui autenticação local, sessão em cookies, proteção das rotas
internas, bootstrap controlado do primeiro OWNER e Row Level Security nas 18
tabelas de domínio. A versão individual concede ao `authenticated` leitura do
workspace em que ele seja OWNER ativo.

O módulo Contatos libera exclusivamente cinco operações controladas para esse
OWNER: cadastrar, editar um contato com no máximo um telefone ativo,
inativar/reativar, arquivar e restaurar. Elas usam RPCs transacionais auditadas;
não há escrita direta nas tabelas, hard delete nem alteração de privacidade.
Outros módulos continuam somente leitura. Integração com WhatsApp e as demais
funcionalidades de negócio permanecem adiadas.
