/**
 * Harness Context Manager
 *
 * Reads my-harness state files from workspace root for plugin-driven
 * context injection.
 *
 * LAYOUT CONVENTION:
 *   workspace/                ← this.directory == this.projectDir
 *     .codeartsdoer/          ← agents, plugins, lib
 *     docs/                   ← runtime artifacts (app_spec.txt, feature_list.json, code-index.json)
 *     src/ | server/ | tests/ ← application code
 *     ARCHITECTURE.md
 *     init.sh
 *     package.json
 *
 * One harness, one project. Workspace root IS the project root.
 *
 * @author zhyi
 * @license MIT
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, statSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"

let DEBUG_LOG_PATH = null

export function configureDebugLog(directory) {
  DEBUG_LOG_PATH = directory
    ? join(directory, ".codeartsdoer-plugin-debug.log")
    : null
}

export function debugLog(prefix, ...args) {
  if (!DEBUG_LOG_PATH) return
  const timestamp = new Date().toISOString()
  const msg = `[${timestamp}] [${prefix}] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" ")}\n`
  try {
    appendFileSync(DEBUG_LOG_PATH, msg)
  } catch {
    // ignore
  }
}

export class HarnessContext {
  /**
   * @param {string} directory - workspace root (where .codeartsdoer/ and AGENTS.md live)
   *
   * projectDir IS the workspace root — one harness, one project.
   * All readProjectFile paths resolve relative to projectDir (workspace root).
   */
  constructor(directory) {
    this.directory = directory
    this.projectDir = directory
    configureDebugLog(this.directory)
    debugLog("context", "HarnessContext initialized", { directory, projectDir: this.projectDir })
  }

  readFile(filePath) {
    try {
      if (existsSync(filePath)) {
        return readFileSync(filePath, "utf-8")
      }
    } catch {
      // ignore
    }
    return null
  }

  readProjectFile(relativePath) {
    return this.readFile(join(this.projectDir, relativePath))
  }

  /**
   * Read docs/feature_list.json and return progress stats.
   * Returns { total, passing, features } or null if file missing/invalid.
   */
  getFeatureProgress() {
    const content = this.readProjectFile("docs/feature_list.json")
    if (!content) return null
    try {
      const features = JSON.parse(content)
      if (!Array.isArray(features)) return null
      const passing = features.filter(f => f && f.passes === true).length
      return { total: features.length, passing, features }
    } catch (e) {
      debugLog("context", "feature_list.json parse error:", e.message)
      return null
    }
  }

  /**
   * Set passes=true for a feature in feature_list.json.
   * No-op if feature not found or file missing.
   */
  markFeaturePassed(featureId) {
    this._updateFeaturePasses(featureId, true)
  }

  /**
   * Set passes=false for a feature in feature_list.json.
   * No-op if feature not found or file missing.
   */
  markFeatureFailed(featureId) {
    this._updateFeaturePasses(featureId, false)
  }

  _updateFeaturePasses(featureId, value) {
    try {
      const filePath = join(this.projectDir, "docs/feature_list.json")
      if (!existsSync(filePath)) return
      const raw = readFileSync(filePath, "utf-8")
      const features = JSON.parse(raw)
      if (!Array.isArray(features)) return
      const feat = features.find(f => f && f.id === featureId)
      if (!feat) return
      feat.passes = value
      writeFileSync(filePath, JSON.stringify(features, null, 2))
      debugLog("context", "markFeature", { id: featureId, passes: value })
    } catch (e) {
      debugLog("context", "_updateFeaturePasses error:", e.message)
    }
  }

  /**
   * Return the first feature with passes:false, or null if all pass / file missing.
   */
  getCurrentFeature() {
    const progress = this.getFeatureProgress()
    if (!progress) return null
    return progress.features.find(f => f && f.passes === false) || null
  }

  /**
   * Return next N upcoming features (passes:false) AFTER the current one,
   * each as { id, description }. Used to give the coder boundary awareness
   * without dumping the whole feature_list.
   */
  getUpcomingFeatures(n = 5) {
    const progress = this.getFeatureProgress()
    if (!progress) return null
    const failing = progress.features.filter(f => f && f.passes === false)
    return failing.slice(1, 1 + n).map(f => ({
      id: f.id,
      description: f.description || ""
    }))
  }

  /**
   * Return { recentCommits, dirty } or null if not a git repo / git unavailable.
   */
  getGitInfo() {
    try {
      // Git repo lives at code level, not necessarily workspace root
      const cwd = existsSync(join(this.projectDir, ".git")) ? this.projectDir : this.directory
      const recentCommits = execSync("git log --oneline -10", {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim()
      const status = execSync("git status --porcelain", {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim()
      return { recentCommits, dirty: status.length > 0 }
    } catch (e) {
      debugLog("context", "getGitInfo error:", e.message)
      return null
    }
  }

  /**
   * Best-effort fallback for "the feature most likely just passed" — only used
   * when the verifier prompt names no feature ids (manual / single-feature
   * invocation). The authoritative source is always the prompt; coordinator
   * lists every window id explicitly.
   *
   * Heuristic: scan from the first passes:false backwards and return the
   * nearest passes:true. Correct only under the assumption that coordinator
   * dispatches strictly in feature_list order with no false→true→false
   * flapping. Safe to be wrong here — wrong target just produces a less
   * relevant spec slice; the verifier still reads feature_list itself.
   *
   * Returns the feature object, or null.
   */
  getMostRecentlyPassedFeature() {
    const progress = this.getFeatureProgress()
    if (!progress) return null
    const firstFailingIdx = progress.features.findIndex(f => f && f.passes === false)
    const searchEnd = firstFailingIdx === -1 ? progress.features.length : firstFailingIdx
    for (let i = searchEnd - 1; i >= 0; i--) {
      if (progress.features[i] && progress.features[i].passes === true) {
        return progress.features[i]
      }
    }
    return null
  }

  /**
   * Return the diff of the last `n` commits (HEAD~n..HEAD).
   * `n` defaults to 1 (single-feature/coder dispatch).
   * Verifier in window mode passes `n` = window size so it sees every coder's commit.
   * If repo has fewer than `n` commits, falls back to diff against the empty tree.
   */
  getLastCommitDiff(n = 1) {
    const count = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
    const cwd = existsSync(join(this.projectDir, ".git")) ? this.projectDir : this.directory
    try {
      return execSync(`git diff HEAD~${count} HEAD 2>/dev/null || git diff --root HEAD`, {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1024 * 1024
      }).trim() || null
    } catch (e) {
      debugLog("context", "getLastCommitDiff error:", e.message)
      return null
    }
  }

  /**
   * Extract unique numeric feature ids from a coordinator-issued prompt.
   * Coordinator templates always reference features as `feature <N>` (coder
   * dispatch: `Implement feature 5: ...`; verifier window: `feature 5 (cat): ...,
   * feature 6 (cat): ...`). Any other id usage is a coordinator bug.
   * Returns an array of unique ids in first-appearance order. Empty array if none.
   */
  extractFeatureIdsFromPrompt(prompt) {
    if (!prompt || typeof prompt !== "string") return []
    const ids = []
    const seen = new Set()
    const add = (raw) => {
      if (!raw) return
      const id = /^\d+$/.test(raw) ? parseInt(raw, 10) : raw
      if (!seen.has(id)) { seen.add(id); ids.push(id) }
    }

    // Match coder format: "Implement feature 5: ..."
    const featRe = /feature\s+([\w-]+)/gi
    let m
    while ((m = featRe.exec(prompt)) !== null) add(m[1])

    // Match verifier format: "Verify features: 2, 3" or "Verify features: feature 2, feature 3"
    if (ids.length === 0) {
      const verifyRe = /Verify\s+features?\s*:\s*(.+)/i
      const vm = prompt.match(verifyRe)
      if (vm) {
        const idRe = /([\w-]+)/g
        let im
        while ((im = idRe.exec(vm[1])) !== null) add(im[1])
      }
    }

    return ids
  }

  /**
   * Lookup a feature by id in feature_list.json. Returns the feature object
   * or null if not found / list missing.
   */
  getFeatureById(id) {
    const progress = this.getFeatureProgress()
    if (!progress) return null
    return progress.features.find(f => f && f.id === id) || null
  }

  /**
   * Extract only the spec sections relevant to a given feature category.
   *
   * Instead of injecting the entire docs/app_spec.txt (~27K chars), this
   * method slices out only the parts the coder/verifier actually needs:
   *   - The matching <core_features> child node (named after `category`)
   *   - The entire <database_schema> (always needed — schema is global)
   *   - The matching <api_endpoints_summary> child node (named after `category`)
   *   - <ui_layout> and <design_system> (always included — caller decides relevance)
   *
   * **Convention required for slicing to work:**
   *   - generate-app-spec: <core_features>/<api_endpoints_summary> children must
   *     be named in snake_case, suitable for direct use as feature.category
   *   - initializer: feature.category in feature_list.json MUST equal the spec
   *     child node name (e.g. category="task_management" ⇔ spec has
   *     <core_features><task_management>...</task_management></core_features>)
   *
   * If the convention is violated (no matching tag found), returns null and
   * the caller falls back to full-file injection. No project-specific mappings
   * are hardcoded here — adding one would defeat the purpose of a general
   * harness and silently degrade for any new project with different categories.
   *
   * @param {string} category - feature.category from feature_list.json
   * @returns {string|null} sliced XML sections, or null if no relevant sections found
   */
  getAppSpecSlices(category) {
    const content = this.readProjectFile("docs/app_spec.txt")
    if (!content || !category) return null

    const parts = []

    // 1. core_features: extract the child node named exactly `category`
    const coreContent = this._extractTagContent(content, "core_features")
    if (coreContent) {
      const featureContent = this._extractTagContent(coreContent, category)
      if (featureContent) {
        parts.push(`<core_features>\n  <${category}>${featureContent}</${category}>\n</core_features>`)
      }
    }

    // 2. database_schema: always include (schema is shared across all features)
    const schemaContent = this._extractTagContent(content, "database_schema")
    if (schemaContent) {
      parts.push(`<database_schema>${schemaContent}</database_schema>`)
    }

    // 3. api_endpoints_summary: extract the child node named exactly `category`
    const apiContent = this._extractTagContent(content, "api_endpoints_summary")
    if (apiContent) {
      const apiGroupContent = this._extractTagContent(apiContent, category)
      if (apiGroupContent) {
        parts.push(`<api_endpoints_summary>\n  <${category}>${apiGroupContent}</${category}>\n</api_endpoints_summary>`)
      }
    }

    // 4. UI sections: always include (caller decides relevance per agent)
    //    Removed previous isUIFeature() heuristic — it only matched "dashboard"
    //    and silently dropped UI sections for category_management/transaction
    //    UI features. Cost of always-include is acceptable; cost of false-negative
    //    isUIFeature was UI features missing design context entirely.
    const uiLayout = this._extractTagContent(content, "ui_layout")
    if (uiLayout) {
      parts.push(`<ui_layout>${uiLayout}</ui_layout>`)
    }
    const designSystem = this._extractTagContent(content, "design_system")
    if (designSystem) {
      parts.push(`<design_system>${designSystem}</design_system>`)
    }

    return parts.length > 0 ? parts.join("\n\n") : null
  }

  /**
   * Extract the inner content of a named XML tag.
   * Handles multi-line content with proper indentation preservation.
   * Tolerates arbitrary attributes on the opening tag (e.g. `<step number="1">`).
   */
  _extractTagContent(xml, tagName) {
    const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, "i")
    const m = xml.match(re)
    return m ? m[1] : null
  }

  /**
   * Return the initializer's feature_list state for CREATE vs APPEND detection.
   * Returns { mode: "CREATE" } if no feature_list.json, or
   * { mode: "APPEND", maxId, content } if it exists.
   */
  getInitializerFeatureState() {
    const content = this.readProjectFile("docs/feature_list.json")
    if (!content) return { mode: "CREATE" }
    const maxId = this.getMaxFeatureId()
    return { mode: "APPEND", maxId, content }
  }

  /**
   * Return the highest feature id in feature_list.json, or 0 if list missing/empty.
   * Used by initializer APPEND mode to know where to start new id sequence.
   */
  getMaxFeatureId() {
    const progress = this.getFeatureProgress()
    if (!progress || progress.features.length === 0) return 0
    return progress.features.reduce(
      (max, f) => (typeof f.id === "number" && f.id > max ? f.id : max),
      0
    )
  }

  /**
   * Heuristic check for "non-trivial code already in this directory".
   * Used by mode detection to distinguish empty/skeleton from existing project.
   * Looks in `this.projectDir` (NOT workspace root) for code signs.
   */
  hasExistingCode() {
    const codeDirs = ["src", "server", "app", "components", "lib", "packages", "client"]
    for (const d of codeDirs) {
      const p = join(this.projectDir, d)
      try { if (statSync(p).isDirectory()) return true } catch { /* missing */ }
    }
    // package.json at project level (not workspace root .codeartsdoer/ package.json)
    const pkgPath = join(this.projectDir, "package.json")
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
        if (Object.keys(deps).length > 0) return true
      } catch { /* malformed */ }
    }
    return false
  }

  /**
   * Coordinator Step 0 mode detection. Pure read; never mutates state.
   *
   * Modes:
   *   GREENFIELD          — empty workspace; run full pipeline from scratch
   *   RESUME              — spec + feature_list with passes:false items remain
   *   NEW_ITERATION       — explicit user signal + spec already exists
   *   BOOTSTRAP_EXISTING  — explicit user signal + non-trivial code, no spec
   *   ABORT               — ambiguous / contradictory; reason explains why
   *
   * `userPrompt` is the user's first message to coordinator (raw text).
   * Iteration intent keywords: 迭代 / 新需求 / 新增功能 / iterate / add feature.
   */
  detectMode(userPrompt) {
    const hasSpec = !!this.readProjectFile("docs/app_spec.txt")
    const progress = this.getFeatureProgress()
    const hasFeatureList = !!progress && progress.features.length > 0
    const hasFailing = hasFeatureList && progress.features.some(f => !f.passes)
    const hasCode = this.hasExistingCode()
    const iterRe = /(迭代|新需求|新增需求|新增功能|新增|iterate\b|add\s+feature)/i
    const hasIterKeyword = typeof userPrompt === "string" && iterRe.test(userPrompt)

    const nextIter = this._countGitIterTags() + 1

    if (hasIterKeyword) {
      if (hasSpec) {
        return {
          mode: "NEW_ITERATION",
          iterNumber: nextIter,
          reason: "user signaled iteration; spec exists"
        }
      }
      if (hasCode) {
        return {
          mode: "BOOTSTRAP_EXISTING",
          iterNumber: 1,
          reason: "user signaled iteration; existing code without spec"
        }
      }
      return {
        mode: "ABORT",
        iterNumber: 0,
        reason: "iteration intent detected but project is empty (no spec, no code)"
      }
    }

    if (!hasSpec && !hasCode) {
      return {
        mode: "GREENFIELD",
        iterNumber: 1,
        reason: "empty workspace"
      }
    }
    if (hasSpec && hasFailing) {
      return {
        mode: "RESUME",
        iterNumber: nextIter > 1 ? nextIter - 1 : 1,
        reason: `${progress.features.filter(f => !f.passes).length} features still passes:false`
      }
    }
    if (hasSpec && !hasFailing) {
      return {
        mode: "ABORT",
        iterNumber: nextIter,
        reason: `all features passing; to start a new iteration include 新增需求/iterate keyword`
      }
    }
    if (!hasSpec && hasCode) {
      return {
        mode: "ABORT",
        iterNumber: 0,
        reason: "existing code without spec; to bootstrap include 新增需求/iterate keyword"
      }
    }
    return { mode: "ABORT", iterNumber: 0, reason: "unhandled state" }
  }

  /**
   * Count git tags matching iter-* to determine the current iteration number.
   * Returns 0 if no tags found or git unavailable.
   */
  _countGitIterTags() {
    const cwd = existsSync(join(this.projectDir, ".git")) ? this.projectDir : this.directory
    try {
      const out = execSync("git tag --list 'iter-*'", {
        cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"]
      }).trim()
      return out ? out.split("\n").length : 0
    } catch { return 0 }
  }

  // ─── Injection trimming — shared helpers ─────────────────────────

  /**
   * Extract a markdown section from heading to the next heading of same level.
   * headingPattern can be a string (matched case-insensitively as heading text)
   * or a RegExp. e.g. _extractMdHeading(md, /^##\s+Bird's Eye View\s*$/m)
   *
   * Returns the heading content (without the heading line itself), or null.
   */
  _extractMdHeading(markdown, headingPattern) {
    try {
      if (!markdown || !headingPattern) return null
      const re = headingPattern instanceof RegExp
        ? headingPattern
        : new RegExp(`^#{1,6}\\s+${headingPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "im")
      const m = markdown.match(re)
      if (!m) return null
      const startIdx = m.index + m[0].length
      // Determine heading level from the match
      const levelMatch = m[0].match(/^(#{1,6})/)
      const level = levelMatch ? levelMatch[1].length : 2
      // Find the next heading of same or higher level
      const stopRe = new RegExp(`\n#{1,${level}}\\s`, "g")
      stopRe.lastIndex = startIdx
      const stopM = stopRe.exec(markdown)
      const endIdx = stopM ? stopM.index : markdown.length
      return markdown.slice(startIdx, endIdx).trim() || null
    } catch (e) {
      debugLog("context", "_extractMdHeading error:", e.message)
      return null
    }
  }

  /**
   * Compile a minimal JSON spec summary from docs/app_spec.txt for the
   * initializer subagent. The full XML spec is too large to inject into
   * a single context window — this compiler extracts only the structural
   * information the initializer actually needs.
   *
   * Returns a JSON object or null if spec missing.
   */
  getInitializerSpec() {
    const content = this.readProjectFile("docs/app_spec.txt")
    if (!content) return null

    const spec = {}

    // project_name
    const projectName = this._extractTagContent(content, "project_name")
    if (projectName) spec.project_name = projectName.trim()

    // technology_stack — only structural fields
    const techStack = this._extractTagContent(content, "technology_stack")
    if (techStack) {
      const frontend = this._extractTagContent(techStack, "frontend")
      const backend = this._extractTagContent(techStack, "backend")
      spec.tech_stack = {}
      const extractPort = (raw) => {
        if (!raw) return null
        const m = raw.match(/\d+/)
        return m ? parseInt(m[0], 10) : null
      }
      if (frontend) {
        spec.tech_stack.frontend = {
          framework: this._extractTagContent(frontend, "framework")?.trim() || "",
          styling: this._extractTagContent(frontend, "styling")?.trim() || "",
          state_management: this._extractTagContent(frontend, "state_management")?.trim() || "",
          routing: this._extractTagContent(frontend, "routing")?.trim() || "",
          port: extractPort(this._extractTagContent(frontend, "port"))
        }
      }
      if (backend) {
        spec.tech_stack.backend = {
          runtime: this._extractTagContent(backend, "runtime")?.trim() || "",
          database: this._extractTagContent(backend, "database")?.trim() || "",
          port: extractPort(this._extractTagContent(backend, "port"))
        }
      }
    }

    // scale — derived from implementation_steps count
    const stepsRaw = content.match(/<step\s+number=/gi)
    const stepCount = stepsRaw ? stepsRaw.length : 0
    spec.scale = stepCount <= 5 ? "simple" : stepCount <= 7 ? "medium" : "full"

    // categories — from <core_features> child tag names
    const coreFeatures = this._extractTagContent(content, "core_features")
    if (coreFeatures) {
      const catRe = /<(\w+)>/g
      const cats = []
      let m
      while ((m = catRe.exec(coreFeatures)) !== null) {
        if (!cats.includes(m[1])) cats.push(m[1])
      }
      spec.categories = cats
    }

    // features — from <implementation_steps>
    const implSteps = this._extractTagContent(content, "implementation_steps")
    if (implSteps) {
      const features = []
      const stepRe = /<step\s+number="(\d+)"[^>]*>([\s\S]*?)<\/step>/gi
      let s
      while ((s = stepRe.exec(implSteps)) !== null) {
        const number = parseInt(s[1], 10)
        const stepContent = s[2]
        const title = this._extractTagContent(stepContent, "title")?.trim() || ""
        const tasksRaw = this._extractTagContent(stepContent, "tasks")
        const tasks = tasksRaw
          ? tasksRaw.split("\n").map(l => l.replace(/^\s*-+\s*/, "").trim()).filter(Boolean)
          : []
        features.push({ number, title, tasks })
      }
      spec.features = features
    }

    // database — table names only (no column details)
    const dbSchema = this._extractTagContent(content, "database_schema")
    if (dbSchema) {
      const tablesContent = this._extractTagContent(dbSchema, "tables") || dbSchema
      const tableRe = /<(\w+)>/g
      const tables = []
      let t
      while ((t = tableRe.exec(tablesContent)) !== null) {
        if (!tables.includes(t[1])) tables.push(t[1])
      }
      spec.database = { tables }
    }

    // api_endpoints — route lists by group
    const apiSummary = this._extractTagContent(content, "api_endpoints_summary")
    if (apiSummary) {
      const apiGroups = {}
      const groupRe = /<(\w+)>([\s\S]*?)<\/\1>/gi
      let g
      while ((g = groupRe.exec(apiSummary)) !== null) {
        const groupName = g[1]
        const routes = g[2].split("\n")
          .map(l => l.replace(/^\s*-+\s*/, "").trim())
          .filter(l => l.length > 0)
        if (routes.length > 0) apiGroups[groupName] = routes
      }
      spec.api_endpoints = apiGroups
    }

    // ui_layout — main_structure only
    const uiLayout = this._extractTagContent(content, "ui_layout")
    if (uiLayout) {
      const main = this._extractTagContent(uiLayout, "main_structure")?.trim()
      if (main) spec.ui = { layout: main.replace(/\n\s*/g, " ") }
    }

    return spec
  }

  // ─── ARCHITECTURE.md Parser ────────────────────────────────────────

  _readArchitecture() {
    const content = this.readProjectFile("ARCHITECTURE.md")
    if (!content) {
      debugLog("context", "getArchitecture", "ARCHITECTURE.md not found")
      return null
    }
    const size = content.length
    if (size > 20 * 1024) {
      debugLog("context", "getArchitecture", `ARCHITECTURE.md large (${size} chars), consider splitting`)
    }
    return content
  }

  getArchitectureBirdsEye() {
    try {
      const content = this._readArchitecture()
      if (!content) return null
      return this._extractMdHeading(content, /^##\s+Bird.?'?s?\s*Eye\s+View\s*$/im)
    } catch (e) {
      debugLog("context", "getArchitectureBirdsEye error:", e.message)
      return null
    }
  }

  getArchitectureEntryPoints() {
    try {
      const content = this._readArchitecture()
      if (!content) return null
      return this._extractMdHeading(content, /^##\s+Entry\s+Points\s*$/im)
    } catch (e) {
      debugLog("context", "getArchitectureEntryPoints error:", e.message)
      return null
    }
  }

  getArchitectureModule(modulePath) {
    try {
      const content = this._readArchitecture()
      if (!content || !modulePath) return null
      // Find Code Map section first, then match ### heading by module path
      const codeMap = this._extractMdHeading(content, /^##\s+Code\s+Map\s*$/im)
      if (!codeMap) return null
      const lower = modulePath.toLowerCase()
      const sections = codeMap.split(/(?=^###\s+)/m)
      for (const section of sections) {
        const headerLine = section.split("\n")[0]
        if (headerLine && headerLine.toLowerCase().includes(lower)) {
          return section.trim()
        }
      }
      return null
    } catch (e) {
      debugLog("context", "getArchitectureModule error:", e.message)
      return null
    }
  }

  getArchitectureInvariants() {
    try {
      const content = this._readArchitecture()
      if (!content) return []
      const lines = content.split("\n")
      const invariants = []
      // Match **Architecture Invariant:** marker — the invariant text follows it
      const re = /\*\*Architecture\s+Invariant:\*\*\s*(.+)/i
      for (const line of lines) {
        const m = line.match(re)
        if (m && m[1].trim()) {
          invariants.push(m[1].trim())
        }
      }
      return [...new Set(invariants)]
    } catch (e) {
      debugLog("context", "getArchitectureInvariants error:", e.message)
      return []
    }
  }

  getArchitectureBoundaries() {
    try {
      const content = this._readArchitecture()
      if (!content) return []
      const lines = content.split("\n")
      const boundaries = []
      const re = /\*\*API\s+Boundary:\*\*\s*(.+)/i
      for (const line of lines) {
        const m = line.match(re)
        if (m && m[1].trim()) {
          boundaries.push(m[1].trim())
        }
      }
      return [...new Set(boundaries)]
    } catch (e) {
      debugLog("context", "getArchitectureBoundaries error:", e.message)
      return []
    }
  }

  getArchitectureCrossCutting(topic) {
    try {
      const content = this._readArchitecture()
      if (!content || !topic) return null
      // Find the Cross-Cutting Concerns section, then the ### topic subsection
      const ccSection = this._extractMdHeading(content, /^##\s+Cross[- ]?Cutting\s+Concerns?\s*$/im)
      if (!ccSection) return null
      const re = new RegExp(`^###\\s+${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im")
      const m = ccSection.match(re)
      if (!m) return null
      const startIdx = m.index + m[0].length
      const stopRe = /^###\s+/gm
      stopRe.lastIndex = startIdx
      const stopM = stopRe.exec(ccSection)
      const endIdx = stopM ? stopM.index : ccSection.length
      return ccSection.slice(startIdx, endIdx).trim() || null
    } catch (e) {
      debugLog("context", "getArchitectureCrossCutting error:", e.message)
      return null
    }
  }

  getArchitectureForCoder(modulePath) {
    try {
      const content = this._readArchitecture()
      if (!content) return null
      const size = content.length

      if (size <= 8000) {
        return content
      }

      const parts = []
      const birdEye = this.getArchitectureBirdsEye()
      if (birdEye) parts.push(`## Bird's Eye View\n\n${birdEye}`)

      const entryPoints = this.getArchitectureEntryPoints()
      if (entryPoints) parts.push(`## Entry Points\n\n${entryPoints}`)

      if (modulePath) {
        const modSection = this.getArchitectureModule(modulePath)
        if (modSection) parts.push(`## Code Map — ${modulePath}\n\n${modSection}`)
      }

      const invariants = this.getArchitectureInvariants()
      if (size <= 16000 && invariants.length > 0) {
        parts.push(`## Architecture Invariants\n\n${invariants.map(i => `- ${i}`).join("\n")}`)
        const boundaries = this.getArchitectureBoundaries()
        if (boundaries.length > 0) {
          parts.push(`## API Boundaries\n\n${boundaries.map(b => `- ${b}`).join("\n")}`)
        }
      } else if (size > 16000 && invariants.length > 0 && modulePath) {
        const lower = modulePath.toLowerCase()
        const filtered = invariants.filter(i => i.toLowerCase().includes(lower))
        if (filtered.length > 0) {
          parts.push(`## Architecture Invariants (relevant to ${modulePath})\n\n${filtered.map(i => `- ${i}`).join("\n")}`)
        }
      }

      return parts.length > 0 ? parts.join("\n\n") : null
    } catch (e) {
      debugLog("context", "getArchitectureForCoder error:", e.message)
      return null
    }
  }

  getArchitectureForVerifier(modulePaths) {
    try {
      const content = this._readArchitecture()
      if (!content) return null

      const parts = []
      const birdEye = this.getArchitectureBirdsEye()
      if (birdEye) parts.push(`## Bird's Eye View\n\n${birdEye}`)

      if (modulePaths && modulePaths.length > 0) {
        const uniqueModules = [...new Set(modulePaths)]
        const modParts = []
        for (const mp of uniqueModules) {
          const ms = this.getArchitectureModule(mp)
          if (ms) modParts.push(`### ${mp}\n\n${ms}`)
        }
        if (modParts.length > 0) parts.push(`## Code Map (verification window modules)\n\n${modParts.join("\n\n")}`)
      }

      const invariants = this.getArchitectureInvariants()
      let invText = invariants.map(i => `- ${i}`).join("\n")
      const MAX_SIZE = 5000
      let currentSize = parts.join("\n\n").length
      if (currentSize + invText.length > MAX_SIZE) {
        const available = MAX_SIZE - currentSize - 200
        if (available > 0) {
          invText = invText.substring(0, available) + "\n... (invariant list truncated)"
        } else {
          invText = "(invariant list skipped — context budget exceeded)"
        }
      }
      if (invText) parts.push(`## Architecture Invariants (REVIEW reference — check coder didn't violate these)\n\n${invText}`)

      const boundaries = this.getArchitectureBoundaries()
      const boundText = boundaries.map(b => `- ${b}`).join("\n")
      currentSize = parts.join("\n\n").length
      if (currentSize + boundText.length <= MAX_SIZE) {
        parts.push(`## API Boundaries\n\n${boundText}`)
      }

      const result = parts.join("\n\n")
      return result.length <= MAX_SIZE ? result : result.substring(0, MAX_SIZE - 50) + "\n\n... (truncated)"
    } catch (e) {
      debugLog("context", "getArchitectureForVerifier error:", e.message)
      return null
    }
  }

  // ─── Code Index ─────────────────────────────────────────────────────

  /**
   * Read docs/code-index.json. Returns parsed object or empty default.
   */
  getCodeIndex() {
    const content = this.readProjectFile("docs/code-index.json")
    if (!content) return { categories: {} }
    try { return JSON.parse(content) } catch { return { categories: {} } }
  }

  /**
   * Write code index to disk. Merges with existing if present.
   */
  _writeCodeIndex(index) {
    const filePath = join(this.projectDir, "docs/code-index.json")
    writeFileSync(filePath, JSON.stringify(index, null, 2))
  }

  /**
   * Update code-index from coder return strings (FILES_CHANGED / FILES_READ).
   * Extracted FILES_CHANGED paths are merged into the corresponding category's
   * last_touched and entrypoints lists. Dedupes and trims to 20 entries per list.
   */
  updateCodeIndex(category, changedFiles, readFiles) {
    if (!category) return
    const index = this.getCodeIndex()
    if (!index.categories[category]) {
      index.categories[category] = { entrypoints: [], tests: [], last_touched: [] }
    }
    const cat = index.categories[category]
    const cap = (arr, max) => [...new Set(arr)].slice(0, max)

    if (changedFiles && changedFiles.length > 0) {
      cat.last_touched = cap([...changedFiles, ...cat.last_touched], 20)
      const entrypoints = changedFiles.filter(f =>
        /(?:index\.(jsx?|tsx?)|routes?\/[^/]+\.(js|ts))$/.test(f))
      if (entrypoints.length > 0) {
        cat.entrypoints = cap([...new Set([...entrypoints, ...cat.entrypoints])], 20)
      }
    }
    if (readFiles && readFiles.length > 0) {
      cat.last_touched = cap([...readFiles, ...cat.last_touched], 20)
    }

    // Derive tests from feature_list entries in this category
    const progress = this.getFeatureProgress()
    if (progress) {
      cat.tests = progress.features
        .filter(f => f && f.category === category && f.test_file)
        .map(f => f.test_file)
        .slice(0, 20)
    }

    this._writeCodeIndex(index)
    debugLog("context", "updateCodeIndex", { category, last_touched: cat.last_touched.length })
  }

  // ─── Feature Work Packet ────────────────────────────────────────────

  /**
   * Build a minimal work packet for a coder. No more file-path guessing.
   * The "where to read/edit" is now answered by E/F-layer injection (history-based).
   */
  buildFeatureWorkPacket(feature) {
    if (!feature) return null
    const { id, category, is_ui, steps, description } = feature

    const testExt = is_ui ? ".test.jsx" : ".test.js"
    const testTarget = `tests/feature-${id}${testExt}`

    const commands = {
      focused_test: `npx vitest run ${testTarget}`,
      full_test: "npx vitest run"
    }

    const constraints = [
      "Do NOT modify id / category / is_ui / description / steps in feature_list.json",
      "Only change test_file in feature_list.json; verifier/plugin updates passes",
      "Write the test file at the path specified in test_target"
    ]

    return {
      feature_id: id,
      goal: description || `Implement feature ${id}`,
      category,
      is_ui,
      steps: steps || [],
      test_target: testTarget,
      commands,
      constraints
    }
  }

  // ─── Enhanced Mode Detection ──────────────────────────────────────

  /**
   * Enhanced mode detection with specMode.
   */
  detectModeEnhanced(userPrompt) {
    const base = this.detectMode(userPrompt)
    const hasSpec = !!this.readProjectFile("docs/app_spec.txt")
    const progress = this.getFeatureProgress()
    const hasFeatureList = !!progress && progress.features.length > 0

    if (hasSpec && !hasFeatureList) {
      return { ...base, mode: "GREENFIELD",
        reason: "spec exists but no feature_list — retry init" }
    }

    const specMode = (typeof userPrompt === "string" && userPrompt.length > 500)
      ? "FROM_DOCUMENT" : "FROM_INTERVIEW"

    return { ...base, specMode }
  }

  // ─── BOOTSTRAP_EXISTING Signal ─────────────────────────────────────

  /**
   * Returns true iff docs/app_spec.txt contains <existing_codebase_note> tag.
   * Replaces former isBootstrapExisting() that read iter manifest.
   */
  isBootstrapExistingFromSpec() {
    const content = this.readProjectFile("docs/app_spec.txt")
    if (!content) return false
    return /<existing_codebase_note\b/i.test(content)
  }

  // ─── Category History (E + F Layers) ───────────────────────────────

  /**
   * Return E-layer history for a coder working on `category`.
   * {
   *   passed_features: [{id, description, test_file}, ...],
   *   recent_files: [...],
   *   sample_files: [{path, head}, ...]
   * }
   * Returns null if no history (first feature in this category).
   */
  getCategoryHistoryForCoder(category, sampleN = 3, headLines = 300) {
    try {
      const progress = this.getFeatureProgress()
      if (!progress) return null

      const passedFeatures = progress.features.filter(
        f => f && f.category === category && f.passes === true
      )
      const idx = this.getCodeIndex()
      const catIdx = idx.categories[category] || {}
      const recentFiles = (catIdx.last_touched || []).slice(0, 8)

      const sampleFiles = []
      if (recentFiles.length > 0) {
        const toSample = recentFiles.slice(0, sampleN)
        for (const relPath of toSample) {
          const content = this.readProjectFile(relPath)
          if (content) {
            const lines = content.split("\n")
            sampleFiles.push({
              path: relPath,
              head: lines.slice(0, headLines).join("\n")
            })
          }
        }
      }

      if (passedFeatures.length === 0 && recentFiles.length === 0) return null

      return {
        passed_features: passedFeatures.map(f => ({
          id: f.id,
          description: f.description || "",
          test_file: f.test_file || null
        })),
        recent_files: recentFiles,
        sample_files: sampleFiles
      }
    } catch (e) {
      debugLog("context", "getCategoryHistoryForCoder error:", e.message)
      return null
    }
  }

  // ─── Knowledge Base ────────────────────────────────────────────────

  /**
   * Append a knowledge entry to docs/knowledge.md.
   * Creates the file with header if it doesn't exist.
   */
  appendKnowledge(type, title, category, iter, body) {
    try {
      const filePath = join(this.projectDir, "docs/knowledge.md")
      const c = category || "global"
      const i = iter || 1
      const header = `## ${type}: ${title} | category: ${c} | iter: ${i}`
      const entry = body ? `\n\n${header}\n${body}\n` : `\n\n${header}\n`
      appendFileSync(filePath, entry)
      debugLog("context", "appendKnowledge", { type, title, category: c, iter: i })
    } catch (e) {
      debugLog("context", "appendKnowledge error:", e.message)
    }
  }

  /**
   * Return recent knowledge entries relevant to `category`.
   * Matches entries tagged with the exact category name or "global".
   * Returns last `limit` entries as markdown string, or null.
   */
  getRelevantKnowledge(category, limit = 5) {
    try {
      const content = this.readProjectFile("docs/knowledge.md")
      if (!content) return null

      const sections = content
        .split(/(?=^##\s+)/m)
        .filter(s => /^##\s+(Decision|Gotcha|Convention|Failure):/m.test(s))

      if (sections.length === 0) return null

      const lowerCat = category ? category.toLowerCase() : ""
      const matches = []

      for (const section of sections) {
        const firstLine = section.split("\n")[0].toLowerCase()
        const hasCategory = lowerCat && firstLine.includes(`category: ${lowerCat}`.toLowerCase())
        const isGlobal = firstLine.includes("category: global") || !firstLine.includes("category:")
        if (hasCategory || isGlobal) {
          matches.push(section.trim())
        }
      }

      return matches.length > 0 ? matches.slice(-limit).join("\n\n") : null
    } catch (e) {
      debugLog("context", "getRelevantKnowledge error:", e.message)
      return null
    }
  }
}
