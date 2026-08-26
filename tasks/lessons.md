# 教训与固化规则

> 每次被修正、或踩坑后定位到根因，就把「现象 → 根因 → 规则」写进来。
> 开新会话（`/newup`）时先过一遍本文件，避免重犯。

---

## L1 · `git status` 说 modified 但 `git diff` 为空 —— 先查行尾，别急着改文件

**现象**：`packages/shared/src/unified-network-interceptor.ts` 长期挂在 modified，`git diff` 却没有任何输出。

**根因**：文件是 CRLF 与裸 LF 混杂（2312 + 96）。`core.autocrlf=true` 下 git 比对时会把工作区内容规范化为 LF 再与索引比，所以内容判定一致（diff 为空）；但物理字节与「git 期望 checkout 出的内容」不同，于是 status 仍标记 modified，`git update-index --refresh` 也只会报 `needs update` 而不写入。

**规则**：
1. 遇到这种矛盾，先做三向哈希比对定性，不要动文件内容：
   ```bash
   git ls-files -s <file>              # 索引 blob
   git rev-parse HEAD:<file>           # HEAD blob
   git hash-object --path <file> <file> # 工作区规范化后
   ```
   三者相同 = 零内容差异，问题在行尾/stat 缓存，不在代码。
2. `git update-index --refresh` 只报告不写入；要真正刷新 stat 缓存用 `git add -A`（内容一致时索引不会变）。
3. 批量改写文件行尾后，务必用 `git add -A` + `git diff --cached --stat` 确认「只有预期的那几个文件进了索引」。

---

## L2 · 行尾规则要以 `git check-attr` 为唯一权威，不要在脚本里复写一套

**现象**：想批量规整工作区行尾时，最省事的写法是在脚本里自己判断「哪些扩展名该 LF、哪些该 CRLF」。

**根因**：脚本里的规则一旦与 `.gitattributes` 不同步就会静默做错，且很难发现。本项目还有 `apps/electron/resources/bin/*`（要 LF）与同目录 `*.cmd`（要 CRLF）这种靠后置规则覆盖的情况，手写判断极易漏掉。

**规则**：批量处理前先 `git ls-files -z | git check-attr --stdin -z eol binary`，拿 git 自己算出的属性驱动脚本。处理后再按同一份属性表复核。

---

## L3 · `#!/bin/sh` 脚本带 CRLF 是会真出故障的，不只是洁癖

**现象**：`apps/electron/resources/bin/` 下 8 个无扩展名包装脚本（`doc-diff`、`markitdown` 等）在 Windows 工作区是 CRLF。

**根因**：这些是 `#!/bin/sh` 脚本，要打进 macOS / Linux 安装包。shebang 行尾带 `\r` 时，解释器会把 `\r` 当成路径的一部分，报 `bad interpreter`。仓库对象是 LF，所以在 Linux CI 上 checkout 没问题 —— 但**在 Windows 上打包这两个平台**就会把 CRLF 版本打进去。

**规则**：新增任何要在类 Unix 下执行的脚本（无扩展名的包装器、`.sh`、`.nsh`、`.py`），确认 `.gitattributes` 覆盖到它并强制 `eol=lf`。

---

## L4 · 这个仓库只用 Bun，误跑 pnpm/npm 会留下难察觉的残留

**现象**：工作区出现 `.pnpm-store/`、`pnpm-workspace.yaml`（内容还是 `set this to true or false` 占位模板）、`pnpm-lock.yaml`。

**根因**：某次误跑了 `pnpm install`。`.gitignore` 当时只屏蔽 `pnpm-lock.yaml`，另两个一直挂在 untracked 里，看着像项目文件。

**规则**：装依赖只用 `bun install --frozen-lockfile`。若看到 pnpm/npm 相关产物，先确认零引用再删；`.gitignore` 里已成节屏蔽这三者。

**但删掉这三个文件只是清了表面。** 真正的破坏在 `node_modules` 内部，而且潜伏了 8 天才暴露：pnpm 建了 `node_modules/.pnpm/`（777M / 1225 个包）、写了 `node_modules/.modules.yaml`，并把 30 个顶层包（含 `react`、`typescript`、`react-dom`、`tiptap-markdown`）换成指向 `.pnpm/` 的软链。于是 `@tiptap/core` 存在两份副本：`packages/ui` 的代码解析到 bun 装的真实目录，`tiptap-markdown` 顺着软链解析到 pnpm 那份。TypeScript 视为两个互不相关的类型，`typecheck:all` 报出

```
Type 'ExtendedOptions' is not assignable to type 'ExtendedOptions'.
Two different types with this name exist, but they are unrelated.
```

这种完全看不出根因的错 —— 报错落在 `packages/ui/src/components/markdown/`，跟依赖管理八竿子打不着。

**补充规则**：
1. 遇到「同名类型互不兼容」「Two different types with this name exist」这类报错，第一反应是查依赖树有没有重复副本，而不是去改业务代码：
   ```bash
   find node_modules -path '*<pkg>/package.json' | wc -l   # >1 就是重复
   ```
2. 确认被 pnpm 污染后**整体重装**，不要只删 `.pnpm/`（会同时断掉那 30 个软链包），也不要手工挑：
   ```bash
   mv node_modules ../node_modules-tainted && bun install   # 先重命名而非删，装不回来能立刻还原
   ```
3. 重装后自检：`node_modules` 顶层只应剩 `@opcagent/*` workspace 包是软链，`.pnpm/` 与 `.modules.yaml` 都不存在。
4. 顺带发现并已修掉的另一个问题：两处 `@types/bun` 写成 `"latest"`，见 L8。

---

## L5 · 报告结论前先等验证真的跑完

**现象**：本轮写 DEVLOG「验证」小节时，在全量测试尚未返回结果的情况下先写下了「`bun run test` 全量通过」。

**根因**：把「已经发起验证」当成了「验证已通过」。

**规则**：验证类结论一律等命令返回后再落笔；未完成的先标 ⏳ 待回填。另外 `cmd | tail -n` 会缓冲到命令结束才输出，想看进度就别接 `tail`，直接写文件或用 `tee`。

---

## L6 · 在 Windows 上跑 `bun run test` 必然有既有失败 —— 别把它当门禁

**现象**：本机全量 `bun run test` 得到 4239 个测试里 46 个失败，第一眼像是自己的改动搞坏了一片。

**根因**：`.github/workflows/ci.yml` 的 `bun run test` 跑在 `runs-on: ubuntu-latest`，而 `scripts/run-tests.ts` **没有任何平台过滤**。于是一批按 Unix 语义校准的断言在 Windows 上必然挂：

- 期望 `/Users/test/.../sessions/tmp`，实际 `\Users\test\...\sessions\tmp`（硬编码 `/` 分隔符）
- `isValidWorkingDirectory(dir, 'darwin')` 拿到 `mkdtempSync()` 给出的真实 `C:\...` 路径，被正确判为「Windows drive path is not valid on this server」
- `mode-manager.test.ts` 里硬编码的 `'C:\Users\test\...'`，期望值是按 Linux `path.posix`（把它当单个文件名）校准的
- `headless server ... shuts down cleanly on SIGTERM` —— Windows 没有 SIGTERM
- `preferences-ui-language.test.ts` 把 `C:\Users\...` 插进 `bun -e` 的模板字符串，`\U` 被当转义序列，子进程直接 exit 1

**规则**：本机验证看 **`bun run validate:ci`**（= `typecheck:all` + `test:shared:all` + `test:doc-tools` + 三道 i18n 检查），那是项目定义的正式门禁且平台无关。全量 `bun run test` 在 Windows 上只用来看「失败集合有没有变大」，不能拿绝对数字当结论；真要一个干净的全量结果，交给 CI 的 ubuntu runner。

---

## L7 · 判断「失败是不是我引入的」要做对照实验，不能只靠推理

**现象**：本轮把 1371 个文件的行尾从 CRLF 改成 LF 后，全量测试出现 46 个失败。从断言内容看全是路径分隔符和平台差异，推理上与行尾无关 —— 但推理不等于证据。

**根因**：行尾确实会改变文件的物理字节，测试读的就是物理字节。只要存在多行模板字符串断言，行尾就有可能真的影响结果。「看起来无关」和「证明无关」是两件事。

**规则**：
1. 做对照实验，而不是只解释现象。把单个失败集中的测试文件临时转回原行尾，跑同一批测试，对比 pass/fail 数**和失败测试名清单**：
   ```bash
   diff <(grep '^(fail)' a.log | sed 's/ \[[0-9.]*ms\]$//') \
        <(grep '^(fail)' b.log | sed 's/ \[[0-9.]*ms\]$//')
   ```
   本轮结果：LF 与 CRLF 都是 429 pass / 15 fail，15 个失败名逐一相同 → 行尾零影响，实验证明。
2. **`grep -c $'\r'` 在 Git Bash 里不可靠**（CR 会被当行尾吞掉，恒返回 0）。验证行尾必须用字节统计：
   ```bash
   python -c "b=open('f','rb').read(); print(len(b), b.count(b'\r\n'), b.count(b'\n'))"
   ```
   转换是否真的发生，看字节数增量是否等于行数。第一次实验我就是被这个假的 `0` 骗过，差点拿一个没真正转换过的文件当对照组。

---

## L8 · 依赖写 `"latest"` 不只是让 `--frozen-lockfile` 失败，还会让同一个包锁出两份

**现象**：`bun install --frozen-lockfile` 报 `lockfile had changes, but lockfile is frozen`。查到 root `package.json:95` 与 `apps/cli/package.json:27` 都把 `@types/bun` 写成 `"latest"`。

**更深一层的危害**（这才是真正该记住的）：`latest` 在不同时间解析出不同结果，于是同一个包在同一仓库里锁到**多个版本** —— 实测 root 锁 `@types/bun@1.3.6`、`apps/cli` 锁 `1.4.0`，`bun.lock` 里为此额外生成一组 `@opcagent/cli/@types/bun` override 记录，两份类型声明并存。这和 L4 里 pnpm 造成的 `@tiptap/core` 双份是**同一类故障**：同名类型来自两个不相关的包，TS 报出完全看不出根因的错。

**修法**：钉确切版本，且与运行时对齐。`@types/bun` 是 bun 的类型声明，钉成与 `bun --version` 相同（本仓库 `1.3.14`）：

```bash
bun --version                                   # 先看运行时版本
# 两处 package.json 都改成确切版本，然后
bun install                                     # 刷新 lock
bun install --frozen-lockfile                    # 必须退出码 0，这才算治好
```

**收益要看 lock 的结构变化，不只看能否安装**：钉版本后 root 由 1.3.6 抬到 1.3.14、`@opcagent/cli/@types/bun` 那组 override 记录整条消失（lock 4166 → 4160 行），双版本共存被消除。

**规则**：这个仓库任何依赖都不写 `"latest"`。加依赖时如果顺手写了 `latest`，等于给 CI 埋一颗按上游发版节奏定时引爆的雷。

---

## L9 · 「删掉残留」删完必须验证它不会再长出来；根因没定性就别把猜想写成结论

**现象**：仓库里长出 `~/AppData/Local/Temp/...` 与 `packages/~/AppData/Local/Temp/...` 两棵目录树，内容是测试产生的 `session.jsonl`（最早 2026-08-12，最新就是当天）。`rm -rf` 删掉后跑一次 `bun run test` 又长回来。

**已经查清的部分**：

- 触发条件是 `bun run test`（全量）。手工单跑同一个测试文件（`bun test src/sessions/__tests__/pending-plan-execution.test.ts`）**不重现**。
- 造目录的测试用的是标准写法 `mkdtempSync(join(tmpdir(), 'pending-plan-test-…'))`（`packages/shared/src/sessions/__tests__/pending-plan-execution.test.ts:15`）与 `mkdtempSync(join(tmpdir(), 'opcagent-session-branch-'))`（`packages/server-core/src/sessions/session-branching.test.ts:11`），测试代码本身没有问题。
- 目录形状是 `~` 顶替了 home 段：`C:\Users\<user>\AppData\Local\Temp\X` 与 `./~/AppData/Local/Temp/X` 一一对应。
- `.gitignore:38` 有一条 `~/` 规则（无前导斜杠，因此同时匹配 `./~` 和 `./packages/~`），git 看不见这些目录 —— 所以现象长期存在却没人追。

**已经排除的假设**（附证据，别再重复走一遍）：

- ~~`scripts/run-tests.ts:28` 的 `Bun.spawnSync` 未传 `env`，子进程丢了 `TEMP`/`TMP`~~ —— **不是根因**。照抄该调用方式起一个探针测试，子进程里 `os.tmpdir()`、`TEMP`、`TMP`、`TMPDIR` 全部正常。实际补上 `env: process.env` 后目录照旧长出，**而且失败数从 46 涨到 48**（两个测试依赖某些变量不存在：`resolveClaudeExecutablePath` 与 `session draft storage` 各一个），改动已回退。

**状态**：根因未定性，留作独立待办。危害有限（被 `.gitignore` 屏蔽、不影响测试结果、CI 在 Linux 上不出现），不值得在无关迭代里继续投入。

**教训**：

1. **「删掉残留」这类指令，删完要验证它不会再长出来。** 我第一次汇报时说这是「两个无害空目录」，实际非空（43 个文件）且每跑一次测试就重新生成 —— 删完就报完成等于敷衍。
2. **根因没定性，就不要把猜想写成结论。** 我一度把 `env` 缺失当根因写进了本条教训和代码注释，随后被探针推翻。写「已排除的假设 + 证据」比写一个错的根因有用得多 —— 错的结论会让下一次排查直接走进死路。
3. **一行「零风险」的修复也必须跑完整验证。** `env: process.env` 看着无害，实测引入 2 个新失败。判断依据只能是**改动前后的失败集合 diff**，不是「这行代码看起来不会有副作用」。
4. 同一个测试「单跑正常、批量跑异常」时，先查驱动脚本的进程/环境/CWD，别去改测试断言 —— 这个方向仍然对，只是本例中 env 这条具体假设不成立。
5. 排查环境相关问题要在**实际运行时**里测。我一开始在交互 shell 里跑 `bun -e "os.tmpdir()"` 得到正常值，据此差点判定「环境没问题」—— 正确做法是照抄真实调用链起探针。
6. **`.gitignore` 里出现「为绕开某个现象而写」的规则，本身就是根因未处理的信号**，值得回头查一次而不是接着容忍。
7. 用 Python 处理含 Windows 路径的文本时，非 raw 字符串里的 `\U`（如 `C:\Users`）会被当 unicode 转义炸掉 —— 和 L6 里 `preferences-ui-language.test.ts` 那个失败是同一个坑。改用 heredoc 落盘 + Python 只做拼接。
