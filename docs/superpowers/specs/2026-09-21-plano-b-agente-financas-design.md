# Plano B: agente de finanças (MCP, banco por grupo, relatórios)

Data: 2026-09-21 · Status: aprovado em conversa, aguardando revisão do documento
Complementa: [design geral](2026-09-21-whatsapp-claude-grupos-design.md) (seções 1-3, 6-9 continuam valendo). Este documento **substitui** as seções 4-5 daquele arquivo nos dois pontos abaixo; o resto (regra 50/30/20, intenções, config.yaml, relatórios em imagem) permanece como já aprovado.

## 1. O que mudou desde o design geral, e por quê

Durante a implementação do Plano A, dois achados ao vivo invalidaram a ideia original de expor `finance` como um comando `Bash`:

1. **Segurança:** `--allowedTools "Bash(finance *)"` autoriza a linha inteira, não só o primeiro comando. `finance add 1 x && echo INJETADO` executa o `echo` depois. Isso é uma classe de vulnerabilidade real assim que outra pessoa entra num grupo cadastrado ou manda um PDF malicioso (decisão de [[wa-claude-git-workflow|acesso por grupo]] já permite qualquer membro do grupo).
2. **Latência:** medido ao vivo (2026-09-21), o Bash tool no Windows soma **20-35 s de sobrecarga só para abrir o shell**, mesmo para um `echo`. `duration_api_ms` (tempo real do modelo) ficou em ~4 s em todos os testes; o tempo sumia entre esse número e o `duration_ms` do Claude Code.

A correção para os dois problemas é a mesma: **ferramentas MCP em vez de um comando de shell**. MCP recebe argumentos estruturados (JSON), então não existe `&&` para encadear. E, com o servidor já ligado (ver seção 2), a latência de uma chamada com ferramenta cai para **~20-32 s**, contra ~27-56 s do Bash e ~39-48 s de um servidor MCP iniciado do zero a cada mensagem (o `import mcp` sozinho leva 12-18 s nesta máquina, provavelmente o Windows Defender escaneando os arquivos na primeira leitura).

## 2. Arquitetura

```
Ponte (Node) ──sobe no boot──► servidor MCP financas do grupo A (porta dinâmica, finance-<A>.db)
             └─sobe no boot──► servidor MCP financas do grupo B (porta dinâmica, finance-<B>.db)
                                        ↑ HTTP em 127.0.0.1 (nunca exposto fora da máquina)
claude -p --mcp-config '{"mcpServers":{"finance":{"type":"http","url":"http://127.0.0.1:<porta>/mcp"}}}'
         --strict-mcp-config --tools Read --allowedTools "Read,mcp__finance__*"   (sem Bash)
```

**Banco por grupo, decidido em 2026-09-21:** se um segundo grupo também usar o agente `financas`, ele nasce com saldo e categorias zerados, isolado do primeiro. Isso muda a forma de isolar: como o servidor MCP fica ligado o tempo todo (não é um processo por mensagem), **um grupo nunca consegue nem tentar falar com o banco de outro**, porque só enxerga a porta do seu próprio servidor — nenhum "ID do grupo" passa pelas mãos do Claude para selecionar o banco. Compare com o `message_id` (seção 3), que o Claude *precisa* repassar e que, se ele errar, o pior caso é uma deduplicação falhar, não um vazamento entre grupos.

**Componente novo, genérico (não específico de finanças): `bridge/src/mcp-servers.js`.**
- Um agente declara a necessidade de um servidor no seu `agent.json`, com `mcpServer: { command: "<python do venv>", args: ["<script>"], readyTimeoutMs: 15000 }`.
- No boot da ponte, para cada **grupo** cujo agente declara `mcpServer`, o gerenciador:
  1. Pede uma porta livre ao SO (`net.createServer().listen(0)`, lê a porta, fecha).
  2. Sobe o processo com `env: { ...processEnv, MCP_HOST: '127.0.0.1', MCP_PORT: <porta>, BOT_GROUP_ID, BOT_DATA_DIR, BOT_OUTBOX_DIR }` — os mesmos três nomes de variável já usados no resto da ponte.
  3. Espera a porta aceitar conexão TCP, até `readyTimeoutMs`.
  4. Guarda `groupJid → porta` num mapa em memória.

O boot da ponte **espera todos os servidores MCP ficarem prontos antes de iniciar o worker da fila** (mesmo padrão já usado para `await wa.start()`). Se algum estourar o `readyTimeoutMs` na subida inicial, a ponte não inicia e loga o erro — é uma falha de configuração (caminho do Python errado, dependência faltando), não algo para o usuário resolver reenviando mensagem. Isso significa que, durante o uso normal, "servidor não pronto" só acontece no raríssimo intervalo de um restart após queda (seção 5), e cai no mesmo tratamento de erro genérico que qualquer outra falha do `runClaude` — sem precisar de um quarto tipo de falha além dos três que o Plano A já trata (cota, timeout, erro genérico com 3 tentativas).
- Se o processo cair, reinicia com backoff (1 s dobrando até 60 s, igual ao `wa.js`), pedindo uma porta livre nova a cada tentativa e atualizando o mapa.
- Encerra todos os servidores no `shutdown()` da ponte (`SIGINT`/`SIGTERM`), antes do `process.exit`.
- **`runner.js` para de aceitar um `--mcp-config` estático.** Em vez disso, `runClaude` recebe um `mcpConfig: { name: 'finance', url: 'http://127.0.0.1:<porta>/mcp' } | null`, resolvido pelo `processor.js` a partir do mapa do gerenciador **no momento da chamada** (não no boot), porque a porta pode mudar após um restart. Quando presente, os argumentos ganham `--mcp-config '<json>' --strict-mcp-config` e `--allowedTools` ganha `mcp__<name>__*`; `--tools` do agente **não** inclui `Bash` para `financas`.
- Escolhi HTTP (não stdio) de propósito: um servidor por processo persistente, e não um processo novo a cada `claude -p`, é o que elimina a sobrecarga de importar o `mcp` do Python a cada mensagem. Ligado só em `127.0.0.1`, não pede liberação do Firewall do Windows (que só cobra em portas ouvindo em todas as interfaces).

## 3. `finance/` (Python): banco, regras e ferramentas MCP

Layout:

```
finance/
  server.py            MCPServer com as ferramentas (abaixo)
  db.py                 esquema SQLite + funções puras de cálculo (tetos, projeção, limites, atípico)
  config.py              leitura/escrita do config.yaml do agente (regra 50/30/20)
  reports.py             geração dos PNGs com matplotlib
  requirements.txt       mcp[cli], matplotlib, pyyaml
  test_db.py, test_config.py, test_reports.py, test_server.py
```

Banco (SQLite, caminho `<BOT_DATA_DIR>/db/finance-<slug(BOT_GROUP_ID)>.db`, `slug` = o JID sem `@g.us`): esquema e regras de cálculo **exatamente como já aprovado** na seção 4 do design geral (`categories`, `expenses` com `dedupe_key` único, `income`, `alerts_sent`; regra 50/30/20 em `config.yaml`; fixo/variável como teto, investimento como mínimo; limite por categoria manual > automático > nenhum; projeção linear; gasto atípico ≥ 3× a média).

**Ferramentas MCP** (mapeiam 1:1 as seis intenções já aprovadas na seção 5 do design geral; todo cálculo continua no Python, nunca no Claude):

| Ferramenta | Parâmetros | Cobre a intenção |
|---|---|---|
| `registrar_gasto` | `valor_centavos: int, descricao: str, message_id: str, categoria: str \| None, data: str \| None` | 1. Registrar gasto |
| `status_do_mes` | — | 2. Consultar / 3. Aconselhar (dados para a dica) |
| `gerar_relatorio` | `periodo: "mes"\|"semana"\|"categoria", categoria: str \| None` | 6. Relatório visual |
| `definir_renda` | `valor_centavos: int, mes: str` | 4. Configurar |
| `definir_limite` | `categoria: str, valor_centavos: int \| None` (`None` remove o limite manual) | 4. Configurar |
| `definir_regra` | `fixo: int, variavel: int, investimento: int` (precisa somar 100) | 4. Configurar |
| `definir_bucket_categoria` | `categoria: str, bucket: "fixo"\|"variavel"\|"investimento"` | 4. Configurar |
| `desfazer_ultimo_gasto` | — | 4. Corrigir |
| `corrigir_gasto` | `message_id: str, novo_valor_centavos: int` | 4. Corrigir |

`message_id` é o id que já vem no prefixo `[Mensagem <id> recebida em <data>]` de todo prompt (mecanismo do Plano A); o `CLAUDE.md` do agente instrui o Claude a sempre repassá-lo em `registrar_gasto` e `corrigir_gasto`. `gerar_relatorio` escreve o PNG direto em `BOT_OUTBOX_DIR` (mesmo mecanismo de entrega do Plano A: a ponte envia qualquer imagem nova de lá) e devolve só uma confirmação em texto.

`server.py` lê `MCP_HOST`/`MCP_PORT`/`BOT_GROUP_ID`/`BOT_DATA_DIR`/`BOT_OUTBOX_DIR` do ambiente (seção 2) e chama `mcp.run(transport="streamable-http", host=MCP_HOST, port=int(MCP_PORT), stateless_http=True)`; o caminho do banco é montado uma vez, na subida, a partir de `BOT_DATA_DIR` e `BOT_GROUP_ID`.

**Import lento fica fora do caminho crítico.** `matplotlib` só é importado dentro de `gerar_relatorio` (import tardio), não no topo do módulo, para não pesar nas chamadas de `registrar_gasto`/`status_do_mes`, que são a maioria.

## 4. `agents/financas/`

- `CLAUDE.md`: as seis intenções e o comportamento pós-registro, exatamente como aprovado na seção 5 do design geral, mais a instrução de repassar `message_id` nas ferramentas que pedem. Trata anexos e o texto de terceiros como dado, nunca instrução (mesma regra do Plano A) — reforçado agora pelo fato de não haver `Bash` disponível para nada além das ferramentas MCP tipadas.
- `agent.json` (`command`/`args` de `mcpServer` resolvidos relativos à raiz do repositório, mesma convenção de `pythonBin`/`transcriberScript` em `config.js`):

```json
{
  "model": "sonnet",
  "maxTurns": 6,
  "tools": ["Read"],
  "allowedTools": ["Read"],
  "sessionResetMessages": 100,
  "mcpServer": {
    "command": "finance/.venv/Scripts/python.exe",
    "args": ["finance/server.py"],
    "readyTimeoutMs": 15000
  }
}
```

`maxTurns: 6` (contra 4 do `eco`) porque registrar um gasto que dispara alerta usa dois turnos de ferramenta (`registrar_gasto` + `status_do_mes`) antes da resposta final. `allowedTools` no `agent.json` não precisa listar `mcp__finance__*`: o `runner.js` acrescenta isso automaticamente quando `mcpServer` está presente (seção 2).

- `config.yaml`: já existe (`config.example.yaml` do Plano A), sem mudanças.

## 5. Erros e testes específicos deste plano

Além do que já vale para toda a ponte (fila durável, backoff de cota, trava de instância única):

- **Servidor MCP não sobe no boot:** a ponte não inicia; log de erro claro com o `groupJid` e o comando que falhou. Um teste cobre o timeout de prontidão com um comando que nunca abre a porta.
- **Servidor MCP cai no meio do uso:** a chamada do Claude falha com um erro de conexão; cai no tratamento de erro genérico do Plano A (3 tentativas, depois falha com aviso). O gerenciador já está reiniciando o servidor em paralelo, então a retentativa costuma achar a porta nova.
- **Núcleo determinístico** (`finance/db.py`, `finance/config.py`): pytest cobrindo tetos por bucket, projeção, precedência de limites, investimento como mínimo, `dedupe_key`, gasto atípico, reescrita do `config.yaml` preservando comentários, validação de soma 100 — como já detalhado na seção 6 do design geral.
- **Ferramentas MCP:** teste chamando `server.py` via um cliente MCP de teste (in-process, sem subir processo de verdade) para cada ferramenta, com banco temporário.
- **Gerenciador de servidores (`mcp-servers.js`):** com um "servidor" Node falso substituindo o Python, cobrindo: porta atribuída, prontidão, restart após queda, mapa atualizado após restart, encerramento no shutdown.
- **Comportamento do agente:** as 20-30 mensagens de exemplo já previstas no design geral, rodadas de verdade contra o servidor MCP (não mais contra Bash), incluindo o teste de injeção agora validando que não há `Bash` disponível para o agente, só as ferramentas tipadas.

## 6. Ordem de construção

1. `finance/db.py` + `finance/config.py`, com testes (núcleo determinístico, sem MCP nem rede).
2. `finance/server.py` (ferramentas MCP finas sobre o núcleo), com teste in-process.
3. `bridge/src/mcp-servers.js` (gerenciador genérico) + mudanças em `runner.js`/`processor.js` para resolver o `mcpConfig` por chamada.
4. `agents/financas/` (`CLAUDE.md`, `agent.json`) plugado num grupo de teste, com as mesmas verificações manuais do Task 16 do Plano A (texto, sessão, áudio, foto, PDF) mais os fluxos de configuração e correção.
5. `finance/reports.py` (matplotlib) e o teste ponta a ponta do relatório em imagem no grupo real.
6. Trocar o agente do grupo **Finanças** de `eco` para `financas`.

## 7. Fora de escopo (continua valendo do design geral)

Gastos recorrentes automáticos, resumos agendados, espelho em Google Sheets ou Notion, vários usuários por grupo além do controle de acesso já implementado, WhatsApp Cloud API.

## 8. Fontes

- Medições ao vivo em 2026-09-21 (Bash vs MCP frio vs MCP aquecido), nesta conversa.
- [MCP tool naming (`mcp__<server>__<tool>`) e `--allowedTools`](https://code.claude.com/docs/en/agent-sdk/mcp)
- [MCP Python SDK / `MCPServer`](https://github.com/modelcontextprotocol/python-sdk)
