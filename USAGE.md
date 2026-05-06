# Usage

This guide covers two workflows:

- maintaining this harness repository
- copying the harness into a target project and running `codearts-agent coordinator`

## Maintain This Harness

Run the sanity check before committing:

```bash
node .codeartsdoer/scripts/sanity-check.mjs
```

Commit normally:

```bash
git add -A
git commit -m "Describe the harness change"
```

Publish to GitHub and GitCode/AtomGit:

```bash
GITCODE_TOKEN=<token> scripts/publish.sh main
```

The publish script pushes the branch and tags to `origin`, then syncs them to the `gitcode` remote if it exists. The GitCode token is passed through a temporary askpass helper and is not written into the git remote URL.

## Install Into A New Project

Create an empty project directory, copy the harness, then start the coordinator:

```bash
mkdir my-task-app
cp -r /path/to/codearts-harness/.codeartsdoer my-task-app/
cd my-task-app
node .codeartsdoer/scripts/sanity-check.mjs
codearts-agent coordinator
```

Example prompts:

```text
帮我做一个个人任务管理工具。需要任务增删改查、优先级、截止日期、标签筛选、完成状态统计。默认技术栈即可，界面要适合桌面和移动端。
```

```text
Build a lightweight team notes app with projects, markdown notes, full-text search, pinned notes, and simple activity history. Use the default stack unless the spec needs something else.
```

This starts `GREENFIELD` mode: the coordinator generates `docs/app_spec.txt`, initializes the project skeleton, creates `docs/feature_list.json`, dispatches one coder per feature, verifies windows of commits, and tags the finished iteration.

## Start From A PRD

Paste the PRD or requirement document directly into the coordinator. Long document-style input is treated as `FROM_DOCUMENT`.

Example prompt:

```text
请根据下面 PRD 直接生成规格并实现，不需要再访谈。

# 客户工单看板 PRD

目标用户：小型客服团队。
核心流程：
1. 客服可以创建客户工单，字段包括标题、客户名、联系方式、优先级、状态、负责人、截止时间和备注。
2. 看板按状态分列：待处理、处理中、等待客户、已解决。
3. 支持按负责人、优先级、状态和关键字筛选。
4. 每个工单需要操作历史，记录状态变化和备注追加。
5. 首页显示今日到期、逾期、高优先级数量。

验收标准：
- 所有筛选条件可以组合使用。
- 工单状态变化必须写入历史。
- 移动端能查看和更新工单。
```

## Resume Interrupted Work

If `docs/app_spec.txt` and `docs/feature_list.json` already exist and some entries still have `passes:false`, start the coordinator again:

```bash
codearts-agent coordinator
```

Example prompts:

```text
继续
```

```text
继续完成上次未通过或未实现的 feature，保持现有技术栈和设计不变。
```

This starts `RESUME` mode and continues from the first feature whose `passes` is `false`.

## Add A New Feature To A Harness-Managed Project

Use an explicit iteration keyword such as `新增需求`, `迭代`, `iterate`, or `add feature`.

Example prompts:

```text
新增需求：给任务管理工具增加通知中心。用户可以看到即将到期、已经逾期、被重新打开的任务通知；通知可标记已读；首页顶部显示未读数量。
```

```text
迭代：增加 CSV 导入导出。用户可以导入任务 CSV，系统需要做字段校验并展示错误行；用户也可以按当前筛选条件导出任务列表。
```

```text
Add feature: add role-based access control. Admins can manage users and roles, editors can create and update content, viewers can only read. Include tests for unauthorized API access.
```

This starts `NEW_ITERATION` when an existing spec is present. The spec generator appends new implementation steps, the initializer appends new feature entries, and existing feature metadata remains append-only.

## Bootstrap An Existing Project

For a project that already has code but does not have harness runtime files, copy `.codeartsdoer` into the project root and use an explicit new-feature prompt:

```bash
cp -r /path/to/codearts-harness/.codeartsdoer /path/to/existing-project/
cd /path/to/existing-project
node .codeartsdoer/scripts/sanity-check.mjs
codearts-agent coordinator
```

Example prompts:

```text
新增需求：给这个已有项目增加登录功能。需要邮箱密码登录、退出登录、登录态保持、未登录访问保护，并保持现有 UI 风格。
```

```text
新增需求：为当前项目增加审计日志。记录用户创建、更新、删除核心资源的操作，管理员可以按用户、资源类型、时间范围筛选日志。
```

This starts `BOOTSTRAP_EXISTING` when code exists but `docs/app_spec.txt` does not. The architecture summarizer first documents the current codebase, then the spec describes only the new functionality. Verifier should not flag pre-existing code outside the new scope.

## Mode Quick Reference

| Mode | When it happens | Prompt shape |
|------|-----------------|--------------|
| `GREENFIELD` | No spec and no existing app code | "帮我做一个..." / "Build a..." |
| `RESUME` | Spec exists and some features still have `passes:false` | "继续" |
| `NEW_ITERATION` | Spec exists and prompt includes iteration/new-feature intent | "新增需求：..." / "iterate..." |
| `BOOTSTRAP_EXISTING` | Existing code, no spec, prompt includes new-feature intent | "新增需求：给这个已有项目..." |

## Important Rules

- The target project root must be a git repository, or initializer must create one with `git init`.
- Coder implements exactly one feature per run and commits after local tests pass.
- Verifier owns pass/fail state through `VERIFY_PASS` and `VERIFY_FAIL`; coder must not edit `passes`.
- A failed verifier window is reverted by coordinator using git commits.
- UI features require `tests/e2e.sh`; verifier should fail UI work if no smoke script exists.
- Runtime files such as `docs/app_spec.txt`, `docs/feature_list.json`, `ARCHITECTURE.md`, `tests/`, `src/`, and `package.json` live in the target project root, not inside `.codeartsdoer/`.
