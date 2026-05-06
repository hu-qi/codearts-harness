#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const requiredFiles = [
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

const optionalRepoFiles = [
  ".gitignore",
  "LICENSE",
  "README.md",
  "USAGE.md",
  "scripts/publish.sh",
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

function parseJsonlLayers(path) {
  const layers = []
  const lines = read(path).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const [idx, line] of lines.entries()) {
    const parsed = JSON.parse(line)
    if (!parsed.layer) {
      throw new Error(`line ${idx + 1} has no layer`)
    }
    layers.push(parsed.layer)
  }
  return layers
}

for (const path of requiredFiles) {
  existsSync(path) ? pass(`exists: ${path}`) : fail(`exists: ${path}`, "missing")
}

for (const path of optionalRepoFiles) {
  if (existsSync(path)) pass(`exists optional repo file: ${path}`)
}

for (const path of [
  "scripts/publish.sh",
  ".codeartsdoer/plugins/inject-subagent-context.js",
  ".codeartsdoer/lib/harness-context.js",
]) {
  if (!existsSync(path)) continue
  const command = path.endsWith(".sh") ? "bash" : process.execPath
  const args = path.endsWith(".sh") ? ["-n", path] : ["--check", path]
  const result = spawnSync(command, args, { encoding: "utf8" })
  result.status === 0
    ? pass(`${path.endsWith(".sh") ? "bash -n" : "node --check"}: ${path}`)
    : fail(`${path.endsWith(".sh") ? "bash -n" : "node --check"}: ${path}`, result.stderr.trim() || result.stdout.trim())
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
  try {
    parseJsonlLayers(path)
    pass(`jsonl layers: ${path}`)
  } catch (error) {
    fail(`jsonl layers: ${path}`, error.message)
  }
}

if (existsSync(".codeartsdoer/plugins/inject-subagent-context.js")) {
  const plugin = read(".codeartsdoer/plugins/inject-subagent-context.js")
  const layerBlock = plugin.match(/const LAYERS = \{([\s\S]*?)\n\}/)
  const knownLayers = new Set()
  if (layerBlock) {
    const layerRe = /^\s{2}([a-zA-Z_][\w]*):\s*\{/gm
    let match
    while ((match = layerRe.exec(layerBlock[1])) !== null) {
      knownLayers.add(match[1])
    }
  }

  if (knownLayers.size === 0) {
    fail("plugin exposes JSONL layer registry", "could not parse LAYERS")
  } else {
    pass("plugin exposes JSONL layer registry")
  }

  for (const path of [
    ".codeartsdoer/config/inject-initializer.jsonl",
    ".codeartsdoer/config/inject-coder.jsonl",
    ".codeartsdoer/config/inject-verifier.jsonl",
  ]) {
    if (!existsSync(path) || knownLayers.size === 0) continue
    try {
      const missing = parseJsonlLayers(path).filter((layer) => !knownLayers.has(layer))
      missing.length === 0
        ? pass(`jsonl layers exist in plugin: ${path}`)
        : fail(`jsonl layers exist in plugin: ${path}`, `missing: ${missing.join(", ")}`)
    } catch {
      // The JSONL syntax check above already reports the parse error.
    }
  }
}

const textTargets = [...requiredFiles, ...optionalRepoFiles].filter((path) => path.endsWith(".md") || path.endsWith(".js"))
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

if (existsSync("README.md")) {
  const readme = read("README.md")
  const mentionsMit = /\bMIT\b/.test(readme)
  const hasLicense = existsSync("LICENSE") && /MIT License/.test(read("LICENSE"))
  !mentionsMit || hasLicense
    ? pass("README license statement has LICENSE file")
    : fail("README license statement has LICENSE file", "README mentions MIT but LICENSE is missing or not MIT")
}

if (existsSync(".gitignore")) {
  const gitignore = read(".gitignore")
  gitignore.includes(".codeartsdoer/")
    ? fail("top-level .gitignore keeps harness files trackable", "do not ignore .codeartsdoer/ at repository root")
    : pass("top-level .gitignore keeps harness files trackable")
}

if (existsSync("scripts/publish.sh")) {
  const publish = read("scripts/publish.sh")
  const hasOriginPush = publish.includes('git push origin "${branch}"')
  const hasGitcodePush = publish.includes('git push gitcode "${branch}"')
  const hasTokenAskpass = publish.includes("GITCODE_TOKEN") && publish.includes("GIT_ASKPASS")
  hasOriginPush && hasGitcodePush && hasTokenAskpass
    ? pass("publish script syncs origin and gitcode without remote token")
    : fail("publish script syncs origin and gitcode without remote token", "missing origin push, gitcode push, or askpass token flow")
}

if (existsSync("README.md")) {
  const readme = read("README.md")
  readme.includes("scripts/publish.sh main")
    ? pass("README documents publish script")
    : fail("README documents publish script", "missing scripts/publish.sh usage")
}

if (existsSync("README.md")) {
  const readme = read("README.md")
  readme.includes("USAGE.md")
    ? pass("README links usage guide")
    : fail("README links usage guide", "missing USAGE.md link")
}

if (existsSync("USAGE.md")) {
  const usage = read("USAGE.md")
  const requiredPromptMarkers = [
    "帮我做一个个人任务管理工具",
    "请根据下面 PRD",
    "继续",
    "新增需求：给任务管理工具增加通知中心",
    "新增需求：给这个已有项目增加登录功能",
  ]
  const missing = requiredPromptMarkers.filter((marker) => !usage.includes(marker))
  missing.length === 0
    ? pass("USAGE includes core example prompts")
    : fail("USAGE includes core example prompts", `missing: ${missing.join(", ")}`)
}

for (const [path, expectedMode] of [
  [".codeartsdoer/agents/coordinator.md", "primary"],
  [".codeartsdoer/agents/initializer.md", "subagent"],
  [".codeartsdoer/agents/coder.md", "subagent"],
  [".codeartsdoer/agents/verifier.md", "subagent"],
]) {
  if (!existsSync(path)) continue
  const content = read(path)
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatter) {
    fail(`agent frontmatter: ${path}`, "missing frontmatter block")
    continue
  }
  const hasDescription = /^description:/m.test(frontmatter[1])
  const modeMatch = frontmatter[1].match(/^mode:\s*(\w+)/m)
  const modeOk = modeMatch?.[1] === expectedMode
  hasDescription && modeOk
    ? pass(`agent frontmatter: ${path}`)
    : fail(`agent frontmatter: ${path}`, `expected description and mode: ${expectedMode}`)
}

if (existsSync(".codeartsdoer/plugins/inject-subagent-context.js") && existsSync(".codeartsdoer/agents/coordinator.md")) {
  const plugin = read(".codeartsdoer/plugins/inject-subagent-context.js")
  const coordinator = read(".codeartsdoer/agents/coordinator.md")
  const pluginHasCoderContract = /coder:\s*\/\^Implement feature/.test(plugin)
  const pluginHasVerifierContract = /verifier:\s*\/\^Verify features\?/.test(plugin)
  const coordinatorHasCoderContract = /coder:\s+`Implement feature <N>: <description>`/.test(coordinator)
  const coordinatorHasVerifierContract = /verifier:\s+`Verify features: <id1>, <id2>`/.test(coordinator)

  pluginHasCoderContract && pluginHasVerifierContract
    ? pass("plugin prompt contract regexes exist")
    : fail("plugin prompt contract regexes exist", "missing coder or verifier regex")

  coordinatorHasCoderContract && coordinatorHasVerifierContract
    ? pass("coordinator documents plugin prompt contracts")
    : fail("coordinator documents plugin prompt contracts", "documented contract drifted from expected format")
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
