# claude-glm-relay-setup

Get **Claude Code running on Zhipu GLM** with your own GLM API key — no Anthropic account, no subscription.

[中文说明 →](README.zh-CN.md)

This repo ships two interchangeable forms of the same procedure:

| Form | For whom |
| --- | --- |
| **A prompt** — [`PROMPT.zh-CN.md`](PROMPT.zh-CN.md) | Anyone. Copy-paste it into any agent that can run terminal commands. No install step. |
| **A Codex skill** — [`SKILL.md`](SKILL.md) + [`scripts/`](scripts/) + [`references/`](references/) | People already using Codex. The agent discovers it, follows the workflow, and runs a deterministic config script instead of improvising. |

## Scope — read this first

**In scope**

- Machines where Claude Code is not installed yet → install and configure it.
- Machines where Claude Code is installed but unusable (no Anthropic account or subscription) → wire it to GLM.
- People who want pay-as-you-go GLM billing, or several providers behind one local gateway.

**Out of scope**

- People who already have a working Anthropic subscription — they do not need this.
- Hosted/multi-tenant deployments. This is a per-machine local setup.
- Anything that hides the fact that requests go to Zhipu instead of Anthropic.

## Two routes — decide before installing anything

| Your situation | Route | Installed |
| --- | --- | --- |
| You have an **active GLM Coding Plan** subscription | **Direct.** Claude Code talks straight to Zhipu's Anthropic-compatible endpoint. | Claude Code only |
| **No subscription** (pay-as-you-go), or you want multi-provider routing, rule-based routing, or automatic model fallback | **CCR relay.** Claude Code → local [claude-code-router](https://github.com/musistudio/claude-code-router) gateway (`127.0.0.1:3456`) → Zhipu API | Claude Code + CCR |

Direct-route configuration (this is what Zhipu's own installer script writes):

- `~/.claude/settings.json` → `env`: `ANTHROPIC_AUTH_TOKEN` (your key), `ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`, `API_TIMEOUT_MS=3000000`
- `~/.claude.json` → `hasCompletedOnboarding: true`

That endpoint requires an active plan. With an expired plan it answers `429 code 1309` — then use the CCR route instead (which is the route verified on the reference machine).

## Requirements

| Item | Requirement | Notes |
| --- | --- | --- |
| Operating system | Windows 10/11 (verified), macOS/Linux (expected, untested) | see the platform table below |
| Node.js | **≥ 22** including npm | the only real prerequisite; installed globally, no admin rights needed |
| Python | **not needed** | ignore tutorials that say `pip install -r requirements.txt`; CCR is a Node package |
| Network | reachable npm registry and `open.bigmodel.cn` | corporate proxies / firewalls will break it |
| GLM account | a valid API key with access or balance | an expired Coding Plan key returns `1309` |
| Disk | ~500 MB free | `claude.exe` alone is ~260 MB when installed natively |
| Agent | one that can run terminal commands | a chat-only window cannot install anything |
| Anthropic account | **not required** | the CLI runs with no `.credentials.json` present at all |

## Platform support

| Platform | Status |
| --- | --- |
| **Windows 10/11** | **Verified end to end** on the author's machine: Node 24.21.0, npm 11.19.0, Claude Code 2.1.296, CCR 3.1.3. |
| **macOS** | Expected to work. Every component is cross-platform and `scripts/ccr-configure.js` resolves the config path per platform, but **the author has not tested it**. Zhipu's own direct-connect script is bash, so on macOS the direct route is the native one. |
| **Linux** | Same as macOS: expected to work, untested. |
| **WSL** | Untested. Mixing Windows-side and WSL-side installs is a common source of confusing failures. |

If you run this on macOS or Linux, please open an issue with what happened.

## Install

### A. The prompt (nothing to install)

1. Open [`PROMPT.zh-CN.md`](PROMPT.zh-CN.md) and copy the whole block between the `---` markers.
2. Paste it into any agent that can run terminal commands.
3. Answer its questions (it will ask for your GLM API key).

### B. As a Codex skill

```bash
git clone https://github.com/juniad073428-star/claude-glm-relay-setup.git
```

Then put the folder where Codex looks for skills:

- Windows: `%USERPROFILE%\.codex\skills\` (note: `.codex` is a hidden folder)
- macOS / Linux: `~/.codex/skills/`

Codex picks it up on the next session. Then just say:

```
用 $claude-glm-relay-setup 帮我把本机 Claude Code 接到 GLM 上
```

### C. With the built-in skill-installer

If you already use Codex, you can ask it to install this skill straight from the repo:

```
从这个 GitHub 仓库安装 claude-glm-relay-setup 这个 skill
```

## What gets changed on your machine

| Path | What happens | Backup |
| --- | --- | --- |
| `%APPDATA%\claude-code-router\config.sqlite` (Windows) / `~/.claude-code-router/config.sqlite` | CCR's database: provider, API key, model list, profile model mapping, fallback chain | `scripts/ccr-configure.js` copies the database before writing and refuses to run while CCR is listening |
| `~/.claude/settings.json` | rewritten by CCR on every start (`ANTHROPIC_BASE_URL`, apiKeyHelper, model slots). Do not hand-edit it. | CCR keeps timestamped `.ccr-backup-*` copies |
| `~/.claude.json` | direct route only: `hasCompletedOnboarding` | back this up before editing |

Nothing else is touched. The skill explicitly tells the agent not to install unrelated global tools.

## Limitations — read before you rely on this

1. **Model names are account-dependent.** Query `GET {base_url}/models` with your key first; never hardcode the model list from here (the examples use `glm-5.3` / `glm-4.5` / `glm-5.3-flashx`).
2. **Flagship GLM models are text-only on `chat/completions`.** Sending an image returns `400 code 1210 messages.content.type 参数非法，取值范围 ['text']`, and because the image stays in the conversation history, *every later turn in that session fails too*. The skill configures a `model-chain` fallback so image turns are retried on a vision model. Vision-capable ids observed: `glm-4.5v`, `glm-4.6v`, `glm-4v-plus`, `glm-5.3-flash`, `glm-5.3-flashx`.
3. **The config script writes CCR's SQLite database.** It is verified against CCR 3.1.3. A future major version that changes the schema can break it; the fallback is to configure the same things through `ccr ui`.
4. **The gateway must be running.** If CCR stops, every `claude` call fails with `Connection refused (ECONNREFUSED)` — easy to misread as a model error. A watchdog that restarts CCR when port 3456 stops listening is a reasonable hardening step and is not included here.
5. **You need an agent.** The skill form requires Codex (any version that supports skills). The prompt form needs any agent with terminal access.
6. **It costs money.** GLM pay-as-you-go is billed to the account that owns the API key.
7. **Secrets are stored in plaintext.** Your GLM key ends up in CCR's config database and in `~/.claude/settings.json`. Never commit or share those files. This repo contains no keys.
8. **Anthropic's stance on routing Claude Code to non-Claude models is not verified here.** A third-party project claims Anthropic's documentation discourages it. We did not confirm this; check it yourself before commercial use.

## Verified versions

| Component | Version on the reference machine |
| --- | --- |
| Claude Code CLI | 2.1.296 |
| claude-code-router (CCR) | 3.1.3 |
| Node.js / npm | 24.21.0 / 11.19.0 |
| Zhipu endpoint | `https://open.bigmodel.cn/api/paas/v4` (pay-as-you-go, `openai_chat_completions`) |

## Troubleshooting

See [`references/troubleshooting.md`](references/troubleshooting.md) — an error-by-error table covering auth, plans, model capabilities, a dead gateway, and where every config file lives.

## Working on this repository

`tools/pre-commit-check.js` guards the repo. It blocks a commit that contains something looking like an API key, non-ASCII bytes inside a `.cmd`/`.bat`/`.ps1` file, a markdown link in `SKILL.md` that points nowhere, or invalid frontmatter. Install it once per clone:

```bash
node tools/pre-commit-check.js --install
```

You can also run it by hand at any time (`node tools/pre-commit-check.js`); it then checks every tracked file.

## Prior art

This is not the first project in this space. Before maintaining your own, consider:

- Zhipu's official `MetaGLM/glm-cc` — a one-line bash installer for the direct route.
- `mileson/glm-claude-auto-install`, `alchaincyf/glm-claude`, `claude.felix.garden` — one-click installers aimed at newcomers.
- `dedenLabs/claude-code-router-cli` — an enhanced fork of CCR v2 (do **not** install it alongside CCR v3; the two use different config stores).

The gap this repo fills: a Windows-first, agent-executable, idempotent, backup-taking, verifiable procedure — including the failure modes above, which the other projects mostly do not document.

## License

MIT — see [LICENSE](LICENSE).
