# wa-claude

Assistente pessoal em grupos de WhatsApp com Claude Code. Cada grupo é ligado a um agente próprio; o primeiro é o de finanças (gastos por texto, áudio, foto ou PDF, regra 50/30/20 e relatórios em imagem). Roda inteiro na máquina local, sem custo adicional além do plano do Claude.

**Status:** em design. Veja [o documento de design](docs/superpowers/specs/2026-09-21-whatsapp-claude-grupos-design.md).

## Configuração (quando a implementação existir)

Segredos e dados pessoais nunca vão para o git. Copie os exemplos e preencha com seus valores:

| Exemplo (versionado) | Arquivo real (ignorado pelo git) |
|---|---|
| `.env.example` | `.env` |
| `config/groups.example.json` | `config/groups.json` |
| `agents/financas/config.example.yaml` | `agents/financas/config.yaml` |

A pasta `data/` guarda a sessão do WhatsApp, os bancos, a mídia baixada e os logs, e também fica fora do git.

> Aviso: conectar o WhatsApp como dispositivo vinculado por biblioteca não oficial viola os termos do WhatsApp e pode levar ao banimento do número usado. Use um número secundário.
