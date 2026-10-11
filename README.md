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

**Atenção:** `test:auth` usa um global setup que reseta o Supabase local.
Não execute esse comando contra um banco persistido usado para trabalho ou revisão.
Os testes unitários não iniciam servidor, não carregam `.env` e não acessam banco:

```bash
npx playwright test --config playwright.unit.config.ts
```

### Convites e recuperação de senha

Os templates de `supabase/templates/invite.html` e `recovery.html` fornecem
links diretos para `/auth/confirm` com `token_hash`. O template de recuperação
preserva o destino fornecido pela aplicação. Configure ambos no Supabase remoto
somente em uma etapa autorizada; migrations e deploy não publicam esses templates.
O SMTP padrão não é adequado para uso real e o painel pode exigir SMTP próprio
para editar os templates. A alteração de código sozinha não conclui esse setup.

Links legados via PKCE não são convertidos silenciosamente em sessão.
Sessões conflitantes exigem outra janela ou logout explícito antes da confirmação.
A autorização para definir senha tem validade de 15 minutos e é vinculada à
identidade e à sessão confirmadas, com assinatura server-side usando
`SUPABASE_ADMIN_KEY` e finalidade separada. Não há nova variável de produção;
rotacionar essa chave invalida contextos temporários existentes.

A suíte `playwright.auth-isolated.config.ts` não usa o global setup nem reseta
bancos. Ela exige uma **cópia descartável** com `project_id` começando por
`imobflux-auth-disposable`, API em loopback:56321, caixa de e-mail local:56324,
Site URL/Redirect URLs em `http://localhost:3100` e todas as migrations aplicadas
em um banco novo. Forneça somente no processo dessa cópia as chaves locais e
`IMOBFLUX_AUTH_TEST_DISPOSABLE=1`; não copie `.env` do projeto principal.
O servidor em 3100 é iniciado pela suíte sem reutilizar outro servidor.

```bash
# Somente na cópia descartável preparada conforme os requisitos acima:
npx playwright test --config playwright.auth-isolated.config.ts
```

A suíte envia e-mails exclusivamente à caixa local e recusa um banco com
workspace existente. No ambiente descartável, configure o intervalo mínimo de
envio para os cenários de reenvio; os erros 429 são cobertos em testes unitários.

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

## Arquitetura da documentação

A documentação do repositório é organizada como uma **Single Source of Truth (SOT)** para garantir clareza e evitar duplicações de contexto:

- **[docs/STATUS_PROJETO.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/STATUS_PROJETO.md)**: Estado atual único da aplicação (funcionalidades, banco, testes, dívidas).
- **[docs/ROADMAP.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/ROADMAP.md)**: Planejamento futuro das próximas sprints e fases do sistema.
- **[docs/ARQUITETURA.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/ARQUITETURA.md)**: Diretrizes técnicas, convenções de código, padrões de componentes e banco.
- **[docs/DOCUMENTATION_POLICY.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/DOCUMENTATION_POLICY.md)**: Política permanente de manutenção da documentação.
- **[HANDOFF.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/HANDOFF.md)**: Guia de transição e onboarding operacional rápido para desenvolvedores.
- **[docs/DECISOES.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/DECISOES.md)**: Registro histórico de decisões arquiteturais técnicas (ADRs).
- **[docs/sprints/](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/sprints/)**: Histórico imutável de cada sprint concluída (ex: `SPRINT_15.md`, `SPRINT_16.md`).
- **[docs/AUDITORIA_TECNICA.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/AUDITORIA_TECNICA.md)**: Relatórios formais de auditoria técnica pré e pós-sprint.
- **[docs/SCHEMA_POSTGRESQL.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/SCHEMA_POSTGRESQL.md)**: Documentação física do schema do banco PostgreSQL.
- **[docs/MODELO_LOGICO_BANCO.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/MODELO_LOGICO_BANCO.md)**: Especificação lógica e relacionamentos das tabelas.
- **[docs/MODELO_DOMINIO.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/MODELO_DOMINIO.md)**: Conceitos, regras de negócio e limites do CRM imobiliário.
- **[docs/FLUXOS_NEGOCIO.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/FLUXOS_NEGOCIO.md)**: Mapeamento dos processos e jornada comercial do corretor.
- **[docs/MATRIZ_PERMISSOES.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/MATRIZ_PERMISSOES.md)**: Matriz de permissões, perfis (roles) e RLS.

