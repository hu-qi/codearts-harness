---
name: generate-app-spec
description: >-
  Use this skill whenever a user wants to generate a specification document for
  an autonomous AI coding agent — not write the code itself, but create the spec
  that an agent will execute. Trigger for: "generate app spec", "create
  app_spec.txt", "spec out my app idea", "帮我生成 app spec", "生成规格文档",
  "帮我准备 app_spec.txt", "写一份 PRD 给 agent 用", "为自主编码 Agent 写规格".
  Also trigger when the user says they want to build something "with an
  autonomous coding agent", "with claude-agent", "with autonomous-coding-demo",
  or "用自主编码 Agent 构建" and needs the spec file first. Produces a complete
  XML app_spec.txt through a short interview covering app idea, tech stack,
  features, DB schema, API endpoints, and step-by-step implementation plan.
  Skip for: direct code generation, scaffolding an existing project, debugging,
  refactoring, or writing documentation intended for human engineers rather than
  AI agents.
---

# Generate App Spec

Your job is to interview the user and produce a complete `app_spec.txt` — an XML
specification document that an autonomous coding agent can execute without
further clarification.

The key insight: this document's audience is an LLM agent, not a human engineer.
That means every detail must be concrete enough that no guess-work is needed.
"A modern UI" is useless. "React with Vite, Tailwind CSS via CDN, React Router,
left sidebar 280px wide" is what the agent needs.

---

## Step 0: Detect mode

Before interviewing, check the workspace state:

| Mode | Trigger | Behavior |
|------|---------|----------|
| `CREATE` | No `docs/app_spec.txt` and no existing code | Full interview, generate fresh spec |
| `FROM_DOCUMENT` | Coordinator detected PRD/文档 input (user pasted long text, attached file, or used PRD keywords) | Skip interview. Parse the user's document content to extract app name, tech stack, features, DB schema, API endpoints, and implementation steps. Fill in the XML template directly. If the document is ambiguous, make sensible defaults and note assumptions. |
| `DELTA` | `docs/app_spec.txt` already exists | Read existing spec, interview ONLY about new requirements; output a complete new spec containing both old + new content (so app_spec.txt is always self-contained) |
| `NEW_ONLY` | No `docs/app_spec.txt` but non-trivial existing code (`src/` / `server/` / `app/` / `package.json` with deps) | Interview about new requirements only; output a spec that describes ONLY the new functionality, with `<existing_codebase_note>` reminding verifier not to flag pre-existing code as missing |

Coordinator usually tells you which mode in its skill invocation. If unclear, run `cat docs/app_spec.txt 2>/dev/null` and detect file presence + check for `src/`/`server/` dirs.

In `DELTA` and `NEW_ONLY`, your interview is much shorter — usually 1-2 questions about the specific new requirements. Do NOT re-ask tech stack, scale, etc.; reuse existing answers (in DELTA mode read them from current spec; in NEW_ONLY mode infer from existing code).

**

## Step 1: Interview the user (CREATE / DELTA / NEW_ONLY modes)

If mode is `FROM_DOCUMENT`, skip to Step 1b.

Ask these questions **one at a time**, waiting for each answer before continuing.
If the user already answered something in their initial message, skip it.

1. **What are you building?** — One sentence: the app name and its core purpose.

2. **Tech stack** — Frontend framework? Backend? Database? If they say "default"
   or "whatever works", use the defaults below.

3. **Core features** — "List 3–5 modules or feature areas your app needs."
   (e.g., "user auth, real-time chat, file uploads")

4. **Scale/complexity** — "Simple tool, medium product, or full platform?"
   This affects how many feature modules and implementation steps to generate.

**Defaults** (use when the user is unsure or says "standard"):
- Frontend: React with Vite + Tailwind CSS (via CDN) + React hooks + React Router
- Backend: Node.js with Express
- Database: SQLite with better-sqlite3
- Communication: RESTful API; add SSE if the app has real-time or streaming needs

---

### Step 1b: FROM_DOCUMENT mode

When coordinator passes a PRD or requirements document, do NOT interview the user.
Instead, parse the document content to extract structural information for the XML spec.

**What to extract from the document:**

| Spec section | Extract from document | Default if missing |
|-------------|----------------------|-------------------|
| `<project_name>` | Document title or first heading | "Project from PRD" |
| `<overview>` | Executive summary or intro paragraph | Compose from extracted features |
| `<technology_stack>` | Mentioned frameworks, databases, tools | React+Vite / Express / SQLite |
| `<core_features>` | Feature lists, user stories, functional requirements | — (required) |
| `<database_schema>` | Entity lists, ER diagrams, data model descriptions | Infer from features |
| `<api_endpoints_summary>` | API route lists, endpoint descriptions | Infer from features |
| `<ui_layout>` | Wireframe descriptions, page layouts | Standard two-column or single-page |
| `<design_system>` | Color palette, typography mentions | Default: Inter, #3B82F6 accent |
| `<implementation_steps>` | Roadmap, milestones, phasing sections | Derive from features: DB first, then API, then UI |
| `<success_criteria>` | Acceptance criteria, test scenarios | Derive from features |

**Handling ambiguity:**
- If the document doesn't mention something → use sensible defaults, note in `<overview>` what was inferred
- If the document is contradictory → pick the most specific statement
- Scale: count features (3-5 = simple, 6-9 = medium, 10+ = full)

**After extraction:** go directly to Step 2 (Generate the XML spec) and produce the full XML.
Do NOT ask the user questions. The goal is zero-interaction spec generation from PRD.

---

## Step 2: Generate the XML spec

Once you have enough to work with, generate the full document. Never ask more
than 4 questions — if something is unclear, make a sensible choice and note it.

### Quality bar for every section

- **Technology stack**: name the exact library, not the category.
  Write `React with Vite`, not `a modern frontend framework`.

- **Core features**: each bullet should be implementable in one sitting.
  Write `Search conversations by title and content with date-range filter`,
  not `search feature`.

- **Database schema**: every table needs `id`, `created_at`, foreign keys, and
  any JSON columns noted as `(JSON)`. Don't omit fields to save space.

- **API endpoints**: list every route with its HTTP verb.
  Group by resource. Include special operations (duplicate, export, share).

- **Implementation steps**: ordered by dependency — infrastructure first,
  then data layer, then core UI, then advanced features. Each step needs
  5–8 concrete sub-tasks.

- **Success criteria**: four dimensions, all checkable by running the app
  or reading the code. No vague goals like "feels good".

### Scale guide
| Complexity | Feature modules | DB tables | API endpoints | Impl steps |
|------------|----------------|-----------|---------------|------------|
| Simple     | 3–5            | 3–6       | 15–25         | 4–5        |
| Medium     | 6–9            | 7–12      | 30–45         | 6–7        |
| Full platform | 10+         | 13+       | 50+           | 8–9        |

### XML template

Generate the spec using this exact structure. All nodes are required.
Omitting a node is worse than having a short one — fill everything in.

```xml
<project_specification>
  <project_name>APP NAME - ONE LINE TAGLINE</project_name>

  <overview>
    3–5 sentences: what the app does, who it's for, core design principles,
    and the main technical approach. Be specific enough that an agent reading
    this knows the product vision without reading the rest.
  </overview>

  <technology_stack>
    <api_key>
      You can use an API key located at /tmp/api-key for testing. You will
      not be allowed to read this file, but you can reference it in code.
    </api_key>
    <frontend>
      <framework>React with Vite</framework>
      <styling>Tailwind CSS (via CDN)</styling>
      <state_management>React hooks and context</state_management>
      <routing>React Router for navigation</routing>
      <!-- add more child nodes for other libraries -->
      <port>Only launch on port {frontend_port}</port>
    </frontend>
    <backend>
      <runtime>Node.js with Express</runtime>
      <database>SQLite with better-sqlite3</database>
      <!-- add more child nodes for other deps -->
    </backend>
    <communication>
      <api>RESTful endpoints</api>
      <!-- add SSE node if streaming is needed -->
    </communication>
  </technology_stack>

  <prerequisites>
    <environment_setup>
      <!-- bullet list of what must exist before the agent starts coding:
           env vars, pre-installed deps, directory structure, etc. -->
    </environment_setup>
  </prerequisites>

  <core_features>
    <!-- one child node per feature module, named with_underscores.
         CONVENTION: child node names MUST be valid feature.category values
         in feature_list.json (snake_case, unique). The harness plugin slices
         this XML by exact tag-name match against feature.category — no
         translation table. So "task_management" here ⇔ feature.category =
         "task_management" in feature_list.json. -->
    <!-- each module: 8–15 concrete bullet points -->
    <module_name>
      - Specific feature description, actionable and unambiguous
      - ...
    </module_name>
  </core_features>

  <database_schema>
    <tables>
      <!-- one child node per table -->
      <table_name>
        - id, INTEGER PRIMARY KEY
        - field_name, TYPE — description / constraints
        - foreign_key_id, INTEGER — references other_table(id)
        - json_field, TEXT (JSON) — description of structure
        - created_at, DATETIME DEFAULT CURRENT_TIMESTAMP
        - updated_at, DATETIME
      </table_name>
    </tables>
  </database_schema>

  <api_endpoints_summary>
    <!-- one child node per resource group.
         CONVENTION: child node names MUST match the corresponding
         <core_features> child name (and feature.category). E.g. if
         <core_features> has <task_management>, this node should also have
         <task_management> for related endpoints. The harness plugin uses
         exact tag-name match against feature.category. -->
    <resource_group>
      - GET    /api/resource              — list all
      - POST   /api/resource              — create
      - GET    /api/resource/:id          — get one
      - PUT    /api/resource/:id          — update
      - DELETE /api/resource/:id          — delete
      - POST   /api/resource/:id/action   — special operation
    </resource_group>
  </api_endpoints_summary>

  <ui_layout>
    <main_structure>
      Overall layout: number of columns, responsive breakpoints,
      which areas are collapsible, persistent elements.
    </main_structure>
    <!-- one child node per major UI region -->
    <region_name>
      - List of elements in this region
      - Interactive behaviors
    </region_name>
  </ui_layout>

  <design_system>
    <color_palette>
      - Primary accent: #HEX (light) / #HEX (dark)
      - Background: #HEX (light) / #HEX (dark)
      - Surface: #HEX (light) / #HEX (dark)
      - Text: #HEX (light) / #HEX (dark)
      - Border: #HEX (light) / #HEX (dark)
    </color_palette>
    <typography>
      - Font stack: Inter, SF Pro, system-ui, sans-serif
      - Headings: font-semibold
      - Body: font-normal, leading-relaxed, 16px
      - Code: JetBrains Mono, Consolas, monospace
    </typography>
    <components>
      <!-- visual rules for buttons, inputs, cards, and any app-specific components -->
    </components>
    <animations>
      - Transitions: 150–300ms ease
      <!-- key animations specific to this app -->
    </animations>
  </design_system>

  <key_interactions>
    <!-- 3–5 of the most important user flows, numbered step by step -->
    <primary_flow>
      1. User does X
      2. System responds with Y
      3. ...
    </primary_flow>
  </key_interactions>

  <implementation_steps>
    <!-- 4–9 ordered phases; infrastructure before UI, basic before advanced.
         CONVENTION: step `number` is the canonical feature id used by
         feature_list.json. Numbers must be globally unique across all
         iterations and strictly monotonically increasing — never reused,
         never resequenced, never reordered. In DELTA mode, new steps
         continue from `max(existing step number) + 1`. -->
    <step number="1">
      <title>Short phase title</title>
      <tasks>
        - Concrete sub-task (5–8 per step)
        - ...
      </tasks>
    </step>
  </implementation_steps>

  <success_criteria>
    <functionality>
      <!-- core features that must work, verifiable by using the app -->
    </functionality>
    <user_experience>
      <!-- UX quality bars: responsiveness, feedback latency, error states -->
    </user_experience>
    <technical_quality>
      <!-- code structure, error handling, security, performance -->
    </technical_quality>
    <design_polish>
      <!-- visual consistency, dark mode, accessibility, animations -->
    </design_polish>
  </success_criteria>

  <!-- ONLY in NEW_ONLY mode (bootstrap onto existing codebase) -->
  <existing_codebase_note>
    This iteration adds NEW functionality onto a pre-existing codebase whose
    full surface area is intentionally not specified here. Verifier MUST NOT
    flag pre-existing code as missing requirements / scope gaps / inadequate
    tests. Use git log/blame to distinguish what predates this iteration.
    Only the features listed in <core_features> and <implementation_steps>
    above are in-scope for this iteration's verification.
  </existing_codebase_note>

</project_specification>
```

### Per-mode output rules

- **CREATE**: emit the full template; iteration step numbers start at 1.
- **DELTA**: read existing `docs/app_spec.txt` first. The new spec must contain BOTH old + new content:
  - `<technology_stack>` / `<prerequisites>` / `<design_system>`: copy verbatim unless user explicitly changed something.
  - `<core_features>`: keep all existing children unchanged; append new child nodes for new feature areas.
  - `<database_schema>`: keep all existing tables; append new tables.
  - `<api_endpoints_summary>`: keep existing groups; append new groups (matching new core_features children).
  - `<ui_layout>` / `<key_interactions>`: amend if new flows added; otherwise copy.
  - `<implementation_steps>`: keep existing steps verbatim. Append new steps with `number = max(existing) + 1, +2, ...`. **Never reuse, renumber, or reorder.**
  - `<success_criteria>`: extend lists with new criteria; do not remove old ones.
  - Do NOT include `<existing_codebase_note>` in DELTA mode.
- **NEW_ONLY**: emit only the sections needed for the new requirements. Step numbers start at 1 (this iteration's spec is self-contained for the new work). Include `<existing_codebase_note>`. The pre-existing codebase is documented by `ARCHITECTURE.md` (separately generated by project-architecture-summarizer), not this spec.

---

## Step 3: Save the file

After generating the XML, save to `docs/app_spec.txt` (the harness default — coordinator/initializer/coder/verifier all read from this path). Only ask for an alternate path if the user explicitly requests one.

Then write it — output raw XML without any surrounding code fence, so the file
is ready for the agent to consume directly.
