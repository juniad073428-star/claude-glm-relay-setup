---
name: claude-glm-relay-setup
description: Deploy a local Claude Code CLI that runs on Zhipu GLM instead of an Anthropic account - either by pointing Claude Code straight at Zhipu's Anthropic-compatible endpoint, or, when there is no Coding Plan subscription, by relaying through the open-source CCR (claude-code-router) gateway. Use when someone wants Claude Code running locally against GLM or another domestic model provider.
metadata:
  short-description: Local Claude Code on GLM via CCR
---

# 本地 Claude Code + GLM 中转部署

目标：在本机装好 Claude Code CLI，让它用用户自己的智谱 GLM API Key 跑起来。**不需要 Anthropic 账号，不需要登录。**

有两条路线，先选对，别默认上 CCR：

| 情况 | 路线 |
| --- | --- |
| 用户有**有效的 GLM Coding Plan 订阅** | **官方直连**：Claude Code 直接连智谱的 Anthropic 兼容端点，不装 CCR，少一层 |
| 用户**没有订阅**（只想按量付费）、或要混用多家 provider、要按规则路由和失败自动降级 | **CCR 中转**：走下面的主流程 |

### 官方直连要写的东西

智谱官方安装脚本（`MetaGLM/glm-cc` 里那个 curl 下载的 bash 脚本）实际做的就是这三件事；脚本本身是 bash，Windows 上照着手写同样的结果即可：

1. 在 `~/.claude/settings.json` 的 `env` 里加三项：
   - `ANTHROPIC_AUTH_TOKEN`：用户的智谱 API Key
   - `ANTHROPIC_BASE_URL`：`https://open.bigmodel.cn/api/anthropic`
   - `API_TIMEOUT_MS`：`"3000000"`
2. 在 `~/.claude.json` 里设 `hasCompletedOnboarding: true`，跳过首次引导。
3. 两个文件都**先备份再改**（合并已有内容，别整个覆盖）。

这个端点**要求套餐有效**：实测套餐过期时返回 `429 code 1309 您的GLM Coding Plan套餐已到期`，此时直连走不通，改走 CCR 路线。上面三项配置来自官方脚本内容本身。

## 先纠正三件常见误传

网上（以及用户自己写的草稿）经常把这套流程写成"拉 Python 仓库 + pip 装依赖"。那是错的：

- **CCR 是 Node 包，不是 Python 项目。** 官方包名 `@musistudio/claude-code-router`，`npm install -g` 安装即可。没有 `git clone`、没有 `requirements.txt`、全程不需要 Python。
- **让 Claude CLI 走 CCR，不是手改环境变量。** CCR 的 profile 接管会在启动时把 `~/.claude/settings.json` 写成 `ANTHROPIC_BASE_URL=http://127.0.0.1:3456` 加一个 `apiKeyHelper`。手改这个文件没用，CCR 下次启动会覆盖。
- **不要改模型映射去改 settings.json。** 要改就改 CCR 自己的配置（见下），CCR 每次启动都会用配置重写 settings.json。

## 几个会让你白白踩坑的事实

- **profile 里的模型字段必须是"裸模型名"**（`glm-4.7`），不要写 `供应商,模型` 这种限定名。否则 CCR 写进 settings.json 的值不可用，重启后整条链路失效，而且报错很难懂。
- **智谱 `chat/completions` 上的旗舰模型是纯文本。** 带图片的请求会被上游拒绝：`400 code 1210 messages.content.type 参数非法，取值范围 ['text']`。更坑的是图片会留在会话历史里，导致该会话**之后每一轮都失败**。视觉要用 `glm-4.5v` / `glm-4.6v` / `glm-5.3-flash(x)`，并配 CCR 的 fallback 模型链自动降级。
- **先查这个 key 能用哪些模型**，别把型号写死。`GET {base_url}/models`（带 `Authorization: Bearer <key>`）会列出账号可用模型；旗舰纯文本、`-flash` 或 `V` 系列可能支持图片（用一张图实测一遍最稳）。
- **智谱有两个端点**：Coding Plan 专用 `https://open.bigmodel.cn/api/coding/paas/v4`，通用按量付费 `https://open.bigmodel.cn/api/paas/v4`。套餐过期时专用端点报 `1309 您的GLM Coding Plan套餐已到期`，此时切通用端点。
- **`.cmd` / `.ps1` 只写 ASCII。** Windows cmd 按 OEM 代码页读脚本，非 ASCII 注释可能吞掉换行把脚本写坏。同理，agent 执行命令时命令串里不要混中文。
- **CCR 的配置是 SQLite**（`%APPDATA%\claude-code-router\config.sqlite`，macOS/Linux 是 `~/.claude-code-router/config.sqlite`），README 明确要求**不要在有进程写入时直接编辑**，所以改配置前先 `ccr stop`。

## 流程

按顺序做，每步失败就把原始报错交给用户，不要跳过、不要假装成功。

1. **环境预检**：`node -v`（需 ≥ 22）、`npm -v`、`where claude`。缺 Node 就让用户先装 Node LTS。
2. **装 Claude Code CLI**：`npm install -g @anthropic-ai/claude-code`，确认 `claude --version`。
3. **装 CCR**：`npm install -g @musistudio/claude-code-router`，确认 `ccr --help`。
4. **先让 CCR 生成配置**：`ccr start --daemon --no-open --gateway`，等端口起来后 `ccr stop`。（配置库要存在才能改。）
5. **写入供应商和模型映射**：向用户要 GLM API Key——只写本地文件，**不要回显、不要外传**。然后运行：

   ```
   node scripts/ccr-configure.js --api-key <KEY> --base-url https://open.bigmodel.cn/api/paas/v4 --main <主线模型> --small <小模型> --vision <视觉模型,视觉兜底>
   ```

   例：`--main glm-5.3 --small glm-4.5 --vision glm-5.3-flashx,glm-4.6v`。
   脚本会自己备份、会拒绝在 CCR 仍运行时写入、会打印改动摘要（key 打码）。若 Node 22 报 `node:sqlite` 不可用，加 `--experimental-sqlite` 重跑。
   **如果脚本因为 CCR 版本变化跑不通**，退回 `ccr ui` 在管理界面里手动加供应商、模型并设置 profile 映射——不要自己猜数据库字段。
6. **起服务**：`ccr start --daemon --no-open --gateway`，确认 `127.0.0.1:3456` 在监听（`Get-NetTCPConnection -State Listen`）。
7. **端到端验证**：`claude -p "reply with exactly: OK"` 必须回 `OK`。顺手确认 `~/.claude/settings.json` 里的 `ANTHROPIC_MODEL` 是裸模型名、`ANTHROPIC_BASE_URL` 指向 3456。
8. **交代用法**：以后在 cmd 里直接敲 `claude` 就能用；`ccr stop` 停网关；`ccr start` 起来。

## 收尾要求

- 明确告诉用户改了哪两处，以及备份在哪：CCR 配置库、`~/.claude/settings.json`。
- 可选加固：CCR 网关一挂，所有 `claude` 调用都会报 `Connection refused (ECONNREFUSED)`。可以给用户加一个"端口掉了就自动 `ccr start`"的看门狗（开机自启 + 暂停文件）。
- **不要额外安装第三方 CCR 衍生版**（例如 `dedenLabs/claude-code-router-cli`）：它基于 CCR v2 的 `~/.claude-code-router/config.json`，和 v3 的 SQLite 配置不在一条线上，装上去只会互相打架。
- 不要顺手装无关的全局工具，不要动用户的其它配置。

## 参考

- 报错对照与排查：[references/troubleshooting.md](references/troubleshooting.md)
- 写配置的脚本：[scripts/ccr-configure.js](scripts/ccr-configure.js)（`--help` 列出全部参数）
- 同类现成方案（先看看有没有更合适的，别重复造）：官方 `MetaGLM/glm-cc`（直连 + 一键 bash 脚本）、`mileson/glm-claude-auto-install`、`alchaincyf/glm-claude`
