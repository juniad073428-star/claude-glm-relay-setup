# claude-glm-relay-setup

让你自己的 **智谱 GLM API Key** 驱动 **Claude Code** —— 不需要 Anthropic 账号，不需要订阅。

[English →](README.md)

本仓库提供同一套流程的两种形态，内容同源：

| 形态 | 适合谁 |
| --- | --- |
| **一段提示词** —— [`PROMPT.zh-CN.md`](PROMPT.zh-CN.md) | 任何人。复制粘贴给任何能执行终端命令的智能体即可，无需安装任何东西 |
| **一个 Codex skill** —— [`SKILL.md`](SKILL.md) + [`scripts/`](scripts/) + [`references/`](references/) | 已经在用 Codex 的人。Codex 自动发现它，按流程执行，并调用一个确定性脚本来写配置，而不是靠模型临场发挥 |

## 适用范围（先看这段）

**适用**

- 还没装 Claude Code 的机器 → 装上并配好
- 装了 Claude Code 但用不了的机器（没有 Anthropic 账号/订阅）→ 接到 GLM 上
- 想按量付费、想把多家模型放在同一个本地网关后面的人

**不适用**

- 本来就有可用 Anthropic 订阅的人 —— 你不需要这个
- 多租户/托管服务部署 —— 这是**单机本地**方案
- 任何试图掩盖"请求其实发给了智谱而不是 Anthropic"的用法

## 两条路线 —— 动手前先选一条

| 你的情况 | 路线 | 需要装什么 |
| --- | --- | --- |
| 有**有效的 GLM Coding Plan 订阅** | **直连**：Claude Code 直接连智谱的 Anthropic 兼容端点 | 只装 Claude Code |
| **没有订阅**（按量付费），或需要多 provider 混用、按规则路由、失败自动降级 | **CCR 中转**：Claude Code → 本地 [claude-code-router](https://github.com/musistudio/claude-code-router) 网关（`127.0.0.1:3456`）→ 智谱 API | Claude Code + CCR |

直连要写的东西（来自智谱官方安装脚本的实际内容）：

- `~/.claude/settings.json` 的 `env`：`ANTHROPIC_AUTH_TOKEN`（你的 key）、`ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`、`API_TIMEOUT_MS=3000000`
- `~/.claude.json` 里设 `hasCompletedOnboarding: true`

这个端点**要求套餐有效**，套餐过期会返回 `429 code 1309`；那种情况请走 CCR 路线（也就是本仓库在参考机器上实测通过的那条）。

## 前提条件

| 项 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | Windows 10/11（已实测）；macOS / Linux（预期可用，未实测） | 见下方平台表 |
| Node.js | **≥ 22**（含 npm） | 唯一真正的基础依赖，全局安装不需要管理员权限 |
| Python | **不需要** | 看到"pip install -r requirements.txt"的教程可以直接关掉，CCR 是 Node 包 |
| 网络 | 能访问 npm registry 和 `open.bigmodel.cn` | 公司防火墙/代理环境会失败 |
| 智谱账号 | 一个有效、有权限或余额的 API Key | 套餐过期的 key 会报 `1309` |
| 磁盘 | 约 500MB | 原生安装的 `claude.exe` 本体就有 ~260MB |
| 执行方 | 能跑终端命令的智能体 | 纯聊天窗口装不了任何东西 |
| Anthropic 账号 | **不需要** | 磁盘上完全没有 `.credentials.json` 也能正常跑 |

## 平台支持

| 平台 | 状态 |
| --- | --- |
| **Windows 10/11** | **已端到端实测**：Node 24.21.0、npm 11.19.0、Claude Code 2.1.296、CCR 3.1.3 |
| **macOS** | 预期可用：所有组件都是跨平台的，`scripts/ccr-configure.js` 也按平台解析配置路径——但**作者没有实测过**。智谱官方的直连脚本本身就是 bash，所以在 macOS 上直连路线反而更原生 |
| **Linux** | 同 macOS：预期可用，未实测 |
| **WSL** | 未测试。Windows 侧和 WSL 侧混装是常见的故障来源 |

如果你在 macOS / Linux 上跑了，欢迎开 issue 反馈结果。

## 安装方式

### A. 只用提示词（零安装）

1. 打开 [`PROMPT.zh-CN.md`](PROMPT.zh-CN.md)，复制两条 `---` 之间的全部内容
2. 粘贴给任何能执行终端命令的智能体
3. 按它的提示回答（它会要你的 GLM API Key）

### B. 作为 Codex skill 安装

```bash
git clone https://github.com/<owner>/claude-glm-relay-setup.git
```

然后把整个文件夹放到 Codex 的 skills 目录：

- Windows：`%USERPROFILE%\.codex\skills\`（注意 `.codex` 是**隐藏文件夹**）
- macOS / Linux：`~/.codex/skills/`

下次开 Codex 就会自动发现它。然后说一句：

```
用 $claude-glm-relay-setup 帮我把本机 Claude Code 接到 GLM 上
```

### C. 用内置的 skill-installer 安装

已经在用 Codex 的话，可以直接让它从仓库装：

```
从这个 GitHub 仓库安装 claude-glm-relay-setup 这个 skill
```

## 它会改你机器上的什么

| 路径 | 会发生什么 | 备份情况 |
| --- | --- | --- |
| `%APPDATA%\claude-code-router\config.sqlite`（Windows）/ `~/.claude-code-router/config.sqlite` | CCR 的配置库：供应商、API Key、模型列表、profile 模型映射、降级链 | 脚本写入前会自动备份；CCR 正在监听端口时**拒绝执行** |
| `~/.claude/settings.json` | 由 CCR 每次启动时重写（`ANTHROPIC_BASE_URL`、apiKeyHelper、模型槽位）。**不要手改** | CCR 会留带时间戳的 `.ccr-backup-*` 副本 |
| `~/.claude.json` | 仅直连路线：`hasCompletedOnboarding` | 改前请自行备份 |

除此之外不动任何东西。skill 里明确要求智能体不要顺手安装无关的全局工具。

## 限制（请务看完再依赖它）

1. **模型名跟账号有关。** 先用自己的 key 请求 `GET {base_url}/models` 拿可用列表，别照抄本仓库示例里的 `glm-5.3` / `glm-4.5` / `glm-5.3-flashx`。
2. **智谱旗舰模型在 `chat/completions` 上是纯文本。** 带图片会返回 `400 code 1210 messages.content.type 参数非法，取值范围 ['text']`；更麻烦的是图片会留在会话历史里，导致**该会话之后每一轮都失败**。skill 里配了 `model-chain` 降级链，带图那一轮会自动改用视觉模型。实测可读图的 id：`glm-4.5v`、`glm-4.6v`、`glm-4v-plus`、`glm-5.3-flash`、`glm-5.3-flashx`。
3. **配置脚本直接写 CCR 的 SQLite 配置库。** 实测版本 CCR 3.1.3。将来大版本改了数据库结构就可能失效——退路是用 `ccr ui` 手动配同样几项。
4. **网关必须活着。** CCR 一停，所有 `claude` 调用都会报 `Connection refused (ECONNREFUSED)`，很容易被误判成模型报错。用看门狗在 3456 端口掉线时自动拉起是合理的加固手段，但本仓库没有包含。
5. **你需要一个智能体。** skill 形态需要 Codex；提示词形态需要任何有终端能力的 agent。
6. **会产生费用。** GLM 按量付费记在 API Key 所属账号上。
7. **密钥是明文存储的。** 你的 GLM key 会落在 CCR 配置库和 `~/.claude/settings.json` 里。**永远不要**把这些文件提交或分享出去；本仓库不含任何密钥。
8. **"Anthropic 是否允许把 Claude Code 路由到非 Claude 模型"我们未核实。** 有第三方项目称 Anthropic 文档不鼓励这么做。商用前请自行确认。

## 实测版本

| 组件 | 参考机器上的版本 |
| --- | --- |
| Claude Code CLI | 2.1.296 |
| claude-code-router (CCR) | 3.1.3 |
| Node.js / npm | 24.21.0 / 11.19.0 |
| 智谱端点 | `https://open.bigmodel.cn/api/paas/v4`（按量付费，`openai_chat_completions`） |

## 排查

见 [`references/troubleshooting.md`](references/troubleshooting.md)——按现象查的报错对照表，覆盖认证、套餐、模型能力、网关挂掉，以及每个配置文件的位置。

## 同类项目

这不是这个领域里的第一个项目。在决定自己维护之前，可以先看：

- 智谱官方 `MetaGLM/glm-cc` —— 直连路线的一行 bash 安装脚本
- `mileson/glm-claude-auto-install`、`alchaincyf/glm-claude`、`claude.felix.garden` —— 面向新手的图形化/一键安装器
- `dedenLabs/claude-code-router-cli` —— 基于 CCR v2 的增强分支（**不要**和 CCR v3 同时装，两者用的配置存储不同）

本仓库补的那块空白是：Windows 优先、能被智能体执行、幂等、自动备份、可验证，并且把上面那些坑写进了文档——其他项目基本没写。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
