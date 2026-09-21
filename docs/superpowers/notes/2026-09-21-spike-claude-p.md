# Spike do `claude -p` (2026-09-21)

Prompt de teste: `Responda apenas a palavra: pong`, modelo `haiku`, pasta com um `CLAUDE.md` de uma linha. Todas as chamadas com `-p --output-format json --tools Read --permission-mode dontAsk --disable-slash-commands`, prompt por stdin.

| Variante | Entrada total (tokens) | Relógio | `duration_ms` |
|---|---|---|---|
| Baseline (`~/.claude` normal) | 94.366 | 33,7 s | 7.809 |
| `--restricted --strict-mcp-config` | 5.271 | 12 s | 3.465 |
| `--safe-mode --strict-mcp-config` | 5.290 | 12 s | 2.850 |
| Final: `--restricted --strict-mcp-config --append-system-prompt-file CLAUDE.md` | 5.358 | 14 s | 5.773 |

## Achados

1. O `~/.claude` do usuário (plugins, hooks, conectores) inflaria **cada mensagem em cerca de 89 mil tokens** e levaria mais de 30 s. Nunca rodar o bot sem isolamento.
2. `--restricted` isola das configurações de usuário, de projeto e locais sem exigir outro login (mantém a autenticação da assinatura).
3. `--restricted` **não carrega o `CLAUDE.md`**. As instruções do agente entram por `--append-system-prompt-file <pasta do agente>/CLAUDE.md` (confirmado: a resposta seguiu a regra do arquivo).
4. `--restricted` **nega a leitura fora da pasta de trabalho e do `--add-dir`** ("fora do diretório de trabalho permitido"). O controle, lendo um arquivo dentro da pasta, funcionou.
5. Prompt por **stdin** funciona, inclusive quando começa com `-` (`-50 reais de gasolina...`).
6. `--resume <session_id>` funciona com `--restricted`, e o `session_id` devolvido é o mesmo. A resposta seguinte lembrou da anterior.
7. Formato da saída: um único objeto JSON com `type: "result"`, `subtype`, `is_error`, `result`, `session_id`, `total_cost_usd`, `duration_ms` e `usage`. A fixture real está em `bridge/test/fixtures/claude-result.json`.

## Decisão

- **Não** usar `CLAUDE_CONFIG_DIR` dedicado (o suporte fica no runner como opcional, sem uso).
- Chamada do agente: `claude -p --output-format json --model <m> --max-turns <n> --tools <t> --allowedTools <a> --permission-mode dontAsk --disable-slash-commands --restricted --strict-mcp-config --append-system-prompt-file <agente>/CLAUDE.md [--resume <id>] [--add-dir <mídia>]`, com o prompt por stdin.
- `--safe-mode` custa o mesmo, mas descarta o `CLAUDE.md` e não traz o confinamento de arquivos; ficou de fora.
- O teste de isolamento do Task 13 continua valendo, agora como confirmação da variante com `Bash`.
