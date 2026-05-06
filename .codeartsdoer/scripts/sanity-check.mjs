#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const requiredFiles = [
  "README.md",
  ".codeartsdoer/agents/coordinator.md",
  ".codeartsdoer/agents/initializer.md",
  ".codeartsdoer/agents/coder.md",
  ".codeartsdoer/agents/verifier.md",
  ".codeartsdoer/plugins/inject-subagent-context.js",
  ".codeartsdoer/lib/harness-context.js",
  ".codeartsdoer/config/inject-initializer.jsonl",
  ".codeartsdoer/config/inject-coder.jsonl",
  ".codeartsdoer/config/inject-verifier.jsonl",
  ".codeartsdoer/skills/generate-app-spec/SKILL.md",
  ".codeartsdoer/skills/project-architecture-summarizer/SKILL.md",
]

const checks = []

function pass(name) {
  checks.push({ name, ok: true })
}

function fail(name, detail) {
  checks.push({ name, ok: false, detail })
}

function read(path) {
  return readFileSync(path, "utf8")
}

for (const path of requiredFiles) {
  existsSync(path) ? pass(`exists: ${path}`) : fail(`exists: ${path}`, "missing")
}

for (const path of [
  ".codeartsdoer/plugins/inject-subagent-context.js",
  ".codeartsdoer/lib/harness-context.js",
]) {
  if (!existsSync(path)) continue
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" })
  result.status === 0
    ? pass(`node --check: ${path}`)
    : fail(`node --check: ${path}`, result.stderr.trim() || result.stdout.trim())
}

if (existsSync(".codeartsdoer/plugins/inject-subagent-context.js")) {
  const plugin = read(".codeartsdoer/plugins/inject-subagent-context.js")
  for (const path of [
    ".codeartsdoer/config/inject-initializer.jsonl",
    ".codeartsdoer/config/inject-coder.jsonl",
    ".codeartsdoer/config/inject-verifier.jsonl",
  ]) {
    plugin.includes(path)
      ? pass(`plugin reads ${path}`)
      : fail(`plugin reads ${path}`, "path is not referenced by injection plugin")
  }
}

for (const path of [
  ".codeartsdoer/config/inject-initializer.jsonl",
  ".codeartsdoer/config/inject-coder.jsonl",
  ".codeartsdoer/config/inject-verifier.jsonl",
]) {
  if (!existsSync(path)) continue
  const lines = read(path).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let ok = true
  let detail = ""
  for (const [idx, line] of lines.entries()) {
    try {
      const parsed = JSON.parse(line)
      if (!parsed.layer) {
        ok = false
        detail = `line ${idx + 1} has no layer`
        break
      }
    } catch (error) {
      ok = false
      detail = `line ${idx + 1}: ${error.message}`
      break
    }
  }
  ok ? pass(`jsonl layers: ${path}`) : fail(`jsonl layers: ${path}`, detail)
}

const textTargets = requiredFiles.filter((path) => path.endsWith(".md") || path.endsWith(".js"))
const combined = textTargets.filter(existsSync).map(read).join("\n")
const forbidden = [
  [/docs\/inject-(initializer|coder|verifier)\.jsonl/, "stale docs/inject-*.jsonl path"],
  [/\.opencode/, "stale .opencode naming"],
  [/Do NOT commit/, "commit protocol conflicts with coordinator revert window"],
  [/coder sets `true`/, "passes ownership still assigned to coder"],
]

for (const [pattern, detail] of forbidden) {
  pattern.test(combined) ? fail(`forbidden text: ${pattern}`, detail) : pass(`forbidden text absent: ${pattern}`)
}

const failed = checks.filter((check) => !check.ok)
for (const check of checks) {
  const icon = check.ok ? "ok" : "fail"
  console.log(`${icon} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`)
}

if (failed.length > 0) {
  console.error(`\n${failed.length} sanity check(s) failed.`)
  process.exit(1)
}

console.log(`\nAll ${checks.length} sanity checks passed.`)
