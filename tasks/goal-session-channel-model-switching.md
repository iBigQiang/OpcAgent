# Goal：会话内切换 AI 渠道与模型，并完整接续上下文

日期：2026-09-28

项目：`D:\AiCode\OPCAgent`

阶段：第一阶段实现 Pi 渠道之间切换；第二阶段单独设计 Pi 与 Claude CLI 的历史迁移。

## 推荐执行版（中文，可直接复制）

```text
/goal 在 D:\AiCode\OPCAgent 中实现新建会话和已有会话在不同 Pi 渠道、不同模型之间灵活选择与切换。切换后继续使用原会话身份、完整可恢复的 SDK 上下文、历史工具结果和已启用工具能力，能够沿着原对话继续执行任务。只优化会话链路，不修改自动化定时任务的定义、调度策略或已保存的渠道模型绑定。本阶段不实现 Pi 与 Claude CLI 跨引擎历史迁移。
验证：先读取本任务文档、项目约定及 package.json 中真实存在的命令；使用隔离 CONFIG_DIR 运行相关 Bun 测试和本地模拟端点集成验证，检查 A→B→A、同名模型不同地址和凭据、历史工具结果、分支会话、切换失败、重启恢复及删除原渠道后续聊；验证明确保存 A/M1 的定时任务不受会话切到 B/M2 或全局默认变更影响；运行 bun run validate:ci 与涉及 renderer 的 bun run lint，并记录每条命令的实际结果；文档通过 qiaomu-goal-meta-skill 的 lint_goal_command.py 检查。
约束：首阶段只开放同一 Pi 引擎的会话切换；不修改自动化配置与调度逻辑，不把聊天选择回写定时任务，不改变全局或工作区默认值；不清空或仅以最后若干条文本替代原历史，不重复执行历史工具，不提升权限、不自动启用 Sources；渠道和模型作为一个完整选择提交，忙碌状态不切换，失败不静默回退其他渠道；保持现有中文体验、双语文案键与 Electron/WebUI 行为一致。
边界：只修改本任务直接涉及的会话选择器、会话状态与事件、SessionManager、Pi 初始化和历史恢复、必要的协议与持久化字段、关联测试和本 Goal 文档；仅在相关受管文件发生变化时精准更新 Craft 审计清单。禁止改动真实用户配置、automations.json、凭据库、依赖锁文件、发布版本、安装包、无关模块及已有未提交修改；不修改 node_modules，不执行发布、提交、推送或批量删除。
迭代策略：先锁定源码事实与受影响接口，再并行分工为前端、会话后端、Pi 历史兼容三个有明确文件所有权的子任务；每完成一个完整链路运行最小相关验证，由母 Agent 审查接口一致性和失败路径。每个问题最多连续尝试两次同一修复思路，之后必须读取新日志、增加最小复现或换证据来源；先实现、再做至多三轮聚焦审查，不以重复执行同一失败命令替代诊断。
完成条件：本文件验收矩阵中的第一阶段必需项有可复核证据；切换后的本地模拟请求确实发往新渠道并携带正确上下文和工具定义，旧渠道凭据未被发送到新地址；保存及重启后一致；相关检查通过，或既有失败经对照明确证明与本次修改无关；最终列出改动文件、验证结果、真实外部服务尚未覆盖的范围，以及第二阶段边界。不能仅凭 UI 可以选择或单元测试通过宣称完整完成。
暂停条件：只在完成仍可独立推进的本地工作后，遇到必须增加费用、访问真实服务凭据、修改生产或真实用户数据、破坏性迁移、变更自动化语义、开放跨 Pi/Claude CLI 迁移，或连续三轮有证据的改进仍无法解决同一阻塞时，说明具体阻塞与已完成部分并请求决定；不得因普通代码选择、可逆修改或已授权的本地测试重复索要确认。
```

默认选择理由：连接切换沿用现有运行实例重建和 Pi 会话恢复能力，可以控制改动范围，同时避免遗漏凭据、工具、模型能力及分支历史；自动化配置保持独立。

## 一、用户期望与本轮边界

用户可以在发送第一条消息前选择渠道和模型，也可以在同一会话的两轮消息之间更换任意可用 Pi 渠道与模型。切换后发送“接着刚才的任务做”，模型应拿到已有对话、当前分支及压缩上下文、已经完成的工具结果，以及继续任务所需的当前有效工具。

“继续原会话”必须同时满足模型上下文连续与界面记录连续，不能只有聊天界面留着历史而模型拿到空上下文。

第一阶段包含：

1. 普通 Pi 原生提供商、兼容 API 渠道、本地 Ollama，以及实际由 Pi 执行的品牌渠道之间切换。
2. 同一渠道换模型与不同渠道换模型使用一致的可靠提交入口。
3. 已存在历史的会话、从历史分叉产生的会话、重启后恢复的会话。
4. 原渠道被删除后，确认原会话为 Pi 引擎时改用其他有效 Pi 渠道续聊。
5. 配置级失败、并发发送、重复点击、多窗口同步和历史兼容验证。

第二阶段另立目标：Pi 与 Claude CLI 之间迁移上下文。当前实际代码中 `platformProfile === 'anyrouter'` 使用 Claude CLI；`anyrouter_pi` 仍使用 Pi。判断应以 backend factory 的真实映射为准，不能只看渠道名称、模型名称，或仅凭 `providerType === 'pi_compat'` 判断。

本轮不增加自动选路、失败自动换渠道、模型排行榜、任务重新调度、计费系统、后台迁移工具或新的依赖。

## 二、已经核实的根因

| 层次 | 当前源码位置 | 已核实的行为 |
| --- | --- | --- |
| 渠道选择器 | `apps/electron/src/renderer/components/app-shell/input/picker-mode.ts` | 只有空会话且多个渠道时才展示渠道列表 |
| 空会话判断 | `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | 用消息数量决定是否允许展示其他渠道 |
| 后端锁定 | `packages/server-core/src/sessions/SessionManager.ts` | 首次发消息设置 connectionLocked，setSessionConnection 拒绝已锁会话 |
| 更新接口不一致 | 同文件 updateSessionModel | 可选 connection 可以绕过锁，却先把新模型发给旧 agent，并只广播模型变更 |
| 前端双调用 | FreeFormInput、CompactModelSelector、ChatPage | 渠道更新与模型更新分别发起，不能保证完整成功 |
| 运行时重建 | `packages/server-core/src/sessions/runtime-config.ts` | slug、provider、认证类型等变化已会触发运行实例重建 |
| Pi 历史恢复 | `packages/pi-agent-server/src/index.ts` | 通过会话目录下的 .pi-sessions 恢复 SDK 历史，但分支重建路径需要专门验证 |
| 同名模型历史 | `packages/pi-agent-server/src/custom-endpoint-provider.ts` 及本地 Pi SDK | 多个自定义渠道共用 provider 身份，SDK 单靠 provider/api/model 无法区分不同渠道 |
| 默认值 | `packages/shared/src/config/llm-connections.ts` | 会话显式选择优先于工作区和全局默认 |

以上是执行前源码调查结论，执行时仍应核对工作区最新状态，不依赖旧行号直接修改。

## 三、推荐交互和配置语义

### 3.1 一个选择，两项同时生效

以“渠道标识＋模型标识”作为完整选择。不同渠道即使模型标识相同，也属于不同选择，不能按模型名判定为无需切换。

优先复用现有 setSessionModel RPC，使模型和渠道一起校验、保存、广播；保留旧入口时，旧入口必须委托给相同逻辑，不留下另一条绕过校验的路径。界面等待权威结果，失败给出可读提示，不只写 console.error。

有历史消息不再成为锁定 Pi 渠道的理由。旧 connectionLocked 数据应兼容读取，不需要批量改写旧会话文件；它不能继续拦截本阶段允许的切换。

### 3.2 忙碌与并发

当前轮正在生成、执行工具、等待工具批准、自动压缩或正在切换时，禁止启动另一项切换。界面说明先完成或停止当前轮；服务端同样校验，不能只靠按钮禁用。

切换与发送、其他窗口同时切换需要使用会话级串行保护。切换状态由服务端向所有窗口同步，新打开的会话快照也应包含该状态；界面禁用发送和继续切换。对状态广播到达前已提交的竞态消息，服务端等待本次切换结束后再处理，失败则使用已恢复的原选择，不直接拒绝并丢掉已清空的草稿。发送不能取得“新模型＋旧渠道”的中间状态。第一阶段不引入“下轮待切换”队列，避免与现有消息队列混合。

当前没有流式任务的后台进程也不能被无意销毁；若后台任务依赖旧 agent 而无法安全移交，明确阻止切换并说明原因，直到该任务结束或用户停止。

### 3.3 成功与失败

先验证渠道存在、引擎兼容、模型归属及本地可确认的认证条件，再提交选择。明确选择了已删除渠道或不属于目标渠道的模型时直接报错，不悄悄使用默认渠道或另一个模型。

切换校验或配置提交失败时保留原有效选择，不能留下半更新字段。切换已成功后，若下一次模型请求因超时、额度、远端认证或服务商错误失败，应如实展示该渠道错误并允许重试或另行选择，不自动退回旧渠道，不承诺本地校验能预知外部服务状态。

用户点击未改变的同一渠道同一模型时不重启、不重复写入。

### 3.4 已删除渠道与跨引擎

原渠道已删除时仍可打开选择器。确认原会话为 Pi 后，可选其他可用 Pi 渠道；服务端不能把“找不到原渠道”自动解释成当前全局默认的引擎。

需要在会话中保留或可靠恢复引擎身份。旧会话优先利用已有运行实例或 SDK 历史格式确定来源；无法确定时给出明确限制，不伪造迁移成功。已确认 Claude CLI 的会话与 Pi 之间本阶段禁止直接迁移。

未发送过消息的空会话不涉及历史格式迁移，继续保留现有创建前的渠道选择能力。

## 四、上下文和工具的连续性

### 4.1 保留完整 SDK 会话

沿用 OPC 会话 ID、存储目录、工作区、工作目录和 Pi 历史文件；重建的是执行实例，不是用户会话。保留当前分支、压缩摘要、压缩之后的消息、用户和助手正文、历史工具调用及工具结果。

禁止以界面纯文本拼接、最后 12 条恢复消息、重新生成摘要或重新执行工具作为正常切换的替代实现。SDK 原有压缩策略继续生效，不承诺绕过目标模型的上下文上限。

### 4.2 当前分支优先

恢复已有分支时优先继续该分支自己的 SDK 历史。只有首次创建分支且不存在分支历史时，才按父会话切点 fork。切换或应用重启不得重新 fork 回父会话、丢掉分支之后新增的对话。

### 4.3 区分渠道来源并兼容旧历史

历史助手内容需要能区分来源渠道；不能仅比较 modelId 或 provider。原生 OAuth、相同提供商的不同账号、普通自定义渠道和品牌渠道都需要覆盖。

优先保持 SDK 原生 provider 与认证映射不变，在本地持久化必要的非敏感消息来源标识；构造发送上下文时按目标连接对副本做兼容转换，复用 Pi 已有跨模型转换能力。不可移植的 thinking 签名、加密思考和响应引用不能带到不兼容渠道；保留可移植的正文与工具结果，并保证工具调用 ID 和结果仍正确配对。

旧消息没有来源标识时使用保守兼容策略，不推测账号、不把当前渠道倒填为所有旧消息的来源。不得直接修改 node_modules，不批量重写历史日志，也不得删除原历史来规避格式问题。

### 4.4 工具保持原会话授权

重新挂接当前会话启用的 Sources、MCP、API 工具、会话工具、工作目录、项目提示和适用 Skills。重建后要验证工具定义确实发送给新模型，并能完成一次新的工具调用。

历史工具结果作为上下文保留，不自动重放。权限模式、审批边界、来源启用状态保持不变；已撤销授权的来源不能因切换重新启用。审批中的请求不跨运行实例迁移。

浏览器、后台任务和外部句柄若不能无损接续，保留已知结果并明确说明当前能力；不可把已关闭的资源谎称仍在线。

## 五、其他关联设置的最佳处理

| 关联项 | 本轮规则 |
| --- | --- |
| 全局、工作区默认渠道与模型 | 只作为新会话初始值；聊天切换不回写默认设置 |
| 思考等级 | 保留用户偏好，但实际生效值必须适合目标模型；降级时同步界面，不能显示未生效的等级 |
| 上下文窗口与用量 | 用目标模型的上下文容量解释下一轮；累计历史用量保留，不能把旧轮次记成新模型消费 |
| 图片与附件 | 本地附件不删除；新模型不支持图片时沿用并完善现有提示，旧图片上下文按 SDK 能力降级，不声称新模型看到了图片 |
| 压缩与 mini model | 使用目标连接对应的辅助模型与认证；历史摘要继续保留，不跨渠道混用旧凭据 |
| 标题生成 | 后续需要生成标题时使用有效运行配置，不改写原历史内容 |
| Sources、MCP、Skills | 沿用会话选择和可用性；切换不得重置或扩大授权 |
| 权限模式与工作目录 | 原样保留，不因为切换渠道变成更宽权限或其他目录 |
| 多窗口与 WebUI | 通过同一权威事件同步渠道、模型与必要能力，不依赖单窗口本地状态 |
| 消息队列 | 切换过程中不能把已排队消息发往部分更新的配置；保持既有队列语义 |
| 子任务、其他会话 | 已运行的独立会话保持自己的选择，不级联切换；后续显式创建行为沿用既有规则 |
| 定时任务 | 使用任务动作自身保存的绑定，会话切换不反向改写任务 |

## 六、自动化定时任务的隔离约束

已核实当前每次执行自动化动作都会创建独立会话，渠道和模型从动作自身的 llmConnection、model 透传。当前聊天不是定时任务的可变配置引用。

本轮必须保证：

1. 固定 A/M1 的任务在聊天切到 B/M2 后，下一次运行仍创建 A/M1 会话。
2. 用户在某次定时任务生成的结果会话中切到 B/M2，不改变任务定义，也不影响下一次运行的 A/M1。
3. 更改全局或工作区默认值不覆盖任务已明确保存的两个字段。
4. 不更改任务频率、时区、触发器、提示、通知、运行历史、定时与手动测试入口。
5. 不批量修改真实 automations.json，不把会话配置反向写进自动化动作。

既有边界：自动化动作允许省略渠道或模型，运行时会按现有默认规则解析；部分无效绑定也存在原有回退行为。本轮要求“自动化保持原状”，因此不改这些解析规则、不自动补齐或迁移旧任务，也不宣称这些任务已经冻结。无法从当前配置还原省略字段的任务最初运行时所用渠道和模型。

若未来要求所有新旧定时任务都具备严格冻结、无效绑定必定报错，应单独处理自动化创建/编辑时固化两个字段与旧任务补选迁移；不能夹带到本轮会话优化。当前可保证的冻结对象是已明确保存有效渠道和模型的任务。

## 七、实施分工与允许改动范围

1. 母 Agent：维护本 Goal，协调契约，审查失败路径与自动化隔离，运行集成验证和最终检查。
2. 会话后端：SessionManager、其直接测试、必要的会话持久化字段、路径往返工具与协议 DTO；统一更新入口、并发保护、引擎边界、完整状态事件。路径工具只处理真实分支持久化验证暴露的 Windows 波浪号路径问题。
3. Pi 运行时：PiAgent 初始化最小参数传递、pi-agent-server 内的消息来源兼容与分支恢复、对应测试；不修改实际凭据存储格式。
4. 前端：ChatPage、ChatDisplay、FreeFormInput、CompactModelSelector、picker-mode、会话事件处理器、直接测试及需要的双语提示；不重做设置页或自动化编辑器。
5. 必要审计：仅对本轮实际修改的受管源文件和测试精准刷新 Craft 清单；现有未提交项不能被覆盖或重算为无关变更。

所有参与者共享工作区，必须声明文件所有权、尊重他人修改，不做整文件回退或批量清理。任务开始前记录 git status，结束时对照差异。

## 八、第一阶段验收矩阵

| 编号 | 场景 | 必须证明的结果 |
| --- | --- | --- |
| A01 | 空会话选择 A/M1、改 B/M2 后首次发送 | 首个请求只去 B，模型正确，不受创建时默认绑定影响 |
| A02 | 已有会话 A→B→A | 会话 ID 不变，两次切换后的模型都收到前序对话，界面与实际路由一致 |
| A03 | A、B 的模型 ID 相同，但地址和 Key 不同 | 请求确实切到目标地址，使用目标认证；不得向 B 泄漏 A 的 Key |
| A04 | OpenAI、Anthropic 或 Gemini 协议间 Pi 切换 | 历史正文可接续，协议特有签名和工具 ID 被正确转换 |
| A05 | 历史有工具调用和结果 | 新模型收到配对结果，历史工具不重跑，并能继续调用当前授权工具 |
| A06 | 分支已有新增对话后切换、再重启 | 恢复当前分支末尾，不能回到父会话切点 |
| A07 | 目标渠道不存在、模型不属于目标渠道或本地认证不可用 | 拒绝切换、提示原因，原选择和历史不变，无静默回退 |
| A08 | 切换成功后目标服务超时、额度不足或远端认证失败 | 明确报告目标渠道错误，不暗中改选其他渠道，不丢原上下文 |
| A09 | 切换成功后关闭并重启应用 | 渠道、模型和会话历史持久化一致，下一次请求仍去新渠道 |
| A10 | 原渠道删除后的 Pi 会话 | 能选择存活的 Pi 渠道并接续；未知引擎不得冒充已完成迁移 |
| A11 | 生成中、工具执行中或审批等待中切换 | 前后端都拒绝忙碌切换，先完成或停止后可成功切换 |
| A12 | 双击、两个窗口同时切换、切换期间发送 | 不产生部分更新状态，不发生重复初始化或旧实例接收新模型的竞态 |
| A13 | 旧会话没有消息来源标记 | 正文与工具上下文保留，兼容策略不会把未知来源签名错误归属到新渠道 |
| A14 | 新模型不支持图片、思考等级或上下文容量较小 | 能力提示正确，权限与附件原文件不变，压缩及降级行为明确 |
| A15 | Sources、MCP、工作目录、权限、项目上下文 | 切换前后保持既有会话设置，实际工具定义与能力一致 |
| A16 | 普通与紧凑选择器、Electron 与 WebUI | 提供一致选择与错误反馈，其他窗口同步生效 |
| A17 | 固定 A/M1 定时任务，普通聊天切 B/M2 | 任务配置不变，下一次执行仍新建 A/M1 会话 |
| A18 | 定时任务结果会话切 B/M2 | 后续定时运行及手动测试仍使用任务原 A/M1 |
| A19 | 已保存定时任务、修改全局/工作区默认、应用重启 | 任务显式字段保留，不被会话或默认值覆盖 |
| A20 | Pi 与 Claude CLI 的已有会话互切 | 第一阶段明确拒绝或禁用并解释限制，不假装上下文兼容 |

涉及真实服务商差异的部分先由本地模拟端点与 SDK 集成覆盖。模拟验证不能替代所有真实服务商兼容性保证；最终报告要注明真实渠道实测范围。

## 九、验证命令与证据要求

以根 package.json 的现有命令为准，使用 Bun，不安装新依赖。执行写配置或持久化的测试前设置独立 CONFIG_DIR，禁止写真实用户目录。新增测试路径须在新增后列入实际执行记录，不能把尚未创建的文件当成已执行测试。

现有针对性验证入口：

```powershell
bun test ./apps/electron/src/renderer/components/app-shell/input/__tests__/picker-mode.test.ts ./apps/electron/src/renderer/components/app-shell/input/__tests__/model-picker-helpers.test.ts
bun test ./packages/server-core/src/sessions/runtime-config.test.ts ./packages/server-core/src/sessions/refresh-connection-runtime.test.ts
bun test ./packages/pi-agent-server/src/model-resolution.test.ts ./packages/pi-agent-server/src/custom-endpoint-provider.test.ts
bun test ./packages/shared/src/automations/handlers/prompt-handler.test.ts ./packages/server-core/src/sessions/automation-origin.test.ts
bun run validate:ci
bun run lint
& 'D:\Python\Python312\python.exe' 'C:\Users\Qiang\.agents\skills\qiaomu-goal-meta-skill\scripts\lint_goal_command.py' 'D:\AiCode\OPCAgent\tasks\goal-session-channel-model-switching.md'
```

新增验证应优先覆盖真正的请求路由、上下文与工具序列、事务失败和多窗口事件，不写仅重复实现分支的无意义断言。

本地模拟端点使用假的 A/B 凭据和明确的测试消息，检查实际请求地址、认证归属、消息正文、工具定义和 tool result，不能在日志里打印真实 Key。工具验证使用无外部副作用的测试工具。

若受执行沙箱限制导致项目脚本不能启动，保留实际错误并使用等价的直接命令或授权后的本地运行；不能把“命令没有执行”记成“检查通过”。Windows 全量测试存在项目记录的历史平台差异，出现失败应做基线对照，不能仅用“历史问题”解释未查明的失败。

## 十、完成时交付

1. 本 Goal 文档及与本任务有关的实现代码。
2. 修改文件与其目的，说明原渠道锁和两条更新路径如何统一。
3. 已执行命令、退出结果和本地集成证据，逐项标明验收矩阵覆盖情况。
4. 自动化配置与调度未改变的证据，以及显式保存绑定保持不变的回归结果。
5. 尚未覆盖的真实服务商、未知引擎旧会话和跨 Pi/Claude CLI 的限制。
6. 如果工作被中断，提供当前目标、已完成内容、未完成项、修改文件、验证结果、风险与下一步的 Handoff；不以预算或上下文不足伪称完成。

## 十一、执行记录

本节只记录已经发生的事实，不预先填写通过或完成。

- 2026-09-28：完成源码调查与三路只读规划；明确第一阶段为 Pi 内切换，自动化保持现有语义。
- 2026-09-28：生成本 Goal 文档，并按用户授权开始第一阶段实现。
- 2026-09-28：尝试运行修改前基线 `bun run validate:ci`，Bun 子脚本启动时报 `Operation not permitted`，退出码 1；该结果不能视作代码检查结论。
- 2026-09-28：使用本机实际 Python 路径运行 Goal 校验，结果通过；`py -3` 启动器在当前环境未检测到安装，故验证命令使用 `D:\Python\Python312\python.exe`。
- 2026-09-28：使用等价直接命令 `bun ./node_modules/typescript/bin/tsc --noEmit -p packages/server-core/tsconfig.json` 检查修改前 server-core 类型，退出码 0。
- 2026-09-28：完成前端、会话事务、Pi 历史恢复三路实现及交叉审查。补齐跨窗口发送等待切换、并发发送沿用原队列、后台 shell 自然完成解除阻塞。
- 2026-09-28：隔离配置下授权运行 `bun run validate:ci`，退出码 0；最终并发补丁完成后再次运行 `bun run typecheck:all`，退出码 0。
- 2026-09-28：`bun run lint` 退出码 0，Craft UI 与保留测试检查通过；ESLint 有 warning，无 error，未顺手修复无关警告。
- 2026-09-28：首轮五组聚焦测试合计 130 项通过、408 个断言；随后按正式 Goal 补齐完整入口与实际界面证据，最新结果见下表。本地集成使用真实 Pi 子进程与 SDK、模拟 API 地址及假凭据，没有请求真实渠道。
- 2026-09-28：真实 SessionManager 整链发现并修复两个问题：无 id 的助手消息未记录分支切点；Windows 工作区路径重复转换后被错误展开到当前目录。没有切点的旧消息现在明确拒绝分支，避免误带父会话切点之后的内容。
- 2026-09-28：补齐三协议实际本地 HTTP 请求、图片能力降级、小上下文压缩、真实自动化绑定及 Chrome 交互验证。下列七组共 142 项、719 个断言通过。
- 2026-09-28：补充独立 Bun 服务进程的重启验收；新进程仅从隔离磁盘配置与历史恢复并真实发送，确认渠道、模型、SDK ID 及上下文保持一致。整链测试最终 67 个断言通过，随后 server-core 类型检查通过。
- 2026-09-28：以上修复后重新执行 `bun run validate:ci`、`bun run lint`，均退出 0；前者包括所有包类型检查、81 项共享配置测试、19 项文档工具测试和三道 i18n 检查。`git diff --check` 通过。

### 11.1 已落地的实现

| 文件或模块 | 本轮变化 |
| --- | --- |
| SessionManager.ts | 统一渠道与模型更新事务；目标校验、实例重建预热、持久化读回确认、失败回滚、忙碌保护、发送屏障与引擎识别 |
| 协议 DTO、会话类型、PiAgent | 持久化 agentProvider；同步渠道、模型、能力与切换状态；公开 Pi 预热能力，校验必须恢复的历史 |
| pi-agent-server 的 connection-history.ts | 记录非敏感渠道来源；仅转换发送副本，保留正文和工具配对，隔离不可移植签名 |
| pi-agent-server 的 session-resume.ts | 优先恢复当前会话及分支；持久化首次分支锚点；缺失或损坏历史报错，避免假装恢复为空会话 |
| pi-agent-server 的 index.ts | 为没有 id 的实际 SDK 助手回复生成事件级关联 ID，落盘后记录准确分支锚点 |
| shared 的 utils/paths.ts | 便携路径转换保持幂等，兼容旧 Windows 波浪号路径，分支更新始终写回原工作区 |
| ChatPage、ChatDisplay、两个选择器及事件处理器 | 已有 Pi 会话显示其他渠道；单次提交；跨窗口权威状态；失败反馈；已删除渠道可重新选择 |
| en.json、zh-Hans.json | 同步切换失败、跨引擎限制和渠道不可用提示 |
| 关联测试及 Craft 清单 | 覆盖请求路由、上下文、工具、失败、多窗口、分支和自动化隔离；只登记本轮文件 |

### 11.2 可复跑的聚焦验证

下列命令在项目根目录执行。三个 `.isolated.ts` 文件分别单独执行，自行建立独立临时配置并清理自身文件；其余测试统一使用隔离 CONFIG_DIR。完整会话入口测试会从当前源码构建 Pi 子进程到既有的忽略目录 packages/pi-agent-server/dist，不制作安装包。

```powershell
$env:CONFIG_DIR='D:\AiCode\OPCAgent\.tmp\session-channel-switch-validation'
bun test ./packages/server-core/src/sessions/session-model-switch.isolated.ts
bun test ./packages/pi-agent-server/src/connection-history.test.ts ./packages/pi-agent-server/src/session-resume.test.ts ./packages/pi-agent-server/src/model-resolution.test.ts ./packages/pi-agent-server/src/custom-endpoint-provider.test.ts
bun test ./apps/electron/src/renderer/components/app-shell/input/__tests__/picker-mode.test.ts ./apps/electron/src/renderer/components/app-shell/input/__tests__/model-picker-helpers.test.ts ./apps/electron/src/renderer/event-processor/handlers/__tests__/session-model-changed.test.ts
bun test ./packages/server-core/src/sessions/automation-route-isolation.test.ts ./packages/shared/src/automations/handlers/prompt-handler.test.ts ./packages/server-core/src/sessions/automation-origin.test.ts
bun test ./packages/shared/src/agent/__tests__/pi-channel-switch.integration.isolated.ts
bun test ./packages/server-core/src/sessions/session-channel-switch.integration.isolated.ts
bun test ./packages/shared/src/utils/__tests__/portable-session-paths.test.ts
```

| 组别 | 本轮最终结果 | 主要证据 |
| --- | --- | --- |
| 会话切换事务与真实自动化链路 | 16 项、89 断言通过 | A→B→A、重启读取、失败回滚、无效目标、并发及忙碌保护；真实定时任务、默认值变更、结果会话改选、重启及手动运行隔离 |
| Pi 历史与模型解析 | 52 项、255 断言通过 | 签名转换、三协议 HTTP 工具配对及图片能力、SDK 压缩和思考降级、旧历史、分支恢复、模型路由 |
| 选择器与权威事件 | 38 项、102 断言通过 | 普通选择器规则、资格过滤、模型能力、起止事件、多窗口与重新加载状态 |
| 自动化隔离及既有动作链 | 31 项、71 断言通过 | 新运行保留任务 A/M1，结果会话改 B/M2 不反向改变任务；原事件递归保护保留 |
| 真实 Pi 子进程本地集成 | 1 项、27 断言通过 | 同名模型、两地址、两认证，A→B→A 共 5 次请求；历史工具结果保留且只执行 2 次新工具调用 |
| 真实 SessionManager 完整入口 | 1 项、67 断言通过 | 首发改选、A→B→A、同渠道/跨渠道换模型、独立服务进程重启、分支不含父会话未来内容、401 不换路、删除渠道后恢复、已选 API 工具保留且未选来源不被启用 |
| Windows 便携路径 | 3 项、8 断言通过 | 连续两次转换可恢复原工作区；旧反斜杠波浪号路径兼容；用户根目录幂等 |

此外，运行实例配置、连接刷新、PiAgent 预热及错误 RPC 相关回归 26 项通过；前端会话 atoms 相关回归 9 项通过。额外会话回归 32 项通过、1 项失败，该失败的基线证据见下节，不计入上述 142 项。

### 11.3 验收矩阵的证据与实测边界

| 验收编号 | 已有证据 | 仍未实测的范围 |
| --- | --- | --- |
| A01 | 真实 createSession、首次发送前改选、发送请求只到目标渠道；选择器资格与真实渲染交互 | 打包桌面壳首发操作 |
| A02、A03、A05 | 真实 SessionManager 与 Pi 子进程、本地双地址、不同假 Key、两次新工具调用；普通及紧凑界面实际点击 | 真实服务商网络及计费环境 |
| A04、A13 | OpenAI、Anthropic、Gemini 三协议实际本地 HTTP 请求，旧来源及签名转换、工具 ID 配对 | 各真实账户和 OAuth 组合；原地替换同一 slug 的账号或地址不在跨渠道验证范围 |
| A06 | 真实创建分支、发送、切换、重启后续聊；请求含分支新增内容、不含父会话切点之后内容；缺切点明确拒绝 | 打包桌面壳的分支点击；已有 fixture 错误另有基线记录 |
| A07 | 无效渠道、模型、凭据、预热及存储失败回滚测试 | 实际磁盘完全不可写时无法保证任何新落盘，错误不会被当作成功 |
| A08 | 本地目标服务实际返回 401，收到错误事件，选择仍为目标渠道；重试成功且无旧渠道请求 | 真实服务商超时、额度和限流策略 |
| A09 | 关闭运行实例和 ConfigWatcher、重建 SessionManager 并实际发送，普通与分支均覆盖；另启动独立 Bun 服务进程，仅从磁盘恢复后续聊，渠道、模型、SDK ID 与历史一致 | 打包桌面壳关闭启动 |
| A10、A20 | 删除当前连接后实际切到存活连接续聊；旧 Pi SDK 证据恢复；跨引擎拒绝与界面禁用 | 无可靠引擎证据的古老会话仍明确受限 |
| A11、A12 | 服务端审批与并发守卫、发送屏障、队列；两个实际 Chrome 标签同步禁用/解锁并保留草稿 | 桌面壳窗口通信；浏览器夹具的 RPC 事件为纯内存模拟 |
| A14 | 三协议视觉/非视觉请求验证图片或明确占位；真实 SDK 小容量触发压缩保留摘要、目标认证和 thinking=off，重启可恢复 | 各真实服务商能力与额度差异 |
| A15 | 实际请求保留已选 API Source 工具、不启用另一未选来源；Session 工具可调用，safe 权限与工作目录保留 | 各真实 MCP 和浏览器外部句柄组合 |
| A16 | 使用 WebUI Vite 配置在 Chrome 渲染实际 ChatPage→ChatDisplay→FreeFormInput 和紧凑选择器；点击、输入、失败 toast、多标签及删渠道恢复均通过 | Electron 打包壳；后端另由真实 SessionManager 集成验证 |
| A17、A18、A19 | 实际 AutomationSystem/PromptHandler→SessionManager→Pi HTTP 链；改默认和结果会话后重启仍请求 A/M1，任务文件字节未变，新普通会话采用 B；手动运行也保持 A/M1 | 主动注入 SchedulerTick，没有等待分钟定时器；未操作真实定时任务，不迁移缺字段旧任务 |

浏览器的九组实际交互记录保存在 `D:\AiCode\OPCAgent\.tmp\session-channel-switch-validation\ui-browser-results.json`，其中包含启动命令、夹具隔离方式、实际 RPC 参数、草稿与多页面断言。对应截图为同目录 `ui-compact-deleted-channel.png`；可复现的夹具文本为 `ui-fixture.tsx.txt`、`ui-fixture.html.txt`，原始快照及截图保留在 `ui-playwright-cli-raw`、`ui-output`。临时浏览器、Vite 和 Playwright 进程已关闭，执行入口逐个删除；证据属于本地忽略目录，不作为产品源码提交。

### 11.4 既有失败与交付状态

本节记录首阶段完成时的状态。用户追加授权后的修复、真实服务、打包程序验收与提交结果以第十二节为准。

`packages/server-core/src/sessions/session-branching.test.ts` 的一个已有用例报 `assistant-1 not found`。用 Git HEAD 原版 SessionManager 临时副本运行相同用例，也出现相同错误：测试以 role 字段构造持久化消息，而该结构要求 type，初始化落盘后丢失了预期消息。未修改该测试来掩盖结果，临时基线副本已清理。正式 Goal 的真实整链另行发现并修复分支切点记录与 Windows 路径问题；新增真实分支测试已通过，不能把这两个实际缺陷归为 fixture 失败。

全仓 `audit:craft-reuse` 在本轮之前已有与产品基线不一致的文件记录，涉及根配置、README、CLI 清单、锁文件、既有发布说明、通知模块和用户现有文档等。本轮只刷新自己修改文件的审计记录，不把这些无关差异重新标为已审查。最终通过等价直接命令 `bun scripts/audit-craft-reuse.ts` 复核，退出码 1，剩余 13 个不同路径全部属于上述既有差异，本轮文件没有剩余哈希或未登记错误；正式 `bun run lint` 中的 Craft UI 与保留测试检查均通过。

第一阶段实现和本地验收已完成：验收矩阵全部编号均有对应证据，实际模型请求、工具续接、分支、磁盘恢复及真实界面交互已验证；真实账户、OAuth 和打包桌面壳的边界如上表所列。未提交、推送、打包或发布。Pi 与 Claude CLI 的已有会话迁移仍属于第二阶段。后续上线前建议用实际常用的两条 Pi 渠道完成一次桌面 A→B→A、重启和带工具续聊的操作验证；这不会改变本轮保持自动化原状的范围。

### 11.5 本轮修改文件清单

以下路径相对项目根目录 `D:\AiCode\OPCAgent`。按产品界面、会话后端、Pi 恢复与测试、审计及文档分组列出；未列入任务开始前已有的无关改动。

```text
apps/electron/src/renderer/App.tsx
apps/electron/src/renderer/atoms/sessions.ts
apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx
apps/electron/src/renderer/components/app-shell/input/CompactModelSelector.tsx
apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx
apps/electron/src/renderer/components/app-shell/input/model-picker-helpers.ts
apps/electron/src/renderer/components/app-shell/input/picker-mode.ts
apps/electron/src/renderer/components/app-shell/input/__tests__/model-picker-helpers.test.ts
apps/electron/src/renderer/components/app-shell/input/__tests__/picker-mode.test.ts
apps/electron/src/renderer/event-processor/handlers/session.ts
apps/electron/src/renderer/event-processor/handlers/__tests__/session-model-changed.test.ts
apps/electron/src/renderer/event-processor/processor.ts
apps/electron/src/renderer/event-processor/types.ts
apps/electron/src/renderer/pages/ChatPage.tsx
packages/shared/src/i18n/locales/en.json
packages/shared/src/i18n/locales/zh-Hans.json

packages/server-core/src/sessions/SessionManager.ts
packages/server-core/src/sessions/automation-route-isolation.test.ts
packages/server-core/src/sessions/session-model-switch.isolated.ts
packages/server-core/src/sessions/session-channel-switch.integration.isolated.ts
packages/shared/src/agent/backend/types.ts
packages/shared/src/agent/pi-agent.ts
packages/shared/src/agent/__tests__/pi-agent-branching-capability.test.ts
packages/shared/src/agent/__tests__/pi-channel-switch.integration.isolated.ts
packages/shared/src/protocol/dto.ts
packages/shared/src/sessions/types.ts
packages/shared/src/utils/paths.ts
packages/shared/src/utils/__tests__/portable-session-paths.test.ts

packages/pi-agent-server/src/index.ts
packages/pi-agent-server/src/connection-history.ts
packages/pi-agent-server/src/connection-history.test.ts
packages/pi-agent-server/src/session-resume.ts
packages/pi-agent-server/src/session-resume.test.ts

scripts/craft-source-overrides.json
scripts/craft-ui-overrides.json
tasks/goal-session-channel-model-switching.md
```

`scripts/craft-source-overrides.json` 保留任务开始前已有条目，只对本轮相关文件更新登记；真实自动化配置、调度实现及依赖版本没有修改。

## 十二、用户追加授权的发布收尾

2026-09-28，用户要求继续处理既有测试、审计差异、真实服务和打包程序验证，并生成安装包、推送 GitHub。本节是新增授权范围，允许必要的版本元数据、中文发布说明、已审查差异登记和提交推送；前面关于不打包、不提交的限制仅对应已完成的首阶段。依然不改真实任务绑定，不实现跨 Pi/Claude CLI 迁移，不覆盖旧安装包，不发布公开 Release 或切换 Latest。

### 12.1 已补齐的证据

1. 既有 `session-branching.test.ts` 已修正：持久化消息使用 type，运行时 role 单独断言，工作目录使用平台原生路径；缺少所选助手锚点时明确拒绝且不留下分支。目标用例 15 个断言，相邻 27 项、69 个断言全部通过。
2. 原 13 个审计路径逐项与历史提交及旧清单哈希对照，确认属于已完成的工程基线、通知与文档变化后精准登记。没有更改那些文件的历史内容来规避审计，审计恢复通过。
3. 真实服务使用用户确认的 DeepSeek 与 Gemini，四轮依次执行 A 首次调用工具、A→B 并再次调用工具、B→A、重建服务后续聊；每轮成功且保持同一 SDK ID，后续回复正确包含最初口令和历史工具返回的名称。未发送任何既有用户聊天历史或文件。
4. OpenCode Go 与 Kimi Code 的前置尝试分别返回当前订阅无访问权限，记录为账户条件问题；不因此修改渠道或绕过服务限制。
5. 真实验证使用隔离目录，最终原配置与原凭据哈希未变，测试加密凭据副本删除。首次准备时隔离环境设置晚于 Bun preload，曾将读取出的两条 Key 写回原加密库，已告知用户；修正后必须在启动前设置 CONFIG_DIR，且在读取凭据前校验加载常量。不得把最后成功运行的只读结论倒推到首次准备。
6. Windows 启动改为复用现有 Bun 解析器，优先标准 resources/vendor 布局并兼容 app/vendor；不是所有原 Pi 聊天无法启动，修复的是启动环境与会话定位不一致、可能影响脚本工具的问题。相关 7 项、12 个断言及 shared/Electron 类型检查通过。

真实验证结果位于 `D:\AiCode\OPCAgent\.tmp\session-channel-release\real-channel-results.json`；两条不可用订阅的记录分别为同目录 `real-channel-opencode-unavailable.json`、`real-channel-kimi-unavailable.json`。这些本地验证记录不进入安装包或 Git。

### 12.2 安装包与 Git 交付约定

版本为 0.1.11，Windows x64，安装包目标为 `D:\AiCode\OPCAgent\apps\electron\release\v0.1.11\OPC-Agent-0.1.11-x64.exe`。该目录此前不存在，旧 release 产物保留。workspace 版本和 bun.lock 仅同步版本号，不升级依赖。应用内中文说明为 `apps/electron/resources/release-notes/0.1.11.md`，会核对实际打包副本。

代码目标为既有 `origin/craft-sources-auto`，远端 `https://github.com/iBigQiang/OpcAgent.git`。保留并审查原有 dialog 修复及工程记录，使源码与打包内容一致；只推送正常提交，不强制推送，不上传凭据、合成会话日志或本地二进制到 Git。最终校验和、桌面验收和远端提交验证将在实际完成后补记。

### 12.3 本轮最终构建与检查记录

| 检查 | 实际结果 |
| --- | --- |
| 版本准备及 `bun scripts/release.ts check v0.1.11` | 通过，所有 workspace 均为 0.1.11，bun.lock 仅版本号变化 |
| `bun run electron:build` | 退出 0，构建主进程、preload、renderer、Pi 子进程及资源 |
| electron-builder Windows x64 NSIS | 退出 0；使用现有配置，覆盖输出目录为 release/v0.1.11，publish=never |
| 安装包体积及签名 | 255783807 字节，约 244 MiB；未做 Authenticode 签名 |
| 安装包内部完整性 | 7-Zip test 退出 0、Everything is Ok；NSIS 尾部数据提示保留记录 |
| 更新清单和内置说明 | latest.yml 版本、SHA512 与安装包一致；包内 0.1.11 中文说明与源文件 SHA256 一致 |
| 最终 `bun run validate:ci` | 退出 0，类型检查、共享配置、文档工具和 i18n 检查通过 |
| 最终 `bun run lint` | 退出 0，Craft UI 和保留测试检查通过；ESLint 0 error，保留既有 warnings |
| `bun scripts/audit-craft-reuse.ts` | 退出 0，189 个恢复功能文件、985 个已审查集成文件 |
| 发布说明资产单测 | 1 项通过，4 个断言 |
| Goal lint 与 `git diff --check` | 通过 |

安装包 SHA256：`0c25faa98cca8ac96dd654cdfeb95af56098c4c2d1795ef3612b41625ac5576f`。同目录 `SHA256SUMS` 还包含 blockmap 和 latest.yml 的校验和。构建、校验日志保留在 `D:\AiCode\OPCAgent\.tmp\session-channel-release`，分别为 `electron-build.log`、`electron-package.log`、`installer-integrity.log`、`package-integrity.json`、`validate-ci.log`、`lint.log`、`craft-audit.log`。

### 12.4 打包后真实桌面验收

启动新版本目录中的原始 EXE，使用隔离 CONFIG_DIR 与 Electron userData，通过真实界面、WebSocket RPC、打包 Pi 子进程和两个本机 HTTP 端点贯通验证。12 个检查点全部通过，两个桌面主进程均正常退出 0：

- A/same-model 首次发送并调用 get_session_info，工具结果进入 SDK 上下文。
- 界面切到 B/same-model，再切回 A/second-model；每次仅一次真实 session:setModel RPC，切换起止事件为 true、false。
- 新请求带完整既有对话、历史工具结果和已启用 Source 工具，未启用来源未被开放；两个地址分别获得对应假 Key。
- 完整退出程序后以新 PID 启动，恢复同一会话、目标渠道与模型，原两次工具结果仍进入后续实际请求。
- 通过进程信息确认 Pi 由本包 resources/vendor/bun/bun.exe 执行，没有借用开发机 Bun。

测试只在隔离进程最早启动处拦截系统协议注册和自动更新请求，未替换聊天 RPC、SessionManager 或 Pi。调试注入的早期方案及受限环境 GPU 启动曾失败；最终在授权的正常宿主环境完成，不更改产品 GPU 设置。系统协议注册表前后相等，原有 OPC Agent 进程持续运行。

最终记录位于 `D:\AiCode\OPCAgent\.tmp\session-channel-release\electron-run-2026-09-28T01-37-21-024Z\electron-results.json`；同目录有 `electron-model-requests.json`、`electron-rpc-frames.json` 和 `electron-restart.png`。这些是合成测试数据；没有实际运行安装向导覆盖当前已安装的应用，也没有验证真实服务商所有账户或跨平台安装包。
