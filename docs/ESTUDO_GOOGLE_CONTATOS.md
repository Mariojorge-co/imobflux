# Estudo: importar os contatos do Google no ImobFlux

> **Só estudo.** Nenhum código, tela, migration ou configuração foi criado por causa deste documento. Ele existe para o Mário decidir
> o caminho antes de qualquer implementação. Os fatos sobre a Google (limites, regras de verificação, cotas) são os que eu conheço
> hoje e **mudam com o tempo**: antes de implementar, conferir cada um na documentação oficial vigente (links ao final).
> Itens marcados com **[conferir]** são os mais sujeitos a mudança.

## 1. O problema, em uma frase

O Mário tem cerca de **2.148 contatos** na agenda do Google (a mesma agenda do celular). Hoje o ImobFlux só conhece quem já falou pelo
WhatsApp ou foi cadastrado à mão. Queremos **trazer os nomes (e telefones) da agenda** para que:

- a lista de conversas e a busca mostrem o **nome salvo na agenda** em vez de só o número ou o "nome de perfil" do WhatsApp;
- contatos que ainda não conversaram apareçam em **Contatos**, prontos para iniciar conversa;
- nada seja duplicado: quem já existe no ImobFlux (pelo telefone) só **recebe o nome**, não vira outro registro.

## 2. O que o ImobFlux já tem e que este estudo reaproveita

| Peça existente | Para que serve aqui |
|---|---|
| `lib/contacts/phone.ts` (`normalizeBrazilianPhone`) | Já normaliza telefone para **E.164** (`+55DDDNÚMERO`), aceitando 10 ou 11 dígitos sem prefixo e internacionais com `+`. É a base do casamento. |
| `contact_points.normalized_value` (único por workspace) | A chave de identidade de uma pessoa no sistema é o telefone normalizado. Contato do Google casa por aí. |
| Contatos `is_protected` (contato protegido) | Contato importado **nunca** pode contornar a proteção: se o número já é de um contato protegido, o atendente continua sem ver. |
| Auditoria (`audit_events`) | Registrar "importação concluída" (contagens, sem nomes). |
| Contatos já existem como entidade (`contacts`) com `display_name`, classificação e etapa. | Destino dos dados importados. |

## 3. Caminhos técnicos possíveis

### Caminho A — Importar um arquivo (CSV ou vCard) exportado do Google Contatos

O próprio Google Contatos (contacts.google.com) tem **Exportar** em dois formatos úteis:

- **Google CSV**: colunas como `First Name`, `Last Name`, `Phone 1 - Value`, `Phone 2 - Value`, `E-mail 1 - Value`, `Labels`...
- **vCard (.vcf)**: arquivo padrão com `FN`, `N`, `TEL;TYPE=CELL:...`, `EMAIL`, etc. Muitos telefones por contato.

Funcionamento no ImobFlux: tela **Contatos → Importar arquivo** (só o proprietário), com **prévia** antes de gravar.

- **Sem Google Cloud**, sem OAuth, sem verificação, sem cota. Funciona hoje, offline, e é exatamente o que um corretor com 2 mil
  contatos precisa.
- O arquivo contém dados pessoais: ele passa pelo servidor do ImobFlux. Boa prática: ler no navegador, mandar ao servidor só as linhas
  já normalizadas, **não guardar o arquivo**.
- Limite: é **manual** e pontual. Contatos novos na agenda depois da importação só entram quando o Mário exportar de novo (o casamento
  por telefone evita duplicar, então reimportar é seguro).

### Caminho B — Integração direta com a Google People API (OAuth)

O ImobFlux pede permissão ao Mário ("Entrar com o Google"/"Conectar agenda") e lê `people.connections.list`.

- **Escopo mínimo**: `https://www.googleapis.com/auth/contacts.readonly` (somente leitura dos contatos). Não pedir escrita.
- A Google classifica esse escopo como **sensível** **[conferir]**. Consequência: para uso fora de "modo de teste" o app precisa passar
  pela **verificação de OAuth da Google** (ver seção 5).
- `people.connections.list` com `personFields=names,phoneNumbers,emailAddresses,metadata` e **`pageSize` até 1000** **[conferir]**: 2.148
  contatos = **3 páginas**. Há `nextSyncToken`, que permite **sincronização incremental** (só o que mudou desde a última vez).
- Cotas da People API são folgadas para esse volume (centenas de leituras por minuto por usuário **[conferir]**); importar 2 mil contatos
  usa 3 requisições.
- **Refresh token**: guardá-lo exige criptografia em repouso (ver seção 8) e um fluxo de revogação.

### Caminho C — Híbrido (recomendado em fases)

1. **Fase 1 (rápida, sem dependência externa): Caminho A** — importar CSV/vCard com prévia, casamento por telefone e relatório.
2. **Fase 2 (só se valer a pena): Caminho B** — conexão com o Google para sincronizar de forma contínua, **depois** que a verificação
   da Google estiver resolvida.

A Fase 1 resolve 95% do valor com 20% do risco. O Caminho B só compensa se o Mário trocar de contatos todo dia na agenda do Google e
quiser que isso apareça sozinho no ImobFlux.

## 4. Casamento por telefone (o coração do assunto)

Regras para decidir "é a mesma pessoa que já existe?":

1. **Normalizar tudo para E.164** com a função que já existe. Remover espaços, parênteses, hífens, pontos.
2. **Sem prefixo internacional** → assumir **Brasil (+55)**, exigindo DDD + 8 ou 9 dígitos (10 ou 11 dígitos no total), como hoje.
3. **Nono dígito** (celulares brasileiros): contatos antigos aparecem como `DDD + 8 dígitos` (ex.: `82 8888-7777`) e os atuais como
   `DDD + 9 + 8 dígitos` (`82 98888-7777`). O WhatsApp pode devolver o número **com ou sem o 9** dependendo da conta. Regra proposta:
   para casar, gerar **as duas variantes** de todo celular brasileiro (com 9 e sem 9, quando o primeiro dígito do assinante é 6–9) e
   considerar "mesmo número" se **qualquer variante** bater. Ao **gravar**, preferir a forma com 9 (a atual).
   *Cuidado*: telefone fixo (primeiro dígito 2–5) **não** ganha o 9.
4. **Vários telefones por contato**: um contato do Google pode ter 3 números. Cada número vira (ou casa com) um `contact_point`; o
   contato do ImobFlux é um só. Se **números de contatos diferentes do Google colidem** com o mesmo contato do ImobFlux, é **conflito**
   (ver 6).
5. **Mesmo número em dois contatos do Google** (duplicata na agenda): importar uma vez só, com o nome do primeiro; listar no relatório.
6. **Números inválidos** (curtos, sem DDD, texto como "ramal 12"): não importar o número; importar o contato **sem telefone**
   apenas se o Mário marcar essa opção; sempre listar no relatório.
7. **Internacionais** (`+1...`, `+351...`): aceitos pela regra de 8–15 dígitos; sem a lógica do nono dígito.

## 5. Verificação de OAuth, modo de teste e limites (Caminho B)

Resumo do que se sabe hoje **[conferir tudo]**:

- **Tela de consentimento (OAuth consent screen)** no Google Cloud Console, tipo **Externo** (a conta do Mário não é de um Workspace
  da empresa) ou **Interno** (se fosse Google Workspace próprio).
- **Modo "Testing" (teste)**:
  - até **100 usuários de teste** cadastrados manualmente;
  - o consentimento mostra o aviso **"app não verificado"**;
  - **refresh tokens expiram em 7 dias** para apps externos em teste → a conexão cairia toda semana. Aceitável para uma carga única
    ou para experimentar; **inviável como sincronização contínua**.
- **Modo "Production" sem verificação**: para escopos sensíveis, o app aparece como "não verificado" e há um **teto de usuários** (100)
  até a verificação.
- **Verificação**: exige domínio próprio verificado, **política de privacidade** pública, **termos**, vídeo de demonstração do uso do
  escopo, justificativa de por que cada escopo é necessário. O prazo varia de dias a semanas. Para **um único usuário** (o Mário) a
  verificação é desproporcional; é por isso que o **Caminho A vem primeiro**.
- Existe a opção de **manter em modo de teste só com o Mário como usuário** e **reconectar quando cair** (7 dias). Serve para uma
  importação única disparada por ele, não para sincronização automática.

## 6. Conflitos e política de atualização

Ao casar um contato do Google com um que já existe:

| Situação | Proposta |
|---|---|
| Existe no ImobFlux **sem nome real** (só o número/pushName do WhatsApp) | **Atualiza o nome** com o da agenda. |
| Existe com **nome editado pela equipe** | **Não sobrescreve**; mostra na prévia "agenda: X / ImobFlux: Y" com escolha por linha (padrão: manter o do ImobFlux). |
| Existe como **contato protegido** | Importa para a agenda apenas se o proprietário confirmar; **a proteção é mantida** e o atendente continua sem ver. |
| Número novo | Cria contato **sem conversa** (aparece em Contatos). **Não** cria conversa, **não** envia mensagem. |
| Dois contatos do Google no mesmo número | Um só; o relatório lista o descarte. |
| Número já ligado a **outro** contato do ImobFlux | Conflito: nada é mesclado automaticamente; vai para uma lista "para revisar". |

Nunca apagar nada do ImobFlux por causa da agenda. Mesclar contatos é uma decisão **humana** (já existe fluxo de contatos; mescla
automática fica fora do escopo).

## 7. Experiência proposta (Fase 1)

1. **Contatos → Importar contatos** (proprietário). Passo a passo curto: "No Google Contatos: Exportar → Google CSV (ou vCard) → baixe".
2. Escolhe o arquivo. O **navegador** lê e normaliza; nada sobe ainda.
3. **Prévia** com contagens: *novos*, *já existentes (só nome)*, *conflitos*, *inválidos*, *duplicados no arquivo* — e as 20 primeiras
   linhas de cada grupo.
4. **Confirmar** → o servidor grava em lotes (ex.: 200 por vez, com progresso), de forma **idempotente** (reenviar o mesmo arquivo
   não duplica).
5. **Relatório final** baixável (sem expor mais dados que o necessário) + entrada de auditoria com **só as contagens**.
6. Desfazer: guardar o **lote da importação** (id + data) para permitir "desfazer esta importação" apenas dos contatos **criados** por
   ela e ainda sem conversa/oportunidade. Recomendado, porque 2 mil registros errados são chatos de limpar à mão.

## 8. LGPD e segurança

- **Base legal e finalidade**: os contatos são do próprio corretor, usados para atendê-los; o ImobFlux é operador. Informar na
  política de privacidade que a agenda é importada **por iniciativa do usuário** e usada **só** para identificar/atender.
- **Minimização**: importar **nome e telefone** (e e-mail só se o Mário quiser). **Não** importar foto, endereço, aniversário, notas,
  organização, a menos que haja uso claro.
- **Arquivo**: processar e descartar; **não** guardar o CSV/vCard no Storage.
- **Caminho B**: guardar o **refresh token criptografado** (chave fora do banco, em variável de ambiente do servidor); escopo
  **somente leitura**; botão "Desconectar e apagar token"; revogar também em `myaccount.google.com/permissions`.
- **Logs**: nenhum nome, telefone ou e-mail em log — só contagens e códigos de erro (padrão do projeto).
- **Direito de eliminação**: um contato apagado no ImobFlux não deve ser recriado pela próxima sincronização sem querer (guardar uma
  lista de "ignorados" por telefone ou por id do Google).
- **Quem pode importar**: somente o proprietário. Atendente não.
- **RLS**: o lote de importação é do workspace e segue as mesmas regras de visibilidade dos contatos.

## 9. Modelo de dados (se for implementar)

Sem mudar tabelas existentes além do mínimo:

- `contact_import_batches` (id, workspace, origem `csv|vcard|google`, criado_por, criado_em, contagens, status).
- Campo/tabela de **origem** do contato (`source_batch_id`, `external_source_id` do Google para sincronização futura).
- Função de importação em lote, `SECURITY DEFINER`, `search_path` vazio, só para proprietário, idempotente por
  (workspace, telefone normalizado), com auditoria sem dados pessoais.
- pgTAP: permissões, idempotência, contato protegido preservado, nono dígito, conflito não sobrescreve nome editado.

## 10. Passo a passo no Google Cloud Console (somente se o Caminho B for escolhido)

1. Criar um projeto novo (ex.: `imobflux-contatos`) em `console.cloud.google.com`.
2. **APIs e serviços → Biblioteca → People API → Ativar**.
3. **Tela de consentimento OAuth**: tipo *Externo*; nome do app, e-mail de suporte, logotipo opcional; domínio autorizado; links de
   política de privacidade e termos; escopo `.../auth/contacts.readonly`; adicionar o e-mail do Mário como **usuário de teste**.
4. **Credenciais → Criar credenciais → ID do cliente OAuth** (aplicativo da Web); URIs de redirecionamento autorizados =
   `https://<domínio-do-app>/api/google/callback` (e o equivalente de desenvolvimento).
5. Guardar `client_id` e `client_secret` **somente** em variáveis de ambiente do servidor (nunca no código, nunca no chat).
6. Fluxo no app: botão "Conectar Google" → consentimento → callback troca o código por tokens → listar contatos paginando
   (`pageSize=1000`) → mapear → prévia → gravar.
7. Para sair do modo de teste: publicar o app e iniciar o processo de **verificação** (política, vídeo, justificativa).

## 11. Esforço e riscos

| Item | Caminho A (arquivo) | Caminho B (Google) |
|---|---|---|
| Esforço estimado | Médio-baixo: 1 migration (lote + função), 1 tela, parser CSV/vCard, normalização, testes | Alto: tudo do A **+** OAuth, armazenamento seguro do token, sincronização, renovação, verificação |
| Dependência externa | Nenhuma | Google Cloud, verificação, domínio, política de privacidade |
| Risco de privacidade | Baixo (arquivo descartado) | Médio (token guardado) |
| Risco de erro de dados | Médio (casamento por telefone, nono dígito) — mitigado por prévia + desfazer | Igual + sincronização pode "ressuscitar" contato apagado |
| Manutenção | Quase nenhuma | Cotas, mudanças de política da Google, expiração de token |

Riscos transversais: **nono dígito** (falso "novo" ou falso "mesmo"), **contatos duplicados na agenda**, **números compartilhados**
(telefone fixo de escritório em vários contatos), **contatos sem telefone**, **nomes com emoji/maiúsculas estranhas** (guardar como
vieram; não "consertar").

## 12. Caminhos de decisão

- **Caminho A** — importar CSV/vCard (recomendado primeiro).
- **Caminho B** — People API com OAuth (só se houver necessidade real de sincronização contínua).
- **Caminho C** — A agora, B depois, se valer a pena.

## 13. Decisões que o Mário precisa tomar

1. **Qual caminho?** A, B ou C (recomendo **C, começando só pelo A**).
2. **Quem pode importar?** Só o proprietário (recomendado) ou também atendentes?
3. **O que fazer quando o nome da agenda é diferente do nome já no ImobFlux?** Manter o do ImobFlux (recomendado) / usar o da agenda /
   perguntar linha a linha na prévia.
4. **Contatos da agenda sem conversa** devem aparecer em **Contatos** (recomendado) ou só ser usados para dar nome a quem já falou?
5. **Importar e-mails também?** (padrão: só nome e telefone.)
6. **Contatos sem telefone**: ignorar (recomendado) ou importar só pelo nome?
7. **"Desfazer importação"** entra na primeira versão? (recomendado: sim.)
8. **Contatos protegidos**: quando o número da agenda é de um contato protegido, apenas dar o nome (sem mexer na proteção)? (recomendado)
9. **Se escolher B**: ele aceita ter **domínio e política de privacidade públicos** para a verificação, ou prefere ficar no modo de teste
   (reconectando a cada 7 dias) para uma carga única?
10. **Reimportação periódica**: quer um aviso "faz X dias que você não atualiza os contatos"?

## 14. Fontes oficiais para conferir antes de implementar

- Google People API — `people.connections.list` e sincronização incremental (developers.google.com/people).
- Escopos de OAuth e classificação de escopos sensíveis (developers.google.com/identity/protocols/oauth2/scopes).
- Verificação de app OAuth e limites do modo de teste (support.google.com/cloud/answer/13463073 e "OAuth App Verification FAQ").
- Exportação de contatos do Google (support.google.com/contacts/answer/7199294).
- Formato E.164 (UIT-T) e plano de numeração brasileiro / nono dígito (Anatel).
