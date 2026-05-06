# codearts-harness

codearts-agent-native 自主编码 harness — 零 Python、零应用代码，纯 agent prompt + plugin 配置。
给它一句需求描述（或一份 PRD 文档），4 个 agent 协作产出完整项目。

## 架构

```
coordinator (primary)  →  Step 0: Mode detection (GREENFIELD / RESUME / NEW_ITERATION / BOOTSTRAP_EXISTING)
   ├─ generate-app-spec    →  Step 1: 规格文档 (CREATE / DELTA / NEW_ONLY / FROM_DOCUMENT)
   ├─ project-architecture →  Step 2: 架构文档 (FROM_SPEC / REFRESH / FROM_CODE)
   ├─ initializer          →  Step 3: 项目初始化或扩展
   ├─ coder (×N, 串行)     →  Step 4a: 逐 feature 实现 + 写测试
   ├─ verifier (adaptive)  →  Step 4b: 自适应窗口验收 (TEST + ALIGNMENT + REVIEW + SMOKE)
   └─ Step 5: Finish → git tag iter-N
```

详细协议见 `.codeartsdoer/agents/coordinator.md`。

## 使用

详见 [USAGE.md](./USAGE.md)。里面包含维护本仓库、接入新项目、PRD 驱动、继续未完成任务、给已有项目加新功能等完整示例 prompt。

### Iteration 模式

| Mode | 触发 | 行为 |
|------|------|------|
| `GREENFIELD` | 无 spec、无代码 | 全套从零 |
| `RESUME` | 有 spec + `passes:false` 残留 | 跳到 Step 4 |
| `NEW_ITERATION` | 关键词 + 已有 spec | git tag → spec DELTA → arch REFRESH → init APPEND → loop → git tag |
| `BOOTSTRAP_EXISTING` | 关键词 + 有代码无 spec | arch FROM_CODE → spec NEW_ONLY → init APPEND → loop → git tag |

关键词：`迭代` / `新需求` / `新增` / `iterate` / `add feature`

### 上下文注入

Plugin 在 `tool.execute.before` 拦截 `task()` 调用，按 subagent_type 注入分层上下文：

| Subagent | 注入内容 |
|----------|----------|
| `initializer` | Spec JSON 摘要、feature_list（APPEND 模式标注 max(id)） |
| `coder` | Progress、Feature Work Packet、Spec slice、ARCHITECTURE.md（分级降级）、同类历史 + 代码样本、探索许可 |
| `verifier` | Verification targets、Spec slices（去重）、ARCHITECTURE.md（含 invariant 对照清单）、Window diff、BOOTSTRAP 警示 |

### feature_list.json 跨 iteration 不变量

- `id` / `category` / `is_ui` / `description` / `steps` / `iter` 一旦写入永不修改
- 新 iter 只能 append 高 id 的新 entry
- `passes` 动态（verifier/plugin 维护）；`test_file` 由 coder 一次写入

## 快速开始

### 自检

在发布或复制 harness 前，先运行最小自检：

```bash
node .codeartsdoer/scripts/sanity-check.mjs
```

自检会确认必要 agent/skill/plugin/config 文件存在、注入配置路径一致、JS 语法可解析、核心协议关键词没有明显冲突。

### 场景速查

| 场景 | 用户消息 | Mode |
|------|----------|------|
| 绿地新项目 | `"帮我做一个任务管理工具"` | `GREENFIELD` |
| 继续未完成 | `"继续"` | `RESUME` |
| 加新功能 | `"新增需求：加通知中心"` | `NEW_ITERATION` |
| 存量项目接入 | `"新增需求：给项目加登录"` | `BOOTSTRAP_EXISTING` |
| PRD 驱动 | 粘贴 PRD 文档 | `FROM_PRD` |

### 旧项目接入

```bash
cp -r /path/to/codearts-harness/.codeartsdoer /path/to/your-project/
cd /path/to/your-project && codearts-agent coordinator
```
输入：`"新增需求：给这个项目加 XX 功能"`

## 前置要求

- [codearts-agent](https://codearts.huaweicloud.com/) — agent AIDE
- `agent-browser` — E2E 浏览器冒烟测试 (`npm i -g agent-browser && agent-browser install`)
- Node.js 18+
- Git。目标项目必须能 `git init` / `git commit` / `git tag` / `git revert`，因为 coordinator 用 commit 窗口做 verifier 失败回滚。

## 运行约定

- Workspace root 就是目标项目根目录。`.codeartsdoer/` 放 harness 配置，`docs/`、`src/`、`server/`、`tests/`、`package.json` 等 runtime 文件都生成在同一层。
- `coder` 每次只实现一个 feature，测试通过后提交一个 commit。`verifier` 按窗口检查这些 commit，失败时 coordinator revert 该窗口。
- `coder` 只写 `test_file`，不改 `passes`。`passes` 由 verifier 输出的 `VERIFY_PASS` / `VERIFY_FAIL` 通过 plugin 自动维护。
- UI feature 必须有 `tests/e2e.sh`，verifier 会运行浏览器冒烟测试。

## 边界场景

| 状态 | 处理 |
|------|------|
| 无 spec、无代码 | `GREENFIELD`，完整生成 spec、初始化项目并实现 |
| 有 spec、无 feature_list | 视作初始化中断，重试 initializer |
| 有 spec 且仍有 `passes:false` | `RESUME`，直接继续未完成 feature |
| 有 spec 且全部通过 | 需要带 `新增需求` / `iterate` 等关键词进入下一轮 |
| 有代码但无 spec | 需要带新增/迭代关键词，走 `BOOTSTRAP_EXISTING` |
| 目标目录不是 git repo | initializer 必须先 `git init` 并提交初始骨架 |

## 发布同步

维护本仓库时，提交前先跑自检：

```bash
node .codeartsdoer/scripts/sanity-check.mjs
```

提交后使用统一脚本同步 GitHub 和 GitCode/AtomGit：

```bash
GITCODE_TOKEN=<token> scripts/publish.sh main
```

脚本会推送指定分支和 tags 到 `origin`，如果配置了 `gitcode` remote，则继续同步到 GitCode。`GITCODE_TOKEN` 只通过临时 askpass 传给 git，不会写入 remote URL。

## 字符串 Contract

| 字符串 | 来源 | 含义 |
|--------|------|------|
| `INIT_DONE: 共 K 个功能待实现` | initializer | K=全部(CREATE) 或 K=本轮新增(APPEND) |
| `INIT_DONE_FEATURES: <K> features` | initializer (features scope) | feature_list 创建/追加完成 |
| `INIT_DONE_SKELETON` | initializer (skeleton scope) | 项目骨架完成 |
| `FEATURE_COMPLETE: <desc>` | coder | 一个 feature 实现完成 |
| `FEATURE_PARTIAL: feature <id>: <note>` | coder | >10 步 feature 主动 checkpoint |
| `VERIFY_PASS: feature <id>` | verifier | 通过窗口验收 |
| `VERIFY_FAIL: feature <id>: <reason>` | verifier | 未通过 |
| `ITER_DONE: iter-N (<K> features)` | coordinator | iteration 完成 |
| `BLOCKED: <reason>` | 任意 subagent | 卡住 |

## Runtime 产出物

| 文件 | 说明 |
|------|------|
| `docs/app_spec.txt` | 项目规格（XML） |
| `docs/feature_list.json` | feature 进度真相源（append-only） |
| `docs/code-index.json` | 代码索引（category → files） |
| `docs/knowledge.md` | 跨 session 知识积累（decisions/gotchas/conventions/failures） |
| `ARCHITECTURE.md` | 项目架构文档 |
| `tests/feature-<id>.<ext>` | Per-feature 测试文件 |
| `tests/e2e.sh` | 浏览器冒烟脚本 |
| `init.sh` | 开发环境搭建脚本 |

## 设计宪法

1. **coordinator 是唯一可调 `task()` 的 primary agent**
2. **subagent 不能递归调用 subagent**
3. **coordinator 是纯调度者** — 不跑命令、不解析输出、不反查表

## License

MIT · Copyright (c) 2026 zhyi
