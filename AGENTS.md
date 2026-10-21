# AGENTS.md — METE IDE

You are an AI coding agent working on METE IDE: an open-source, cross-platform desktop
agent workspace that runs teams of AI agents on free cloud model providers.
The documents in docs/ are the specification. When code and docs disagree, docs win.

## Read before any task
1. docs/02-glossary.md        terms
2. ARCHITECTURE.md            layers, processes, repository layout
3. docs/adr/                  accepted decisions (do not reopen them)
4. docs/06-kernel-and-modules.md   module and capability rules
5. CONTRIBUTING.md            coding standards
6. ROADMAP.md                 the current phase; work only on its tasks
7. The document for your task area (07 to 15)

## Golden rules (MUST)
1. Never invent behavior. If the docs and docs/18-faq.md do not answer a question, stop and report it.
2. Never write tool, server, provider or model names in core code or team templates.
   Use capability ids (domain.action@1) and model tiers (reasoning, coder, fast, long-context, vision).
3. Never import another capability module. Resolve capabilities through the kernel registry.
4. Expected failures return Result<T, E>. Throw only for programmer errors.
5. No `any`. Parse every external input with Zod at the boundary.
6. Make the smallest change that solves the task. Edit with exact find-and-replace; do not rewrite whole files.
7. Write or update tests first. Tests MUST NOT call real model providers; use MSW cassettes.
8. Run `pnpm check` before you say a task is done and include its output in your summary.
9. Follow the cross-platform rules: node:path for paths, LF line endings, argument arrays for commands,
   exact import casing, os.tmpdir() for temp files.
10. No new runtime dependency without an ADR. No new event without a schema in @mete/contracts and a row
    in docs/07. No contract change without a capability version bump and updated contract tests.
11. Default numbers come from src/defaults.ts of the package, each pointing to the document that defines it.
12. Functions at most 40 lines and 4 parameters; files at most 400 lines; complexity at most 10.

## Task size
One task = one package, one concern, about 300 changed lines at most.
If a task is bigger, write a plan that splits it and stop for approval.

## Workflow
1. Read the documents listed above that apply.
2. Find the code with search (grep, glob, code graph) before reading whole files.
3. Write or adjust tests.
4. Implement.
5. Run `pnpm check`.
6. Update docs when behavior changed; add an ADR when a decision changed; add a changeset for
   user-visible changes.
7. Summarize: files changed, why, check output, open questions.

## Commands
pnpm install --frozen-lockfile     install
pnpm check                         Biome + tsc + dependency-cruiser + affected tests
pnpm test                          all tests
pnpm --filter @mete/<pkg> test     one package
pnpm build                         build all packages
pnpm test:record                   humans only: records LLM cassettes with real keys

## Environment
Primary platform: Windows with PowerShell. Linux is checked through WSL2.
Prefer Node.js APIs over shell commands.

## Commits
Conventional Commits with the package as scope, for example: fix(gateway): honor reset header on 429

## Third-party code
Ideas from ChatDev, CrewAI and MetaGPT may be reimplemented freely.
Before copying any text or code from another repository, read its LICENSE file and add an entry
to THIRD_PARTY_NOTICES.md (project, license, files, changes).

## Stop and ask when
- a needed decision is missing from docs/ and docs/18-faq.md
- a test cannot pass without changing a contract
- a task would touch more than one package's public API
- a task conflicts with an accepted ADR

## Never
- call real model providers in tests
- add telemetry, network calls outside adapters, or hardcoded API keys
- write to .mete/policy.yaml, .mete/bindings.yaml or .mete/mcp.yaml from agent code paths
- disable a lint rule without a comment that explains why
- use Docker, GitHub Actions or local model runtimes as requirements

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
