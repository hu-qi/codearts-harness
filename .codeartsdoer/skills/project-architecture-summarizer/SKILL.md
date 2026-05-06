---
name: project-architecture-summarizer
description: >
  Summarize a software project's high-level architecture into an ARCHITECTURE.md-style
  document. Use this skill whenever the user wants to understand how a codebase is
  organized, generate an architecture overview, write an ARCHITECTURE.md, or figure
  out "where things live" in a project. Trigger on phrases like "architecture",
  "how is this project structured", "code map", "ARCHITECTURE.md", "understand this
  codebase", "project overview", or when the user is onboarding to an unfamiliar repo.
  Also trigger when the user asks about entry points, boundaries between modules,
  or cross-cutting concerns like logging, configuration, or error handling across
  the whole project.
---

# Project Architecture Summarizer

This skill helps you produce a concise, durable architecture overview of a software
project — the kind of document that answers "where is the thing that does X?" and
"what does the thing I'm looking at do?".

The output is inspired by [matklad's ARCHITECTURE.md](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html)
and the [rust-analyzer architecture guide](https://rust-analyzer.github.io/book/contributing/architecture.html).
It is a **map**, not an atlas. It tells you where things are and what they are
responsible for, not how they work internally.

## Core principles

1. **Map, not manual.** Describe where things live and what they do. Avoid
   implementation details, algorithms, or line-by-line walkthroughs.
2. **Short and durable.** Only capture things that change rarely. Do not try to
   keep this synchronized with every code change. Revisit it a few times a year.
3. **Name important things.** List key files, modules, classes, or types by name.
   Do not add hyperlinks — links go stale. Encourage the reader to use symbol
   search instead.
4. **Call out invariants.** Explicitly state rules that are hard to divine from
   the code, especially rules expressed as the *absence* of something (e.g.,
   "the model layer never depends on the view layer").
5. **Mark boundaries.** Point out API boundaries, layer boundaries, and system
   boundaries. Rules are different on either side of a boundary.

## Workflow

Follow these steps in order. Do not skip the exploration phase — you need to
actually look at the code before you write.

### 1. Orient yourself (1-2 min)

Start by getting a bird's-eye view of the project:

- Read the `README.md` (or equivalent top-level doc).
- List the top-level directory structure. Use `tree -L 2` or similar.
- Identify the build system / package manager (`Cargo.toml`, `package.json`,
  `pyproject.toml`, `go.mod`, `pom.xml`, etc.). Note the main packages/modules.
- Look for any existing `ARCHITECTURE.md`, `docs/architecture/`, `CONTRIBUTING.md`,
  or similar docs. If one exists, read it and build on it rather than replacing it.

Form a one-sentence summary of what the project does and who its consumers are.

### 2. Identify major modules (3-5 min)

Drill into the source tree and identify the coarse-grained modules:

- For monorepos: list the top-level packages/folders under `src/`, `packages/`,
  `crates/`, `apps/`, `libs/`, or equivalent.
- For single-package projects: list the major directories under the source root.
- For each module, determine its **primary responsibility** in 1–3 sentences.
  Aim for specificity: "if I delete this folder, what breaks?" is the question
  your description should answer.

Ask yourself: *If I were to draw boxes and arrows, what would the boxes be?*

Pay attention to:
- Entry points (`main.rs`, `index.ts`, `__main__.py`, `cmd/`, `cli/`)
- Public API surfaces (`api/`, `pkg/`, `lib/`, `sdk/`)
- Adapters to the outside world (`db/`, `http/`, `grpc/`, `lsp/`, `vfs/`)
- Domain / business logic (`domain/`, `core/`, `engine/`, `compiler/`)

### 3. Trace data flow (2-3 min)

Understand how data moves through the system:

- What is the **input**? (source files, user requests, config, network messages)
- What is the **output**? (compiled artifacts, API responses, UI state, diagnostics)
- What are the key **intermediate representations**? (AST, IR, HIR, DOM, DB models)
- Where does the project keep **ground state** vs **derived state**?

If the project is request/response shaped (server, CLI, LSP), trace a single
request from entry to exit.

### 4. Find boundaries and invariants (3-5 min)

Look for architectural boundaries and invariants:

- **API Boundaries:** Which modules are intended to be consumed by external code?
  Mark them explicitly. Note that "rules at the boundary are different."
- **Layer boundaries:** UI vs business logic vs storage; frontend vs backend;
  compiler frontend vs backend.
- **Dependency direction:** Does layer A depend on layer B, or is it inverted?
  Are there forbidden dependencies?
- **Invariants expressed as absence:**
  - "X crate knows nothing about Y framework."
  - "No IO happens inside the core engine."
  - "Serialization types are never reused across IPC boundaries."
  - "Parsing never fails — it returns `(T, Vec<Error>)`."

If you cannot find explicit invariants, do not invent them. But do note any
boundaries that are clearly enforced by the directory structure or build system.

### 5. Identify cross-cutting concerns (2-3 min)

These are things that are "everywhere and nowhere in particular":

- **Error handling:** Is it result-based, exception-based, panic-based?
  Is there a centralized error type?
- **Configuration:** How is config loaded and propagated?
- **Logging / observability:** Are there structured logs, tracing, metrics?
- **Testing strategy:** Unit vs integration vs e2e. Are there data-driven tests,
  snapshot tests, property tests?
- **Concurrency / cancellation:** How are async tasks, threads, or cancellation
  handled?
- **Code generation:** Are any files auto-generated? How is that managed?
- **Build / deployment:** CI, release process, packaging.

### 6. Draft the document

Write the architecture document using this structure. Keep it concise — aim for
a length that a new contributor can read in 10-15 minutes.

```markdown
# Architecture

## Bird's Eye View

Two to three sentences covering:

1. **What** the project does and who consumes it (library users, CLI users,
   IDE extension users, etc.).
2. **Input → Output:** what goes in and what comes out. Be concrete —
   "source files + crate graph → fully resolved semantic model", not
   "code → analysis". This is the single most useful sentence for a newcomer.
3. **Key mechanism:** the core trick that makes it work (incremental
   computation via salsa, lazy on-demand evaluation, an observe-think-act
   loop, a parse-convert-write pipeline). This frames everything that follows.

## Entry Points

List the main entry points. Briefly note what each one does and what kind of
complexity it front-loads. This helps newcomers know where to start reading.

## Code Map

### [`<module-name>`](#module-name)

1–3 sentence description of what this module does and why it exists. Be
specific about its responsibility — "if I delete this folder, what breaks?"
is the question your description should answer. You can mention a key
behavior or design choice that defines the module's character, but stay at
the "what" level, not the "how" level.

- Key types / files: `Foo`, `Bar`, `baz.rs`
- **Architecture Invariant:** (if any) A rule that is hard to see from the code.
- **API Boundary:** (if applicable) Note that this is a public API surface.

Repeat for each major module. Order them logically — by layer, by dependency
direction, or by how a request flows through the system.

## Cross-Cutting Concerns

### [Error Handling]
### [Testing]
### [Configuration]
### [Observability]
### [Build / Code Generation]
```

#### Writing tips

- Use **bold** for "Architecture Invariant" and "API Boundary" labels so they
  stand out when skimming.
- When describing a module, ask: *"If I delete this folder, what breaks?"*
  The answer is its responsibility.
- Avoid deep linking. Say "See `Foo::bar`" rather than `[Foo::bar](src/foo.rs)`.
- If a module is tiny or purely mechanical (e.g., `utils/`, `stdx/`), you can
  group it with others or mention it in one sentence.
- Do not list every file. Name only the ones that are conceptually important.

### 7. Review and refine

Before finishing, do a quick sanity check:

- [ ] Does the codemap answer "where is the thing that does X?"
- [ ] Does it answer "what does the thing I'm looking at do?"
- [ ] Are the things that should be near each other in the codemap actually
      adjacent in the directory tree? If not, note the discrepancy.
- [ ] Is there anything important expressed as an *absence* that a newcomer
      would be surprised to learn? If so, add it as an invariant.
- [ ] Is the document short enough that you would actually read it if you were
      joining the project today?

If the project already has an `ARCHITECTURE.md`, do not overwrite it blindly.
Instead, produce a diff-style summary of what you would add or change, and ask
 the user whether to apply it.

## Invocation modes (when used by the my-harness coordinator)

The harness invokes this skill in three contexts. The workflow above stays the
same; only the input set and the rewrite policy differ.

| Mode | Trigger | Input | Output policy |
|------|---------|-------|---------------|
| `FROM_SPEC` | Greenfield iter-1 — code is fresh from initializer's scaffold + first iter's coders | code + `docs/app_spec.txt` | Write fresh `ARCHITECTURE.md` |
| `REFRESH` | New iteration on an iter-N project — modules may have been added/changed | code + `ARCHITECTURE.md` (existing) + new `docs/app_spec.txt` | Update existing doc in place: amend modules that changed, add new ones, leave stable sections alone. Preserve doc structure and existing wording where still accurate. |
| `FROM_CODE` | BOOTSTRAP_EXISTING — first time harness sees a pre-existing codebase, no spec yet | code only (no spec) | Write fresh `ARCHITECTURE.md` purely from code reading. The spec generator runs after this and will treat the resulting arch doc as ground truth for "what's already there". |

In all modes the output file is `ARCHITECTURE.md` at the project root. In
`REFRESH` mode, prefer in-place edits over wholesale rewrites — a stable
ARCHITECTURE.md across iterations is more valuable than a perfect one each
iteration.

## Output format

Produce a single Markdown file named `ARCHITECTURE.md` (or append to an existing
one). If the user did not specify a path, write it to the project root or ask.

If the project is very large (>200k lines), consider producing a summary
`ARCHITECTURE.md` plus per-subsystem `docs/architecture/<subsystem>.md` files.
