# Relatório — Segurança 1: atualização do Next.js e dependências (item B6)

> Branch `fix/seguranca-next`, a partir da `main` `5c40366`. **Sem migration**, sem mudança de banco, sem mudança em `app/`, `components/`, `lib/` ou `public/`. Nada foi enviado (sem push, merge ou deploy). Não toquei em Vercel (nem variáveis), Evolution, banco de produção, VPS, webhook ou WhatsApp. Nenhuma chave foi exibida.
> Mudanças: `package.json` (2 linhas), `package-lock.json` e a documentação.

## 1. Avisos confirmados em fonte oficial

Fontes: **registro do npm** (versões, datas, `engines`), **GitHub Advisory Database** (`gh api advisories/…`), **advisories do repositório `vercel/next.js`** e **notas de versão oficiais** (v16.4.1 a v16.4.5). Conferi um por um; a `docs/AUDITORIA_PRE_LANCAMENTO.md` estava certa nos avisos, mas **imprecisa na versão**: a menor versão que corrige todos os críticos e altos é a **16.4.1** (não a 16.4.4), e há uma versão mais nova, a **16.4.5**, com o pacote de segurança de novembro.

| Aviso (GHSA) | Gravidade | Corrigido em | Aplica ao ImobFlux? |
|---|---|---|---|
| `p293-qw3h-jr36` RCE em servidor **Windows** | Crítica | 16.3.3 | **Não**: hospedagem na Vercel (Linux) |
| `2xp9-vwfh-vxw4` RCE na otimização de imagem (**AVIF**) | Crítica | 16.3.3 | **Baixo**: a rota `/_next/image` existe e o app usa `next/image` só no avatar, sem `images` configurado (nenhum domínio remoto); na Vercel a otimização roda na infraestrutura deles. Corrigido por precaução |
| `2464-fhr4-w9xw` RCE na otimização de imagem (**SVG**) | Crítica | 16.4.1 | Idem |
| `vcvr-r3jv-pc5j` RCE em `next/og` `ImageResponse` | Crítica | 16.3.6 | **Não**: o app não usa |
| `673q-mjm6-r5xr` RCE em funções `use cache` com arrays tipados | Crítica | 16.4.1 | **Não**: nenhum `use cache`, `unstable_cache` nem Cache Components |
| `p3m5-59mp-jv5r` **DoS com Server Actions** (CPU) | Alta | 16.4.1 | **SIM**: App Router com 17 arquivos `"use server"`. É o principal motivo da atualização (a nota oficial diz que quem não usa Server Actions não é afetado) |
| `cjq9-62q9-8jv4` SSRF na otimização de imagem | Alta | 16.3.8 | **Baixo**: sem `remotePatterns`, a rota só serve imagens locais |
| `4jqv-mc3x-m676`, `mcj8-r9mp-w47p` envenenamento de cache SSG/ISR | Média | 16.3.8 | **Não**: sem ISR; páginas autenticadas e dinâmicas; Vercel |
| `f87g-xv8r-7p7x` vazamento em rotas de imagem de metadados | Média | 16.3.8 | **Não**: ícones estáticos e `manifest.ts`, sem rota de imagem dinâmica |
| `39w2-rjm5-chcv` vazamento no endpoint MCP do servidor de **desenvolvimento** | Baixa | 16.3.8 | **Não** em produção |
| **16.4.5 (nov/2026):** 4 avisos de `use cache`/Cache Components (`mfr8…`, `vc7v…`, `vvgp…`, `rhh4…`) | Média | 16.4.5 | **Não**: o app não usa |
| `pc58-hwjq-p385` injeção de resposta ao devolver `fetch` cru, **self-hosted** atrás de proxy HTTP/1.1 | Média | 16.4.5 | **Não** (Vercel, não self-hosted). Nota: `/api/attachments` e o avatar repassam o corpo de um `fetch`, mas montam cabeçalhos próprios |
| `7qx7-33qx-rqx2` SVG rejeição burlada na otimização, **self-hosted** | Média | 16.4.5 | **Não** (Vercel) |
| `f3mh-rxg3-f5g2` cookie HttpOnly exposto em rotas **Edge** | Média | 16.4.5 | **Não**: nenhuma rota usa `runtime = "edge"`; o `proxy.ts` roda em Node |

**Versão escolhida: 16.4.5, fixada exata** (e `eslint-config-next` 16.4.5 igual). Motivos: (1) é a `latest` da série 16 (publicada em 2026-11-03) e **inclui o pacote de segurança de novembro** anunciado nas notas da 16.4.4; (2) o próprio `npm audit` passou a indicar `next@16.4.5` como correção; (3) o delta de 16.4.1 até 16.4.5 são backports de correção e os 7 avisos médios de novembro, sem recursos novos nem quebra de compatibilidade (notas de 16.3.0, 16.4.0 a 16.4.5 lidas: só correções, remoções internas de código legado e reforços de segurança). **Ressalva honesta:** a 16.4.5 tem poucas horas de vida; o plano de reversão abaixo existe por isso, e a alternativa mais conservadora seria a 16.4.4.

**Mudanças de comportamento / deprecações:** nenhuma que afete o app. Não houve alteração de configuração (`next.config.ts` intocado), de APIs (`proxy.ts`, Server Actions, route handlers), nem aviso de deprecação no build. Requisito de Node da 16.4.5: `>=20.9.0` (CI usa Node 22; testes locais em 22 e 24 passaram). A versão de Node configurada na Vercel não foi lida (não toquei na Vercel); o padrão da plataforma é ≥ 20, compatível — **conferir no painel é uma ação do Mário se quiser certeza**.

## 2. `npm audit` antes e depois

| | Crítica | Alta | Moderada | Total |
|---|---|---|---|---|
| **Antes** (`5c40366`) | 1 (`next`) | 7 (`next`-cadeia: postcss, sharp; e brace-expansion, js-yaml, nanoid, source-map-js, zod) | 15 | 23 |
| Depois só do Next 16.4.5 | **0** | 5 | 16 | 21 |
| **Depois** (Next + `npm audit fix` seguro) | **0** | **0** | 16 | **16** |

- `postcss` e `sharp` foram resolvidos pelo próprio Next 16.4.5 (traz `postcss` 8.5.23 e `sharp` 0.35.5).
- Os 5 altos indiretos (`brace-expansion`, `js-yaml`, `nanoid`, `source-map-js`, `zod`) foram resolvidos com `npm audit fix` **sem `--force`**: só o lockfile mudou, dentro das faixas de versão já permitidas (nenhuma versão maior, nenhum `override`). Isso atualizou também `typescript-eslint` 8.65.0 → 8.72.1 (14 pacotes, **somente desenvolvimento**), caminho que o npm escolheu para chegar ao `brace-expansion` corrigido.
- **Restam 16 moderados, todos na cadeia do ESLint** (`minimatch` < 11.0.1, ReDoS; `eslint`, `eslint-config-next`, `typescript-eslint`, plugins), **só desenvolvimento/lint, não vão para produção**. A "correção" oferecida (`eslint@4.0.0`, `eslint-config-next@0.2.4`) é um **retrocesso de versão**, não é conserto: **não aplicada**. Sai quando o ecossistema do ESLint publicar uma versão que use `minimatch` novo.
- O arquivo de lockfile foi mantido (não removido) e o `package-lock.json` anterior ficou guardado para a reversão.

## 3. Lista exata de mudanças
- **`package.json`:** `next` `16.2.12` → `16.4.5`; `eslint-config-next` `16.2.12` → `16.4.5` (exatos, sem `^`).
- **`package-lock.json`** (65 entradas): `next` e `@next/*` (env, eslint-plugin-next, binários SWC por plataforma) → 16.4.5; `sharp` 0.34.5 → 0.35.5 e `@img/sharp-*` (libvips 1.2.4 → 1.3.4; entram 2 binários wasm novos); `postcss` embutido do Next 8.4.31 → 8.5.23; `@swc/helpers` 0.5.15 → 0.5.23; `brace-expansion` 1.1.18 → 1.1.21; `js-yaml` 4.3.0 → 4.3.2; `nanoid` 3.3.16 → 3.3.20; `source-map-js` 1.2.1 → 1.2.2; `zod` 4.4.3 → 4.6.7; `@eslint/eslintrc` 3.3.6 → 3.3.7; `fastq` 1.20.1 → 1.20.3; `semver` 7.8.5 → 7.8.6 (aninhado); `typescript-eslint` e 13 pacotes `@typescript-eslint/*` 8.65.0 → 8.72.1.
- **Código (`app/`, `components/`, `lib/`):** **nenhuma mudança.** A atualização não exigiu.

## 4. Verificações
| Verificação | Resultado |
|---|---|
| Lint | sem erros nem avisos |
| Tipos (`tsc --noEmit`) | sem erros |
| Unitários | **720 passando** em Node 22 e em Node 24 |
| Build de produção (variáveis fake de CI) | ok; **sem avisos novos**; lista de rotas **idêntica** à do build anterior (`/api/push/*`, `/preferencias`, `/hoje` etc.); só mudam as linhas de cabeçalho (versão 16.4.5 e "Running next.config.ts") |
| Regressão completa de navegador, **uma suíte por vez**, cópia descartável com `npm ci` do lockfile novo | **42 arquivos, 323 passando, 0 falhas, 1 ignorado** (o mesmo `skip` pré-existente de `sprint24-blocob-polish`); **idêntico** ao resultado antes da atualização |
| pgTAP | **não rodado**: nenhuma mudança de banco |
| Suíte isolada `email-auth-flow` (Supabase próprio, porta 56321) | **não rodada**: a memória livre do computador caiu para 1,67 GB (abaixo dos 2 GB combinados) e não encerrei nada por conta própria. Login e convite foram cobertos na regressão principal (`auth-flow`, `team-management`, `ajustes-5`, etc.). Recomendo rodá-la antes da Trava B se houver memória |

Cobertura dos pontos pedidos, dentro das 42 suítes: hidratação rápida (conversations, mensagens-pacote, tema-novas-telas, atalhos/Alt+seta), Server Actions (contatos, tarefas, kanban, equipe, preferências), login e convite (`auth-flow`, `team-management`), service worker e Web Push (`web-push`, `web-push-teste`, `web-push-desligado`, `web-push-tema`), manifest (`ajustes-6`), rotas `/api/push/*` (`web-push*`), webhook (`prazos`, `send-files`, `sprint23`, `web-push`), upload e download de anexos (`send-files`, `ajustes-6`), redirect `/prioridades` (`hoje-unificado`), proxy/autenticação (`auth-flow`), tema claro/escuro (`tema*`, `*-tema`) e Alt+seta (`atalhos`).

**Flakes versus regressões:** nenhuma falha ocorreu; portanto nenhum flake nem regressão a classificar.

## 5. Riscos que ficam
1. **A 16.4.5 é muito recente** (poucas horas); problemas ainda não notados pela comunidade são possíveis. Mitigação: regressão completa verde e reversão simples.
2. **`sharp` 0.34 → 0.35** (versão 0.x, "menor"): dependência opcional do Next, usada só na otimização de imagem. O app não depende de imagens remotas; os testes de avatar e anexos passaram.
3. **16 avisos moderados** de ferramentas de desenvolvimento (cadeia ESLint) continuam no `npm audit`; não chegam à produção.
4. **Versão de Node da Vercel** não verificada (exigência do Next: ≥ 20.9).
5. A suíte isolada de autenticação não foi executada (memória).
6. Os demais itens da auditoria (cabeçalhos de segurança, erros, limite de taxa) **continuam abertos** (itens B7 a B9).

## 6. Plano de reversão (não toca no banco)
1. Reverter o commit deste pacote na `main` (`git revert <commit>` → novo commit; sem force push); isso devolve `package.json` e `package-lock.json` à versão 16.2.12 (o lockfile anterior também fica no histórico do Git).
2. Push → CI → deploy automático da Vercel.
3. Alternativa intermediária se só a 16.4.5 incomodar: fixar `next` e `eslint-config-next` em **16.4.4** (ou 16.4.1, menor versão com todos os críticos/altos corrigidos) e rodar `npm install`.
4. Nenhuma migration envolvida; nenhum dado afetado.

## 7. Mini reteste para o Mário depois da publicação (celular e computador, ~10 min)
1. **Computador:** abrir `https://imobflux.vercel.app` e entrar (login); conferir o Hoje.
2. Abrir uma conversa, **enviar uma mensagem de texto** e ver o estado "enviada".
3. **Anexo:** enviar uma foto e abrir uma foto/PDF recebido (a imagem deve aparecer, o vídeo deve tocar).
4. Preferências → Avisos neste aparelho: **Enviar aviso de teste em 10 segundos**, fechar o app e bloquear a tela; o aviso deve chegar.
5. **Celular (iPhone, app instalado):** abrir pelo ícone (sem tela em branco), entrar, abrir a lista de conversas e uma conversa, enviar texto e uma foto.
6. Mandar uma mensagem de outro número e conferir o **aviso no celular** com o app fechado (sem o texto) e que o toque abre a conversa certa.
7. Sair e entrar de novo (sessão), e abrir um link antigo de `/prioridades` (deve ir para o Hoje).
Se algo falhar (tela em branco, erro ao entrar, anexo que não abre): reverter conforme a seção 6 e me avisar.
