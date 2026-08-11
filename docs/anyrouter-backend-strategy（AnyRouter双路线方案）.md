# AnyRouter 后端兼容与分发策略

更新日期：2026-08-11

状态：双路由实现完成；AnyRouter-CC 已验证；AnyRouter-Pi 已通过单轮文本、多轮上下文、只读工具、取消、会话恢复、thinking replay 和缓存复用，仍按实验能力发布。图片能力因 AnyRouter 持续返回 429 尚未验证，当前保持关闭。

## 1. 结论

Pi 兼容方案在技术上可行，但属于非官方协议适配，不能直接替换官方 Claude Code CLI 路径。

建议保留两条互不干扰的路由：

- `AnyRouter-CC`：使用真实 Claude Code CLI，是默认且与 AnyRouter 公开说明一致的方案。
- `AnyRouter-Pi`：使用 Pi 后端和 AnyRouter 专用 wire adapter；实验属性通过说明文案表达，完成工具调用、多轮、thinking、图片、缓存、取消和恢复验证后再决定是否默认开放。

现有 `AgentRouter`、内置渠道和 `Generic Custom` 不改变路由和协议行为。

## 2. 实测结果

Claude Code 的本地 JSONL 历史只保存会话事件，不保存原始 HTTP header 和请求体。为获得线协议证据，本次使用只记录脱敏结构的本地转发器进行测试，未保存 API key、Authorization 值、用户正文或响应正文。

| 测试 | 结果 |
| --- | --- |
| 官方 Claude Code 到 AnyRouter | HTTP 200，完整 Anthropic SSE，约 39.15 秒完成 |
| 标准 Pi wire 形状经 Claude Code 协议转换后到 AnyRouter | HTTP 200，完整 Anthropic SSE，约 34.9 秒完成 |
| 原生标准 Pi 请求 | 与 Claude Code 请求存在明显协议差异，不能直接视为兼容 |
| 集成后的 AnyRouter-Pi 单轮文本 | 完整文本流和 complete，约 38.3 秒完成 |
| 集成后的 AnyRouter-Pi 两轮上下文 | 两轮均 complete，第二轮正确恢复前一轮测试码，约 73.3 秒完成 |
| 集成后的 AnyRouter-Pi 只读工具闭环 | Read 启动并成功返回，无工具错误，最终 complete，约 74.8 秒完成 |
| AnyRouter-Pi thinking replay | 首轮返回带签名 thinking block；将其作为 assistant 历史原样回放后，第二轮 HTTP 200、`message_stop` 正常，并返回新的签名 thinking block，第二轮约 65.9 秒 |
| AnyRouter-Pi 取消 | 收到 HTTP 200 的第一个 SSE chunk 后取消成功，约 2.6 秒结束；Pi 服务端执行 session abort |
| AnyRouter-Pi 会话恢复 | 新 Pi 子进程打开已有私有会话记录，恢复后的 SDK Session ID 与原记录一致，`ready=true`；该检查未发送新的 API 请求 |
| AnyRouter-Pi 缓存 | 相同上下文首轮创建 2,225 个缓存输入 token；第二轮读取 2,225 个缓存输入 token，两轮均 HTTP 200 且 `message_stop` 正常 |
| AnyRouter-Pi 图片 | 三次最小图片请求均在约 2.3–3.3 秒收到 HTTP 429，SSE 未开始；属于上游限流阻塞，不能判定兼容成功或失败，当前不开放图片入口 |

单轮纯文本已经证明以下链路可行：

`MkAgent -> Pi 后端 -> AnyRouter 专用协议适配器 -> AnyRouter`

当前结果证明文本、多轮、一个只读工具闭环、取消、会话恢复、thinking replay 和缓存复用在当前版本、当前时点可用，但不代表 AnyRouter 对 Pi 的正式支持。图片仍被上游限流阻塞；复杂工具链仍需继续验证。

## 3. 真实 Claude Code 请求结构

成功的 Claude Code 主请求包含：

- `POST /v1/messages?beta=true`
- `Authorization: Bearer ...`，不使用 `x-api-key`
- `user-agent: claude-cli/2.1.227 (external, sdk-cli)`
- `x-app: cli`
- `x-claude-code-session-id`
- Claude Code 专用 `anthropic-beta`
- `metadata.user_id`
- 3 个 Claude Code 或 Agent SDK system 块
- Claude Code 工具定义
- `thinking` 和 `output_config`
- 标准 Anthropic SSE 响应

标准 Pi 请求通常包含：

- `x-api-key`
- Anthropic JavaScript SDK User-Agent
- Pi system prompt
- Pi 工具名称和 schema
- 不包含 Claude Code session metadata

因此适配不是简单修改 User-Agent，而是需要同步转换鉴权、query、headers、metadata、system、messages、tools 和部分 SSE 语义。

## 4. AnyRouter-Pi 风险

### 4.1 官方支持边界

AnyRouter 公开说明要求安装官方 Claude Code，并配置：

- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL=https://anyrouter.top`

公开文档没有发布稳定的 Pi provider 协议，也没有公开服务端字段级验证规则。

参考：

- https://docs.anyrouter.top/
- https://github.com/xifan2333/pi-anyrouter
- https://github.com/phy-zhangzl/pi-anyrouter-cc

后两个项目均为非官方实现，只能作为协议研究样本。

### 4.2 维护风险

- Claude Code 版本、beta 字段、system 内容和工具清单可能变化。
- AnyRouter 可以调整未公开的客户端验证规则。
- 文本、多轮、Read 工具、thinking replay、取消、会话恢复和缓存复用已验证；图片受上游限流阻塞，复杂工具链仍需验证。
- 不能通过一次 HTTP 200 推导长期兼容性。

### 4.3 隔离要求

- AnyRouter-Pi 必须使用独立 `platformProfile`。
- 协议重写只能在 AnyRouter-Pi 路由启用。
- 不允许依据域名自动影响 Generic Custom。
- 不允许修改 AgentRouter、其他 Pi provider 或内置渠道的默认请求。
- 连接测试与真实会话必须复用同一 adapter，避免测试成功但运行失败。

### 4.4 完整 Pi 请求的限流修复

初次完整 Pi 会话出现流内 rate limit，而最小 wire 探针可以成功。脱敏本地结构探针确认：

- 原始完整请求约 124 KB；
- system prompt 约 99,503 字符；
- MkAgent 指令约 30,027 字符，其余主要来自 Pi 默认身份提示；
- AnyRouter-Pi wire 又会添加 Claude Code 身份块，造成 Pi 身份与 Claude Code 身份重复。

修复后，仅 `anyrouter_pi` 使用 MkAgent system prompt 加版本化 Claude Code wire，不再重复附加 Pi 默认身份。AgentRouter、Generic Custom 和其他 Pi provider 保持原有 prompt 策略。完整文本、多轮和 Read 工具测试随后通过。

连接测试也由只检查 HTTP 200 改为必须消费 Anthropic SSE 并看到 `message_stop`；200 响应中的 `error` 或 `rate_limit` 不再被误判为成功。

## 5. Claude Code CLI 路径问题与已实现修复

调研时的 Claude CLI resolver 只支持：

1. 宿主显式传入且存在的绝对路径；
2. Windows 开发模式下固定的 npm 全局目录：

   `C:\Users\<用户>\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`

3. 项目本地 `node_modules/@anthropic-ai/claude-code/bin`。

调研时不支持：

- `where claude`、`which claude` 或系统 PATH；
- 自定义 npm prefix；
- pnpm、Bun、Volta 全局安装；
- standalone Claude Code；
- macOS/Linux 全局安装；
- 设置页手动浏览选择；
- 路径持久化。

当前实现已经补齐：

- 用户保存路径、宿主路径、常见安装目录、PATH 和项目本地依赖的分层发现；
- npm prefix、pnpm、Bun、Volta、Scoop 和常见 standalone 路径；
- `claude.exe --version` 超时验证；
- 设置页自动检查、重新检测、浏览选择、路径持久化和恢复自动检测；
- Electron host runtime 与会话运行时注入已验证路径；
- Windows 只接受真实 `claude.exe`，拒绝 `.cmd` 和 `.bat`，避免通过 `cmd.exe` 二次解析提示词参数。

本机最终验收中，未保存手动路径时，resolver 通过 `common-install` 自动发现：

`C:\Users\Qiang\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`

并通过 `claude.exe --version` 验证为 Claude Code 2.1.227。因此当前电脑无需手动填写路径。手动浏览仍作为兜底，用于自定义安装目录、便携版目录或未来尚未覆盖的新安装器布局。

## 5.1 版本升级与稳定性

- `AnyRouter-CC` 依赖用户本机的 Claude Code CLI。MkAgent 会检测、验证和调用 `claude.exe`，但不会替用户自动升级 Claude Code。用户升级 CLI 后，只要命令行参数和 `stream-json` 输出仍兼容，MkAgent 通常无需修改配置。
- `AnyRouter-Pi` 不依赖本机 Claude Code，但当前 wire 明确固定为 Claude Code 2.1.227 的请求形状。它不会随着用户升级 Claude Code 自动变化；只有 MkAgent 更新 adapter 并重新发布后才会变化。
- 因为 AnyRouter 的公开说明以官方 Claude Code 为支持路径，`AnyRouter-CC` 应继续作为默认稳定入口；`AnyRouter-Pi` 的本机依赖更轻，但对 AnyRouter 未公开识别规则的维护风险更高。
- 每次升级 Pi wire 时，应以同一连接分别执行 CC 与 Pi 的结构化对照测试，再更新 wire 版本；不能只根据 Claude Code 版本号猜测 header、beta、system 或工具清单。

## 6. 推荐实现

### 6.1 AnyRouter-CC

作为默认方案，补齐：

- 自动检测 PATH、npm、pnpm、Bun、Volta 和常见安装目录；
- 设置页显示检测路径和版本；
- 浏览选择、重新检测和安装说明；
- 持久化显式路径；
- 使用 `claude --version` 做有超时的可执行性验证；
- 首次连接测试和已有连接测试都检查 CLI 与真实短请求；
- 打包版把已验证路径传入 backend runtime。

建议检测顺序：

1. 用户保存的显式路径；
2. 明确的环境变量路径；
3. 应用打包资源，如果未来决定合法分发；
4. npm、pnpm、Bun、Volta 常见目录；
5. PATH 的 `where.exe` 或 `which -a`；
6. 项目本地依赖。

Windows 的 `.cmd` shim 不能在 `shell: false` 下假定可直接执行，必须解析到真实 binary，或使用受控 launcher。

### 6.2 AnyRouter-Pi

作为独立实验方案：

- 新增独立 profile，例如 `anyrouter_pi`；
- 显示名称为 `AnyRouter-Pi`，实验属性放在说明文案中；
- 固定 `https://anyrouter.top` 和 Anthropic Messages；
- 通过专用 wire adapter 转换鉴权、headers、metadata、system、tools 和消息结构；
- 版本化 Claude Code wire contract；
- adapter 失败时给出明确错误，不静默回退到其他 provider；
- 已完成文本、多轮、Read 工具、thinking replay、取消、恢复和缓存复用验证；图片继续保持未验证状态，不因此扩大默认能力声明。

## 7. 验收标准

### AnyRouter-CC

- 开发版和打包版都能发现常见安装方式。
- 用户可以手动选择 Claude Code executable。
- 设置页显示路径、版本和验证状态。
- 无 CLI 时提供可操作的安装或浏览提示。
- 连接测试与真实聊天使用同一 executable 和同一连接凭据。

### AnyRouter-Pi

- 单轮纯文本返回完整 SSE。已通过。
- 至少一个无副作用工具调用闭环成功。Read 已通过。
- 多轮上下文保持正确。已通过。
- thinking 与 tool result replay 正确。thinking replay 已通过。
- 取消和 session 恢复已通过。
- 缓存创建与缓存读取已通过。
- 图片因上游持续返回 429 尚未验证，当前连接保持 text-only，不向用户宣称支持图片。
- 超时行为明确，错误不能被 HTTP 200 或不完整 SSE 掩盖。
- 不改变 AgentRouter、Generic Custom 和其他 provider 的请求快照。

## 8. 发布建议

- 第一阶段：发布 AnyRouter-CC 的路径检测与手动配置能力。
- 第二阶段：在开发模式或显式实验开关下提供 AnyRouter-Pi。
- 第三阶段：完成协议矩阵和稳定性测试，并取得服务方兼容确认后，再决定是否面向普通用户默认显示。
