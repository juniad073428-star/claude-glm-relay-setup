# 可发送的部署提示词（复制下面全部内容发给对方）

> 用法：把下面 `---` 之间的整段内容发给对方，让他在 Codex（或任何能执行终端命令的智能体）里直接粘贴发送即可。

---

你现在作为本地部署运维助手，在这台电脑的终端里分步执行一整套部署流程。

**目标**：在本机安装开源 CCR（claude-code-router）作为中转网关，配置 GLM（智谱）模型作为上游，对接 Claude Code CLI，实现"本地 `claude` 命令 → 本机 CCR 网关 → 智谱 GLM API"的链路。**不需要 Anthropic 账号，不需要登录。**

**执行规则**

1. 严格按下面顺序执行，每一步做完先输出确认信息（做了什么、结果如何），再做下一步。
2. 任何一步报错就**立刻停止**，把完整原始报错贴出来并给出排查方案，不要跳过、不要假装成功、不要用别的方式蒙混过去。
3. 每条终端命令先把完整命令展示出来，再执行。这是 Windows 系统，命令用 cmd 或 PowerShell 语法，不要混用两种语法。
4. 只修改下面明确列出的两个位置（CCR 配置、Claude CLI 配置），**不要动用户其它全局配置**，不要顺手安装无关工具。
5. API Key 只写入本地配置文件，**不要回显、不要写进日志、不要外传**。执行前先问用户要 Key。

**重要前提（不要照搬网上把 CCR 说成 Python 项目的教程）**

- CCR 是 **Node 包**，包名 `@musistudio/claude-code-router`，用 `npm install -g` 安装。**没有 git clone、没有 requirements.txt、全程不需要 Python。**
- 让 Claude CLI 走 CCR 靠的是 CCR 的 profile 接管：CCR 启动时会把 `~/.claude/settings.json` 写成 `ANTHROPIC_BASE_URL=http://127.0.0.1:3456` 加一个 apiKeyHelper。**不要手改这个文件**，CCR 每次启动都会覆盖它。
- CCR 配置里（CCR 的 profile）模型字段必须写**裸模型名**（如 `glm-4.7`），不能写 `供应商,模型` 这种限定名，否则链路会失效。
- CCR 的配置是 SQLite（`%APPDATA%\claude-code-router\config.sqlite`），**不要在 CCR 运行时编辑**，必须先 `ccr stop`。
- 写 .cmd / .ps1 脚本时**只写 ASCII 字符**；命令串里也不要混中文，避免编码问题。

**先判断走哪条路（这一步别跳过）**

- 智谱有一个 Anthropic 兼容端点 `https://open.bigmodel.cn/api/anthropic`，Claude Code 可以**直接连它，不需要任何中转层**。但它要求**有效的 GLM Coding Plan 订阅**——套餐过期时它会返回 `429 code 1309 您的GLM Coding Plan套餐已到期`。
- **有有效套餐** → 走官方直连（省掉 CCR）：官方安装脚本实际做的就是三件事，Windows 上照做即可——在 `~/.claude/settings.json` 的 `env` 里写 `ANTHROPIC_AUTH_TOKEN`（用户的 key）、`ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`、`API_TIMEOUT_MS="3000000"`；在 `~/.claude.json` 里设 `hasCompletedOnboarding: true`；两个文件都先备份、按合并方式改，不要整个覆盖。
- **没有套餐**（按量付费）→ 走下面的 CCR 路线。

**整体流程**

1. **环境预检**：检查 `node -v`（需要 ≥ 22）、`npm -v`、`where claude`。缺 Node 就提示用户先安装 Node LTS（**不需要 Python**）。把版本号输出。
2. **安装 Claude Code CLI**：`npm install -g @anthropic-ai/claude-code`，然后 `claude --version` 确认可用。
3. **安装 CCR**：`npm install -g @musistudio/claude-code-router`，然后 `ccr --help` 确认可用。
4. **先让 CCR 生成配置**：`ccr start --daemon --no-open --gateway`，等网关端口起来，再 `ccr stop`。（配置库要先存在才能改。）
5. **确认这个 GLM Key 能用哪些模型**：向用户索要 GLM API Key（只接收输入），然后请求 `https://open.bigmodel.cn/api/paas/v4/models` 列出账号可用模型。注意：智谱 `chat/completions` 上旗舰型号通常是**纯文本**，带图片会被拒绝（报错码 1210）；支持图片的是带 `v` 或 `flash` 的型号。用一张图实测一次，确定视觉模型。
6. **写入供应商与模型映射**（此时 CCR 已停止）：
   `node <skill目录>/scripts/ccr-configure.js --api-key <KEY> --base-url https://open.bigmodel.cn/api/paas/v4 --main <主线模型> --small <小模型> --vision <视觉模型,视觉兜底>`
   例如 `--main glm-5.3 --small glm-4.5 --vision glm-5.3-flashx,glm-4.6v`。这个脚本会自动备份配置、会拒绝在 CCR 运行时写入、会打印改动摘要（Key 打码）。
   如果你手上没有这个脚本，就改用 `ccr ui` 打开管理界面，手动添加供应商（类型选 OpenAI 兼容的 chat completions）、填入 Key 和模型，并把 Claude Code profile 的默认/opus/sonnet/fable 槽位指向主线模型、haiku/小模型槽位指向小模型。
   **无论用哪种方式，改完都要确认模型字段是裸模型名。**
7. **启动服务**：`ccr start --daemon --no-open --gateway`，然后确认本机 `127.0.0.1:3456` 正在监听。
8. **端到端验证**：执行 `claude -p "reply with exactly: OK"`，必须返回 `OK` 才算成功。同时检查 `~/.claude/settings.json` 里的 `ANTHROPIC_BASE_URL` 指向 3456、`ANTHROPIC_MODEL` 是裸模型名。
9. **输出使用说明**：告诉用户——
   - 以后在 cmd 里直接敲 `claude` 就能对话；
   - `ccr stop` 停网关、`ccr start --daemon --no-open --gateway` 重新起；
   - 网关没起来时所有 `claude` 调用都会报 `Connection refused`，先检查端口；
   - 本次改了哪两个位置、备份文件在哪；
   - 会话里不要粘贴图片（除非选用支持图片的视觉模型），否则整段会话会持续报错、只能新开会话。

**附加（可选，做完主流程后询问用户是否需要）**：给 CCR 加一个"端口掉了就自动拉起"的看门狗，避免网关意外退出后所有 `claude` 调用失败。

现在开始，先做第 1 步环境预检。

---

## 更省事的替代方式（如果对方也装了 Codex）

把 `claude-glm-relay-setup` 这个 skill 文件夹（含 `SKILL.md`、`scripts/`、`references/`）一起发给对方，让他放到 `~/.codex/skills/` 下，然后只说一句：

```
用 $claude-glm-relay-setup 帮我把本机 Claude Code 接到 GLM 上
```
