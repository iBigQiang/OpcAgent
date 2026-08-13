# Craft v0.11.4 四域恢复决策记录

## 决策状态

本记录是 OPC Agent 在产品基线 `a148f98d9d713814f9424cefdc8eb2d606eaa60b` 之上恢复四个产品域的新版决策。历史 Lite 文档继续作为当时裁剪范围的记录，不原地改写其审批结论。

目标分支为 `craft-sources-auto`，独立工作目录为 `D:\AiCode\OPCAgent`。

## 固定来源

- OPC Agent 产品基线：`a148f98d9d713814f9424cefdc8eb2d606eaa60b`
- Craft 固定来源：`v0.11.4` 对应提交对象 `50ffa143ab76e44c0e96ea785d03aa67cf942c50`
- 许可证：Apache-2.0；保留仓库中的 `LICENSE`、`NOTICE` 和来源归属
- 品牌边界：产品继续使用 OPC Agent 名称、图标、bundle id 和更新地址，不复制 Craft 商标资产

当前本地仓库可验证固定提交对象、提交主题、版本字段、LICENSE、NOTICE 和源文件树，但没有本地 `refs/tags/v0.11.4`。因此来源证据严格表述为“固定 commit object 已验证”，不声称已验证远端 tag 签名或 release asset。

## 恢复范围

### Projects

项目 CRUD、列表与详情、session 绑定与解绑、working directory、项目 `MEMORY.md` 上下文和资产管理。项目资产必须限制在项目目录内；删除项目必须清除 session 引用。完整 Kanban、Tasks Conductor、远程 workspace、Viewer 和公开分享不在本轮范围。

### Labels

树形 CRUD、顺序与层级、值化标签、session 增删与筛选、自动规则、删除清理和设置页。读取路径保持纯读取；初始化和 migration 必须显式执行；损坏配置安全失败。

### Automations

定时任务、应用事件触发、Agent 事件触发，覆盖启停、复制、删除、测试、history、replay、prompt action、受限 webhook、调度、幂等和有界重试。

侧栏保持 Craft v0.11.4 的信息架构：父项“自动化”下依次显示“定时任务、事件触发、智能体”，分别进入 `automations/scheduled`、`automations/event`、`automations/agentic`，并使用真实类别过滤、计数和选中态。

Pi 不等价于 Claude-only hook 的事件保持明确边界，不伪装为兼容。

### Messaging

仅恢复 Telegram、WhatsApp、Lark / 飞书。保留 workspace 隔离、owner、allow-list、pending sender、binding、pairing、credential provider、生命周期、设置页和 WhatsApp worker。未授权消息只进入有界 pending sender 队列，不保存消息正文或凭据。

没有真实平台凭据时只报告 mock 与离线验证。Telegram、WhatsApp、Lark / 飞书真实收发仍属于缺少外部 Provider 证据，不得声称连接成功。

## 共享安全适配

- Projects、Labels、Automations RPC 保留兼容参数，但服务端强制请求 workspace 与已认证 RPC context 一致。
- Messaging RPC 只使用已认证连接的 workspace context，不接受调用方提供的 workspace 越权。
- session 持久化冲突签名包含 `projectId` 与 `labels`，防止外部解绑或删除清理被旧 header 覆盖。
- webhook 默认拒绝非 HTTP(S)、userinfo、回环、私网、link-local、metadata 地址和危险重定向；结果与历史只保留安全 origin，不保留路径、查询、片段或 userinfo。
- Messaging credential 不进入 renderer、session JSONL、事件、日志或非安全配置文件。

## 来源与适配清单

逐文件范围、固定 SHA、必需当前文件、测试锚点和 OPC Agent 集成理由记录在 `scripts/craft-restored-sources.json`。该清单由 `scripts/audit-craft-reuse.ts` 强制校验，任何新增或修改文件缺少来源或适配理由时验收失败。

## 验证边界

离线验收使用临时目录、fake clock、mock HTTP、mock adapter、假凭据和 secret canary。完整命令矩阵、Windows Electron 截图、原始结果摘要和剩余风险在本轮最终交付中报告。
