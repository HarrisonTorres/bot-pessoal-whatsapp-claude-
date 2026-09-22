# wa-claude

Assistente pessoal em grupos de WhatsApp com Claude Code. Cada grupo é ligado a um agente próprio; o primeiro é o de finanças (gastos por texto, áudio, foto ou PDF, regra 50/30/20 e relatórios em imagem). Roda inteiro na máquina local, sem custo adicional além do plano do Claude.

**Status:** infra (Plano A) implementada e testada ao vivo — texto, áudio e foto confirmados com o WhatsApp e o Claude reais. Próximo: agente de finanças (Plano B). Veja [o design](docs/superpowers/specs/2026-09-21-whatsapp-claude-grupos-design.md) e [o Plano A](docs/superpowers/plans/2026-09-21-plano-a-infra.md).

## Comandos

| O quê | Comando |
|---|---|
| Testes automatizados | `npm test` |
| Teste de isolamento com o Claude real (gasta cota) | `npm run test:live` |
| Rodar a ponte no terminal | `npm start` |
| Início automático no login | `powershell -File scripts\install-autostart.ps1` (remova com `-Remove`) |
| Testes do transcritor | `transcriber\.venv\Scripts\python.exe -m pytest transcriber` |

Logs em `data\logs\bridge.log`; avisos importantes em `data\logs\ALERTA.txt`. Só uma instância da ponte roda por vez: uma segunda é recusada com uma mensagem clara em vez de disputar a sessão do WhatsApp com a primeira.

## Adicionar um grupo

1. Crie a pasta `agents/<nome>/` com `CLAUDE.md` (e, opcionalmente, `agent.json`).
2. Mande uma mensagem no grupo e leia o `groupJid` no log (`group-not-registered`).
3. Acrescente-o em `config/groups.json` e reinicie a ponte. Por padrão qualquer membro do grupo é atendido; adicione `"somenteDono": true` para restringir ao dono (`OWNER_JID`/`OWNER_LID` no `.env`).

## Parear de novo

Se o WhatsApp desvincular o aparelho: pare a ponte, apague a pasta de sessão (`data\auth` ou `WA_AUTH_DIR`), rode `npm start`, escaneie o QR e reinicie normalmente.

## Configuração

Segredos e dados pessoais nunca vão para o git. Copie os exemplos e preencha com seus valores:

| Exemplo (versionado) | Arquivo real (ignorado pelo git) |
|---|---|
| `.env.example` | `.env` |
| `config/groups.example.json` | `config/groups.json` |
| `agents/financas/config.example.yaml` | `agents/financas/config.yaml` |

A pasta `data/` guarda a sessão do WhatsApp, os bancos, a mídia baixada e os logs, e também fica fora do git.

> Aviso: conectar o WhatsApp como dispositivo vinculado por biblioteca não oficial viola os termos do WhatsApp e pode levar ao banimento do número usado. Use um número secundário.
