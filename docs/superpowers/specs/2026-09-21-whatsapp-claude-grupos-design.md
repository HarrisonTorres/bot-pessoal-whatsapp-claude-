# Assistente pessoal em grupos de WhatsApp com Claude Code: design

Data: 2026-09-21 · Status: aprovado em conversa, aguardando revisão do documento

## 1. Objetivo

Conversar com o Claude Code (plano Pro) por **grupos de WhatsApp**, cada grupo ligado a um agente próprio com contexto e dados próprios. O primeiro agente é o de **finanças**: registra gastos enviados por texto, áudio, foto ou PDF, categoriza, acompanha a regra 50/30/20 e responde perguntas, dicas e relatórios em imagem. Grupos novos (ideias, conselhos etc.) devem plugar na mesma infra sem mexer no núcleo.

Restrições do usuário: sem custo adicional, tudo na própria máquina (Windows 11), número secundário do WhatsApp Business (app gratuito) como "bot", número principal como único remetente autorizado.

## 2. Viabilidade e decisões

| Tema | Achado | Decisão |
|---|---|---|
| API oficial do WhatsApp | A Groups API da Cloud API exige conta oficial verificada (OBA), limita grupos a 8 membros e não existe no app Business gratuito. | Não usar. |
| Conexão real | Ligar o número secundário como **dispositivo vinculado** (mesmo protocolo do WhatsApp Web) com **Baileys**. Viola os termos do WhatsApp e há risco de banimento do número secundário. | Risco **aceito pelo usuário**, com mitigações (seção 6). |
| Claude no plano Pro | `claude -p` (headless) roda na assinatura. A Anthropic anunciou cobrança separada (crédito de US$ 20/mês no Pro) a partir de 15/06/2026, mas a página oficial informa que a mudança está **pausada**; em 2026-09-21 o `claude -p` ainda consome a cota da assinatura. Pode voltar. | Usar `claude -p`; tratar a mudança como risco conhecido. Nunca usar `--bare` (ele desativa o login da assinatura e exige chave de API). |
| Channels do Claude Code | Plugins de canal (Telegram, Discord, iMessage) são oficiais; os de WhatsApp são comunitários, fora da lista aprovada, e usam uma sessão única para tudo. | Descartado para o núcleo; útil só para experimentos. |
| Agent SDK com chave de API | Robusto, mas tem custo. | Descartado (fere a restrição de custo). |
| Áudio | O Claude não recebe áudio. | Transcrição local com Whisper. |
| Imagem e PDF | O Claude Code lê pela ferramenta `Read`. | Enviar o caminho do arquivo no prompt. |

## 3. Arquitetura da infra

```
Grupo WhatsApp ──► bridge (Node/Baileys) ──► router ──► claude -p ──► resposta no grupo
                        │                                    │
                        └─ áudio ─► transcritor (Python) ────┘
```

Layout do repositório (`C:\Users\Harri\wa-claude\`):

```
bridge/        Node + Baileys: conexão, filtros, fila, envio de texto e imagem
transcriber/   Python + faster-whisper (pt-BR)
finance/       Python: CLI `finance`, esquema SQLite, relatórios (matplotlib)
agents/
  financas/    agent.json, CLAUDE.md, config.example.yaml (config.yaml fica fora do git)
config/        groups.example.json (groups.json fica fora do git)
data/          FORA DO GIT: auth/ (sessão do WhatsApp), db/, media/, outbox/<grupo>/, logs/
docs/superpowers/specs/
```

Componentes:

- **bridge**: conecta como dispositivo vinculado. Processa só grupos presentes em `config/groups.json` e só mensagens do `OWNER_JID` (`.env`). Ignora as próprias respostas (evita loop). Baixa mídia para `data/media/<grupo>/`. Mantém uma fila durável e executa **uma chamada do Claude por vez no total** (uso pessoal; protege a cota). Envia texto e qualquer arquivo novo que apareça em `data/outbox/<grupo>/`.
- **router**: `config/groups.json` mapeia `ID do grupo → agente`. Determinístico, sem IA. Grupo novo = pasta em `agents/` + uma entrada no arquivo.
- **transcritor**: áudio (ogg/opus) vira texto com `faster-whisper`, idioma pt, modelo definido por `WHISPER_MODEL`. Roda antes da chamada ao Claude. Se falhar ou vier vazio, o bot pede para repetir ou escrever.
- **agente** (`agents/<nome>/`): `CLAUDE.md` com regras e persona, mais `agent.json` com `model`, `maxTurns`, `tools`, `allowedTools` e `sessionResetMessages`.

Chamada ao Claude (cwd = pasta do agente):

```
<prompt por stdin> | claude -p --output-format json [--resume <session_id>]
  --model <agent.model> --max-turns <agent.maxTurns>
  --tools "Read,Bash" --allowedTools "Read,Bash(finance *)"
  --permission-mode dontAsk --disable-slash-commands
  --restricted --strict-mcp-config
  --append-system-prompt-file agents/<nome>/CLAUDE.md
  --add-dir data/media/<grupo>
```

O `session_id` devolvido no JSON é guardado por grupo e reusado com `--resume`, então cada grupo tem conversa contínua e isolada. A sessão é reiniciada na virada do mês ou após `sessionResetMessages` mensagens (padrão 100), sem perda de informação, porque o histórico está no banco e as regras estão no `CLAUDE.md`. O bot define `BOT_GROUP_ID`, `BOT_DATA_DIR` e `BOT_OUTBOX_DIR` no ambiente de cada chamada, de modo que o agente só escreve na `outbox/` do próprio grupo. O atalho para chamar `finance` no Windows é definido no plano de implementação.

**Isolamento do `~/.claude` do usuário (medido no spike de 2026-09-21).** Sem isolamento, o `claude -p` carrega hooks, plugins e conectores globais: 94.366 tokens de entrada e 33 s para um "pong". Com `--restricted --strict-mcp-config` caiu para 5.271 tokens e 12 s, sem precisar de outro login (o `--bare` continua proibido, porque desliga o login da assinatura). O `--restricted` também confina as ferramentas de arquivo à pasta do agente e ao `--add-dir`, mas não carrega o `CLAUDE.md`, por isso ele entra por `--append-system-prompt-file`. Um `CLAUDE_CONFIG_DIR` dedicado ficou desnecessário. Detalhes em `docs/superpowers/notes/2026-09-21-spike-claude-p.md`.

Estado do bot em SQLite, separado dos dados do agente:

- `data/db/bridge.db`: `inbox(message_id PK, group_jid, sender_jid, kind, received_at, status, attempts, error, payload)` com status `pendente | feito | falhou`; `sessions(group_jid PK, session_id, started_at, messages)`.
- `data/db/finance.db`: dados de finanças (seção 4). Cada agente futuro terá seu próprio banco.

## 4. Dados e regra 50/30/20

Valores em centavos, fuso `America/Sao_Paulo`, moeda BRL.

- `categories(id, name UNIQUE, bucket CHECK IN ('fixo','variavel','investimento'), monthly_limit_cents NULL)`
- `expenses(id, dedupe_key UNIQUE, date, amount_cents, description, category_id, source, attachment_path, created_at)`. O `dedupe_key` é `message_id:indice`, porque uma mensagem pode gerar vários gastos e o WhatsApp pode reentregar a mesma mensagem.
- `income(month PK 'YYYY-MM', amount_cents)`. Se o mês não tiver renda própria, vale a do mês anterior. Sem nenhuma renda cadastrada, o agente registra os gastos normalmente e lembra uma vez de informar a renda.
- `alerts_sent(scope, month, kind, PRIMARY KEY(scope, month, kind))`, para não repetir avisos.

**Regra em `agents/financas/config.yaml`** (fonte única da verdade; o repositório traz só `config.example.yaml`, comentado). Chaves: `regra.fixo`, `regra.variavel`, `regra.investimento` (soma 100), `alerta_percentual` (80) e `gasto_atipico_multiplo` (3). O usuário edita à mão ou pede no grupo; o CLI valida a soma e reescreve só os números, preservando os comentários.

**Cálculos** (sempre feitos pelo CLI, nunca pelo Claude):

1. Teto do bucket = renda do mês × percentual.
2. Fixo e variável são **tetos**; investimento é um **mínimo a atingir**.
3. Limite por categoria, em ordem de prioridade: manual (`limite mercado 800`), automático (média dos totais mensais dos meses completos anteriores, exige pelo menos 2 meses de histórico), nenhum.
4. Projeção do mês = gasto até hoje ÷ dias corridos × dias do mês.
5. Gasto atípico = valor ≥ `gasto_atipico_multiplo` × média dos gastos anteriores da categoria (mínimo de 5 gastos anteriores).

**Categoria nova**: o agente escolhe o bucket e mostra na confirmação; o usuário corrige no grupo ("combustível é fixo").

## 5. Agente de finanças

O `CLAUDE.md` instrui o Claude a classificar cada mensagem em uma de seis intenções:

1. **Registrar gasto** (texto, áudio transcrito, foto ou PDF): extrai valor, descrição, data e categoria. Duas ocorrências na mesma mensagem viram dois registros. Comprovante com vários itens vira **um** gasto, com o total e a categoria do estabelecimento. A data é a do comprovante, ou a de hoje.
2. **Consultar** ("quanto gastei esse mês", "como estou na regra?").
3. **Aconselhar** ("no que posso economizar?").
4. **Configurar ou corrigir**: renda, limites, regra, bucket de categoria, "desfazer", "na verdade foram 55".
5. **Ambíguo ou fora do assunto**: uma pergunta curta em vez de um chute; conversa sem relação com finanças recebe resposta breve e não é registrada.
6. **Relatório visual**: só quando o usuário pede "relatório", "gráfico", "imagem" ou similar, para o **mês** (padrão), a **semana** ou uma **categoria**. Perguntas simples continuam em texto de no máximo 4 linhas.

**Depois de registrar um gasto:**

1. Responde `Okay ✅ R$ 50,00 · Combustível (variável)`, uma linha por gasto.
2. Roda `finance status`, que calcula os números do mês.
3. Manda uma segunda mensagem (no máximo 4 linhas, com números concretos) só se houver algo a dizer: um bucket ou limite de categoria cruzou 80% ou 100% (cada limiar dispara **uma vez por mês** por bucket ou categoria), a projeção passou a estourar o teto (uma vez por mês), o gasto foi atípico, ou faltam 7 dias ou menos para o fim do mês com o investimento abaixo da meta ("faltam R$ X para os 20%", uma vez). Pedido explícito de "resumo" sempre gera a análise completa.

**Relatório em imagem.** `finance report --periodo mes|semana|categoria [--categoria X]` desenha um PNG em `BOT_OUTBOX_DIR` com matplotlib, a partir do SQLite:

- **Mês**: barras por bucket (real contra o teto da regra), categorias com marca do limite, curva acumulada do mês com projeção e teto.
- **Semana**: gasto por dia e principais categorias da semana.
- **Categoria**: evolução por mês e dia a dia no mês atual, maiores gastos, comparação com limite e média.

A ponte envia o arquivo como imagem, com legenda de destaques e pontos de atenção do período (mais detalhada que a resposta curta).

## 6. Erros, segurança e testes

**Erros e falhas**

- Toda mensagem entra na `inbox` antes de ser processada; ao reiniciar, as pendentes são reprocessadas. O `dedupe_key` impede gasto duplicado.
- Cota do Claude esgotada: o bot avisa uma vez no grupo ("volto a responder às HH:MM") e tenta de novo com espera crescente.
- Áudio ilegível: pede para repetir ou escrever; nada é registrado.
- WhatsApp caiu: reconexão automática. Se a sessão for desvinculada ou o número banido, notificação do Windows. Os dados ficam seguros; migrar é escanear o QR de novo, inclusive com outro número.
- PC desligado: mensagens costumam chegar quando a ponte reconecta, sem garantia; se alguma sumir, o usuário reenvia. A ponte sobe no login do Windows com reinício automático.

**Segurança**

- Só o `OWNER_JID` e os grupos cadastrados são processados; o resto é ignorado em silêncio.
- O agente roda com `--tools "Read,Bash"`, `--allowedTools "Read" "Bash(finance *)"` e `--permission-mode dontAsk`. No `dontAsk`, tudo que exigiria confirmação é negado, mas o que não exige continua permitido: leitura dentro dos diretórios de trabalho e o conjunto padrão de comandos somente-leitura. Por isso a sessão do WhatsApp (`data/auth/`) fica fora do diretório de trabalho e do `--add-dir` do agente, e o plano inclui um teste confirmando que o agente não consegue lê-la. Anexos e mensagens encaminhadas são dado, não instrução (regra também no `CLAUDE.md`, mas o controle real são as ferramentas e os diretórios liberados).
- Segredos e dados pessoais (`.env`, `data/`, `config/groups.json`, `agents/*/config.yaml`) estão no `.gitignore`; o repositório traz só arquivos `*.example` com valores fictícios.
- Mitigação de banimento: só responde ao que o usuário manda, com pequena pausa e "digitando…", baixo volume, IP residencial, sem mensagens em massa nem contatos desconhecidos.

**Testes**

- **Núcleo determinístico** (CLI `finance`), automatizado: tetos, projeção, precedência de limites, investimento como mínimo, reescrita do `config.yaml` com comentários preservados, validação de soma 100, deduplicação, alertas de uma vez por mês.
- **Ponte e roteador**, com um WhatsApp falso: filtro de remetente, loop de mensagens próprias, roteamento por grupo, envio da `outbox/`, reprocessamento da `inbox`.
- **Comportamento do agente**: 20 a 30 mensagens de exemplo em pt-BR (gasto em texto, áudio transcrito, pergunta, relatório, ambíguo, injeção dentro de PDF, pedido de ler `data/auth`) contra um banco temporário; conferem o estado do banco e a intenção, não o texto exato. Rodam à mão, porque gastam cota.
- **Imagens**: geração com dados de fixture (arquivo criado, dimensões) mais revisão visual nas primeiras versões.
- **Ponta a ponta**: um grupo de teste com o número real antes do grupo de finanças de verdade.

## 7. Ordem de construção

1. **Infra**: ponte com fila durável, registro de grupos e agente "eco". Começa pelo teste de custo do `~/.claude` e valida o maior risco: parear o Baileys, ler grupos, baixar mídia.
2. Transcrição com Whisper.
3. CLI `finance` com banco e config, com testes.
4. Agente de finanças: intenções, confirmação e alertas.
5. Relatórios em imagem.

Dois planos de implementação: **Plano A** (etapas 1 e 2, infra) e **Plano B** (etapas 3 a 5, finanças). O A vem primeiro.

## 8. Fora de escopo

Gastos recorrentes automáticos (contas fixas todo mês), resumos agendados, espelho em Google Sheets ou Notion, vários usuários, WhatsApp Cloud API e agentes além do de finanças (a infra já os comporta).

## 9. Fontes

- [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- [CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Channels do Claude Code](https://code.claude.com/docs/en/channels)
- [WhatsApp Group API 2026: limites e alternativas (Unipile)](https://www.unipile.com/whatsapp-group-api/)
- [Baileys, whatsapp-web.js, Selenium: o risco de banimento é real](https://leadnotifi.com/articles/unofficial-whatsapp-tools-ban-risk)
