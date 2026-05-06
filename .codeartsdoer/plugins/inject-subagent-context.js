/**
 * Subagent Context Injection Plugin
 *
 * Intercepts the Task tool when coordinator dispatches initializer/coder
 * subagents and injects my-harness state files into the prompt.
 *
 * Injection is driven by JSONL declaration files:
 *   .codeartsdoer/config/inject-coder.jsonl     — coder context layers
 *   .codeartsdoer/config/inject-verifier.jsonl  — verifier context layers
 * If a JSONL is missing, no context is injected for that agent type.
 *
 * @author zhyi
 * @license MIT
 */

import { HarnessContext, debugLog } from "../lib/harness-context.js"

const SUBAGENT_TYPES = ["initializer", "coder", "verifier"]

// ─── JSONL Layer Dispatcher ─────────────────────────────────────────

/**
 * Each layer defines: method name, args (with $variable substitution),
 * and a format function that produces the markdown section string.
 * Return null from fmt() to skip the layer silently.
 */
const LAYERS = {
  // ── Initializer layers ────────────────────────────────────────────
  init_spec: {
    method: "getInitializerSpec",
    args: [],
    fmt: (r) => `## Spec Summary (compiled from docs/app_spec.txt)\n\n\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\``
  },
  init_features: {
    method: "getInitializerFeatureState",
    args: [],
    fmt: (r) => {
      if (!r || r.mode !== "APPEND") return null
      return `## docs/feature_list.json (already exists — APPEND mode)\n\nmax(id) = ${r.maxId}; new entries must start at id ${r.maxId + 1}. Do NOT modify any existing entry.\n\n\`\`\`json\n${r.content}\n\`\`\``
    }
  },

  // ── Coder layers ──────────────────────────────────────────────────
  progress: {
    method: "getFeatureProgress", args: [],
    fmt: (r) => { const pct = r.total > 0 ? Math.round((r.passing / r.total) * 100) : 0; return `## Progress\n\n${r.passing}/${r.total} features passing (${pct}%)` }
  },
  current_feature: {
    method: null,
    fmt: (_, v) => `## Current Feature (THIS is what you implement this session)\n\n\`\`\`json\n${JSON.stringify(v.current, null, 2)}\n\`\`\``
  },
  work_packet: {
    method: "buildFeatureWorkPacket", args: ["$current"],
    fmt: (r) => `## Feature Work Packet\n\n\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\``
  },
  spec_slice: {
    method: "getAppSpecSlices", args: ["$category"],
    fmt: (r, v) => `## docs/app_spec.txt (relevant sections for "${v.category}")\n\n${r}`
  },
  architecture: {
    method: "getArchitectureForCoder", args: ["$category"],
    fmt: (r) => `## ARCHITECTURE.md\n\n${r}`,
    fallback: "getInitializerSpec",
    fallbackFmt: (r) => `## Project Skeleton (ARCHITECTURE.md not available)\n\n\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\``
  },
  history: {
    method: "getCategoryHistoryForCoder", args: ["$category"],
    fmt: (r) => {
      if (!r || !r.passed_features.length) return null
      const lines = [`## Same-Category History`]
      lines.push("Already implemented in this category:")
      for (const f of r.passed_features) lines.push(`- feature ${f.id}: ${f.description}${f.test_file ? ` (tests: ${f.test_file})` : ""}`)
      if (r.recent_files.length > 0) { lines.push(`\nFiles touched recently:`); for (const f of r.recent_files.slice(0, 8)) lines.push(`- ${f}`) }
      if (r.sample_files.length > 0) { lines.push(`\nCode samples (head 300 lines each):`); for (const s of r.sample_files) lines.push(`\n### \`${s.path}\`\n\`\`\`\n${s.head}\n\`\`\``) }
      return lines.join("\n")
    }
  },
  knowledge: {
    method: "getRelevantKnowledge", args: ["$category"],
    fmt: (r, v) => `## Relevant Knowledge (past decisions/gotchas/failures in "${v.category}")\n\n${r}`
  },
  explore: {
    method: null,
    fmt: () => `## Exploration License\n\nThe injected context is your primary source. Use it first — spec, work packet, architecture, and history are all here. Avoid re-reading files already present in context. Only grep for specific file lookups if absolutely blocked (1-2 reads max).`
  },

  // ── Verifier layers ───────────────────────────────────────────────
  bootstrap_warning: {
    method: "isBootstrapExistingFromSpec", args: [],
    fmt: (r) => r ? `## ⚠ BOOTSTRAP_EXISTING Mode\n\nThis iteration adds new functionality onto a pre-existing codebase. docs/app_spec.txt intentionally describes ONLY the new features; existing code outside scope is not specified. When checking REVIEW (STEP 3), do NOT flag missing tests, missing endpoints, or "scope gaps" for code that predates this iteration. Only verify NEW features under verification match spec. Use git log/blame to confirm what's pre-existing vs. just-added.` : null
  },
  targets: {
    method: null,
    fmt: (_, v) => { const h = v.targets.length > 1 ? `## Features Under Verification (window of ${v.targets.length})` : "## Feature Under Verification"; return `${h}\n\n\`\`\`json\n${JSON.stringify(v.targets, null, 2)}\n\`\`\`` }
  },
  spec_slices: {
    method: "getAppSpecSlices", args: ["$categories"], multi: true, multiKey: "categories",
    fmt: (r, v) => `### category: ${v.cat}\n\n${r}`
  },
  arch_verifier: {
    method: "getArchitectureForVerifier", args: ["$categories"],
    fmt: (r) => `## ARCHITECTURE.md (use **Architecture Invariant** lines as REVIEW reference)\n\n${r}`
  },
  window_diff: {
    method: "getLastCommitDiff", args: ["$windowSize"],
    fmt: (r, v) => { const label = v.windowSize > 1 ? `Window Diff (last ${v.windowSize} commits — one per coder)` : "Last Commit Diff (what coder changed)"; return `## ${label}\n\n\`\`\`diff\n${r}\n\`\`\`` }
  },
}

function _resolveArgs(argDefs, vars) {
  return argDefs.map(a => {
    if (a === "$current") return vars.current
    if (a === "$category") return vars.current?.category
    if (a === "$categories") return vars.categories
    if (a === "$windowSize") return Math.max((vars.targets || []).length, 1)
    return a
  })
}

function _resolveLayer(ctx, layerName, vars) {
  const def = LAYERS[layerName]
  if (!def) return null

  // Multi layers iterate over a collection (e.g. spec_slices per category)
  if (def.multi) {
    const items = vars[def.multiKey]
    if (!items || !items.length) return null
    const parts = []
    for (const item of items) {
      const result = ctx[def.method](item)
      if (result) parts.push(def.fmt(result, { ...vars, cat: item }))
    }
    return parts.length > 0 ? parts.join("\n\n") : null
  }

  if (def.method) {
    const args = _resolveArgs(def.args, vars)
    try {
      let result = ctx[def.method](...args)
      if (!result && def.fallback) {
        result = ctx[def.fallback]()
        if (result && def.fallbackFmt) return def.fallbackFmt(result)
        return null
      }
      if (!result) return null
      return def.fmt(result, vars)
    } catch (e) {
      debugLog("inject", `_resolveLayer ${layerName} error:`, e.message)
      return null
    }
  }

  return def.fmt(null, vars)
}

function _buildContextFromJsonl(ctx, jsonlPath, prompt) {
  try {
    const content = ctx.readProjectFile(jsonlPath)
    if (!content) return null

    const promptIds = ctx.extractFeatureIdsFromPrompt(prompt)
    const current = promptIds.length > 0 ? ctx.getFeatureById(promptIds[0]) : ctx.getCurrentFeature()
    const targets = promptIds.length > 0 ? promptIds.map(id => ctx.getFeatureById(id)).filter(Boolean) : []
    const categories = [...new Set(targets.map(t => t?.category).filter(Boolean))]
    const isFirstInCat = current && !(ctx.getCategoryHistoryForCoder(current.category)?.passed_features?.length)
    const vars = { current, targets, categories, isFirstInCategory: isFirstInCat, windowSize: Math.max(targets.length, 1) }

    const parts = []
    const lines = content.split("\n").map(l => l.trim()).filter(Boolean)
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (!entry.layer) continue
        const part = _resolveLayer(ctx, entry.layer, vars)
        if (part) parts.push(part)
      } catch { /* skip malformed line */ }
    }

    return parts.length > 0 ? parts.join("\n\n---\n\n") : null
  } catch (e) {
    debugLog("inject", "_buildContextFromJsonl error:", e.message)
    return null
  }
}

// ─── Context Builders ───────────────────────────────────────────────

function buildCoderContext(ctx, prompt) {
  return _buildContextFromJsonl(ctx, ".codeartsdoer/config/inject-coder.jsonl", prompt)
}

function buildVerifierContext(ctx, prompt) {
  return _buildContextFromJsonl(ctx, ".codeartsdoer/config/inject-verifier.jsonl", prompt)
}

function buildInitializerContext(ctx, prompt) {
  return _buildContextFromJsonl(ctx, ".codeartsdoer/config/inject-initializer.jsonl", prompt)
}

// ─── Prompt Sanitizer ────────────────────────────────────────────────

/**
 * Validate coordinator prompt against the contract format.
 * 
 * CONTRACT:
 *   coder:    "Implement feature <N>: <description>" (single line)
 *   verifier: "Verify features: <id1>, <id2>"        (single line)
 * 
 * Non-matching prompts pass through but trigger a debug warning.
 * Multi-line prompts are truncated to first line.
 */
const PROMPT_CONTRACT = {
  coder:    /^Implement feature (\d+):/i,
  verifier: /^Verify features?:/i
}

function sanitizePrompt(agentType, prompt) {
  const contract = PROMPT_CONTRACT[agentType]
  if (!contract) return prompt

  const firstLine = prompt.split("\n")[0].trim()
  if (contract.test(firstLine)) {
    if (firstLine.length < prompt.length) {
      debugLog("inject", `sanitize: truncated multi-line ${agentType} prompt to first line only (${prompt.length - firstLine.length} chars stripped)`)
    }
    return firstLine
  }

  debugLog("inject", `sanitize: ${agentType} prompt does NOT match contract format "${contract}". Prompt starts: "${firstLine.slice(0, 80)}..."`)
  return firstLine
}

// ─── Prompt Templates ───────────────────────────────────────────────

function buildPrompt(agentType, originalPrompt, context) {
  if (!context) return originalPrompt

  const templates = {
    initializer: `# Initializer Task

You are the initializer subagent. One-shot run: do NOT implement features, only set up the project skeleton.

## Injected Context

${context}

---

## Your Task

${originalPrompt}

When done, return INIT_DONE.`,

    coder: `# Coder Task

You are the coder subagent. Implement ONE feature, verify it locally, commit it, and return.
Do NOT edit feature_list.json passes — verifier output drives the plugin's pass/fail update.
This is a fresh context window — no memory of previous sessions.

## Injected Context

${context}

---

## Your Task

${originalPrompt}

When done, return FEATURE_COMPLETE.`,

    verifier: `# Verifier Task

You are the verifier subagent. Independently verify that the feature coder just
committed is actually complete. Do NOT write code — your output is
either VERIFY_PASS or VERIFY_FAIL.

Run 4 checks: TEST + ALIGNMENT + REVIEW + SMOKE.

## Injected Context

${context}

---

## Your Task

${originalPrompt}

When done, return either:
- VERIFY_PASS: feature <id>
- VERIFY_FAIL: feature <id>: <one-line reason>`
  }

  return templates[agentType] || originalPrompt
}

// ─── Plugin Export ──────────────────────────────────────────────────

export default async ({ directory }) => {
  const ctx = new HarnessContext(directory)
  debugLog("inject", "Plugin loaded, directory:", directory)

  return {
    "tool.execute.before": async (input, output) => {
      try {
        debugLog("inject", "tool.execute.before called, tool:", input?.tool)

        const toolName = input?.tool?.toLowerCase()
        if (toolName !== "task") return

        const args = output?.args || {}
        const subagentType = args.subagent_type
        const originalPrompt = sanitizePrompt(subagentType, args.prompt || "")

        debugLog("inject", "Task tool called, subagent_type:", subagentType)

        if (!SUBAGENT_TYPES.includes(subagentType)) {
          debugLog("inject", "Skipping - unsupported subagent_type")
          return
        }

        const contextBuilders = {
          initializer: (ctx, p) => buildInitializerContext(ctx, p),
          coder: buildCoderContext,
          verifier: buildVerifierContext
        }
        const context = contextBuilders[subagentType](ctx, originalPrompt)

        if (!context) {
          debugLog("inject", "No context to inject")
          return
        }

        const newPrompt = buildPrompt(subagentType, originalPrompt, context)

        output.args = {
          ...args,
          prompt: newPrompt
        }

        debugLog("inject", "Injected context for", subagentType, "prompt length:", newPrompt.length)
      } catch (error) {
        debugLog("inject", "Error in tool.execute.before:", error.message, error.stack)
      }
    },
    "tool.execute.after": async (input, output) => {
      try {
        const toolName = input?.tool?.toLowerCase()
        if (toolName !== "task") return

        const resultText = output?.output || output?.result || ""
        if (!resultText || typeof resultText !== "string") return

        const args = output?.args || input?.args || {}
        const subagentType = args.subagent_type
        const prompt = args.prompt || ""
        const promptIds = ctx.extractFeatureIdsFromPrompt(prompt)
        const current = promptIds.length > 0
          ? ctx.getFeatureById(promptIds[0])
          : ctx.getCurrentFeature()

        // ── Coder: update code-index ──────────────────────────────
        if (subagentType === "coder") {
          const filesReadMatch = resultText.match(/FILES_READ:\s*(.+)/i)
          const filesChangedMatch = resultText.match(/FILES_CHANGED:\s*(.+)/i)

          if (filesChangedMatch || filesReadMatch) {
            const changedFiles = filesChangedMatch
              ? filesChangedMatch[1].split(",").map(f => f.trim()).filter(Boolean)
              : []
            const readFiles = filesReadMatch
              ? filesReadMatch[1].split(",").map(f => f.trim()).filter(Boolean)
              : []

            if (current && (changedFiles.length > 0 || readFiles.length > 0)) {
              ctx.updateCodeIndex(current.category, changedFiles, readFiles)
            }
          }

          // ── Coder: capture KNOWLEDGE ───────────────────────────
          const knowledgeRe = /KNOWLEDGE:\s*##\s+(Decision|Gotcha|Convention):\s*(.+?)(?:\s*\|\s*body:\s*(.+))?\s*$/gim
          let km
          while ((km = knowledgeRe.exec(resultText)) !== null) {
            const ktype = km[1]
            const ktitle = km[2].trim()
            const kbody = (km[3] || "").trim()
            const cat = current?.category || "global"
            const iter = current?.iter || 1
            ctx.appendKnowledge(ktype, ktitle, cat, iter, kbody)
          }
        }

        // ── Verifier: auto-write pass/fail ────────────────────────
        if (subagentType === "verifier") {
          // VERIFY_PASS: feature N
          const passRe = /VERIFY_PASS:\s*feature\s+([\w-]+)/gi
          let matchedPass = false
          let pm
          while ((pm = passRe.exec(resultText)) !== null) {
            matchedPass = true
            const fid = pm[1]
            const id = /^\d+$/.test(fid) ? parseInt(fid, 10) : fid
            ctx.markFeaturePassed(id)
          }

          // VERIFY_PASS without explicit feature ID: mark current
          if (!matchedPass && /VERIFY_PASS\b/i.test(resultText)) {
            if (current) ctx.markFeaturePassed(current.id)
          }

          // VERIFY_FAIL: feature N: reason
          const failRe = /VERIFY_FAIL:\s*feature\s+([\w-]+):\s*(.+)/gi
          let fm
          while ((fm = failRe.exec(resultText)) !== null) {
            const fid = fm[1]
            const freason = fm[2].trim()
            const feat = ctx.getFeatureById(/^\d+$/.test(fid) ? parseInt(fid, 10) : fid)
            const cat = feat?.category || "global"
            const iter = feat?.iter || 1

            if (feat) {
              ctx.markFeatureFailed(typeof feat.id === "number" ? feat.id : fid)
            }

            ctx.appendKnowledge("Failure", `feature ${fid}: ${freason}`, cat, iter)
          }
        }
      } catch (error) {
        debugLog("inject", "Error in tool.execute.after:", error.message)
      }
    }
  }
}
