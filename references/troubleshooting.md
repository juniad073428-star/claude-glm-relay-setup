# 报错对照与排查

这些都是真实踩过的，按现象查。

## 安装 / 启动

| 现象 | 原因与处理 |
| --- | --- |
| `ccr: command not found` | npm 全局 bin 目录不在 PATH。`npm prefix -g` 看路径，把它加进 PATH，或重开一个终端。 |
| `ccr start` 报端口被占 | 管理台默认 3458、网关 3456。用 `ccr start` 打印出的实际 URL，或先 `ccr stop` 再起。 |
| 前台 `ccr serve` 里一堆红字 | 只是运行日志。判断是否正常看端口有没有在监听。 |
| `node:sqlite is unavailable` | Node 22 需要 `--experimental-sqlite`；Node 23.4+ / 24 默认可用。 |

## 认证 / 供应商

| 现象 | 原因与处理 |
| --- | --- |
| `401 Invalid or expired API key` | 这是 **CCR 自己的客户端密钥**缺失或过期，不是 GLM 的 key。CCR 会给 Claude Code 生成一个 `apiKeyHelper`，指向 `%APPDATA%\claude-code-router\bin\ccr-claude-code-api-key-*.cmd`。 |
| `1309 您的GLM Coding Plan套餐已到期` | 用了 Coding 专用端点但套餐过期。换 `https://open.bigmodel.cn/api/paas/v4`（通用按量付费）。 |
| 直连 `https://open.bigmodel.cn/api/anthropic/v1/messages` 返回 `429 code 1309` | 智谱的 Anthropic 兼容端点（Claude Code 直连用、不需要 CCR）要求有效 Coding Plan 订阅。套餐过期就只能走 CCR + 通用端点。 |
| `1211 模型不存在，请检查模型代码` | 模型名写错。先 `GET {base_url}/models` 拉账号可用列表。 |
| `gateway plugin "ccr-public-auth-context" beforeAuth failed` | 同上 401，客户端密钥不对。 |

## 模型能力

| 现象 | 原因与处理 |
| --- | --- |
| `400 code 1210 messages.content.type 参数非法，取值范围 ['text']` | 该模型只吃纯文本，请求里带了图片。智谱旗舰型号（glm-4.7 / glm-5.3 等）在 `chat/completions` 上都是纯文本。 |
| 带图那一轮失败后，**整个会话**每轮都失败 | 图片留在会话历史里，每次都会重发。必须新开会话，并改用视觉模型。 |
| 视觉模型 | 实测可用：`glm-4.5v`、`glm-4.6v`、`glm-4v-plus`、`glm-5.3-flash`、`glm-5.3-flashx`。配 CCR 的 `Router.fallback`（`mode: model-chain`）让网关在旗舰被拒时自动改走视觉模型——纯文本轮次不受影响。 |
| `[claude-code:unrecognized_model] {"model":"glm-..."}` | 只是 CCR 的提示行，不影响结果。 |

## 链路断掉

| 现象 | 原因与处理 |
| --- | --- |
| `API Error: Connection refused (ECONNREFUSED)` | **CCR 网关没在跑**。`ccr start --daemon --no-open --gateway`，然后确认 3456 在监听。这个失败最容易误判成"模型报错"。 |
| 重启后模型变成旧型号 / 链路失效 | profile 里被写进了 `供应商,模型` 限定名。必须改回裸模型名（`glm-4.7`），再 `ccr stop && ccr start`。 |
| `~/.claude/settings.json` 里出现 `unrecognized` 或模型值带斜杠 | 同上，profile 模型字段格式不对。 |
| 明明改了 settings.json，重启又变回去 | CCR 每次启动都会重写这个文件。要改映射就改 CCR 配置。 |

## 配置文件位置

| 内容 | Windows | macOS / Linux |
| --- | --- | --- |
| CCR 配置库（SQLite，含供应商/密钥/模型映射） | `%APPDATA%\claude-code-router\config.sqlite` | `~/.claude-code-router/config.sqlite` |
| 客户端密钥 / profile 启动器 | `%APPDATA%\claude-code-router\bin\` | 同上目录 |
| Claude CLI 设置（由 CCR 接管） | `%USERPROFILE%\.claude\settings.json` | `~/.claude/settings.json` |
| Claude CLI 会话记录（模型标签来自这里） | `%USERPROFILE%\.claude\projects\` | `~/.claude/projects/` |

**原则：改配置前先 `ccr stop`，改完备份，再 `ccr start`。** 不要在 CCR 运行时编辑配置库。

## 验证清单

1. `Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3456,3458 }` 两个端口都在。
2. `claude -p "reply with exactly: OK"` 回 `OK`。
3. `~/.claude/settings.json`：`ANTHROPIC_BASE_URL` 指向 3456，`ANTHROPIC_MODEL` 是裸模型名。
4. 想看真实模型：`claude -p` 的输出里带 model，或看会话记录文件。
