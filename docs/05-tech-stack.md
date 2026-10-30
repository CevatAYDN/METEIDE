# 05 Tech stack

Repository file: `docs/05-tech-stack.md`. Depends on: 03 Architecture, 04 Decisions.

This is the only valid technology list. Anything not listed here needs an ADR before it enters the code (ADR-035).

## Version and license policy

- Node.js 24 LTS. Eclipse Theia: the latest community release on the day Phase 0 starts, pinned; Electron is the version that Theia release requires \[D\].
- Every dependency is pinned to an exact version through `pnpm-lock.yaml`. A release younger than 14 days MUST NOT be adopted (supply-chain safety), direct or transitive; `minimumReleaseAge` in `pnpm-workspace.yaml` enforces it at every install \[D\].
- Allowed licenses for bundled code: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, ISC, MPL-2.0, Unlicense, BlueOak-1.0.0, Python-2.0, EPL-2.0 (Theia, unmodified), LGPL-2.1 or later (a dependency of Theia, unmodified), CC0 for assets, CC-BY-4.0 for assets with attribution, OFL-1.1 for fonts. GPL and AGPL code MUST NOT be bundled. `pnpm release:check` fails on any other license in `pnpm licenses list --prod`; an SPDX `OR` passes when one choice is allowed (ADR-066) \[D\].

## Foundation

| Area | Technology | Role |
| --- | --- | --- |
| Language | TypeScript (strict) | All packages |
| Native hot paths | Rust + napi-rs | Only after a measured bottleneck |
| Package manager | pnpm workspaces | Monorepo |
| Build orchestration | Turborepo | Cached, affected-only builds and tests |
| Format and lint | Biome | One fast tool |
| Architecture rules | dependency-cruiser | Layer and import rules |
| Git hooks | lefthook | Local CI |
| Versioning | Changesets | SemVer and changelogs |

## Desktop and UI

| Area | Technology | Role |
| --- | --- | --- |
| IDE platform | Eclipse Theia on Electron | Shell, Monaco editor, terminal, Open VSX extensions |
| Packaging and update | electron-builder, electron-updater | Installers and updates |
| Panels | React | Theia widgets |
| Component base | Radix UI primitives | Accessible headless components styled by METE tokens |
| UI state | Zustand | Panel state |
| Long lists | TanStack Virtual | Logs, task lists |
| Flow view and template editor | React Flow (xyflow) | Graph of agents and steps |
| Knowledge graph view | Sigma.js + graphology | WebGL graph rendering |
| UI motion | Motion | Short purposeful transitions |
| Studio view | PixiJS + tween.js | 2D renderer for agent characters |
| 3D preview | `<model-viewer>` | GLB preview of generated assets |
| HTML preview | Theia Mini Browser (`@theia/mini-browser`) | A generated page rendered beside its source (ADR-129) |
| Localization | Theia localization for UI, i18next for core messages | English and Turkish |

## Core and platform

| Area | Technology | Role |
| --- | --- | --- |
| Model access | Vercel AI SDK provider packages without the `ai` core: `@ai-sdk/openai-compatible` for NVIDIA, OpenRouter, OpenCode Zen and `openai-chat` custom endpoints; `@ai-sdk/anthropic` and `@ai-sdk/google` for custom endpoints of those formats (ADR-039) | One interface for every provider format |
| Schemas | Zod | Contracts, configuration, artifacts, structured outputs |
| Workflow engine | XState v5 | Team engine, run and task state machines, actors, snapshot persistence; the kernel's module lifecycle is a plain transition table |
| Concurrency | Own priority waiting list and quota windows in `@mete/quota` (ADR-038) | Quota scheduling |
| Database | SQLite through better-sqlite3 (WAL) + Drizzle ORM | Runs, tasks, events, indexes; migrations are hand-written SQL run by `@mete/storage` (drizzle-kit's generated journal is not used); storage's own events and ledger statements are plain SQL, Drizzle is for module tables |
| Keyword search | SQLite FTS5 | Built into SQLite |
| Vector search | sqlite-vec | Same database file |
| RPC | vscode-jsonrpc | Daemon, plugins, LSP-style protocols |
| Dependency injection | InversifyJS | Theia side and core services |
| Events | Own synchronous bus in `@mete/kernel` (ADR-037) | Typed in-process event bus |
| Circuit breaker | Own consecutive-failure counter in `@mete/kernel` (ADR-037) | Supervisor and adapters |
| Logging | pino | Structured JSON logs |
| Command line | `node:util` `parseArgs` | Arguments of the `mete` CLI; no parser dependency |
| Configuration | yaml + Zod | YAML files |
| Gateway | Hono + `@hono/node-server` | Local OpenAI-compatible endpoint |
| Secrets | Electron `safeStorage`, `@napi-rs/keyring` | Operating system keychain |
| Secret masking | secretlint | Before every outbound request |
| Managed Python | uv | Python MCP servers and optional engines |

## Tools and knowledge

| Area | Technology | Role |
| --- | --- | --- |
| Grep | `@vscode/ripgrep` | Bundled ripgrep binary per platform; also lists files for `fs.list@1` and `fs.glob@1` (`rg --files`), because it applies `.gitignore` rules itself |
| Ignore rules | `ignore` | `.meteignore` checks of single paths and of ripgrep's output, in gitignore syntax (ADR-040) |
| Glob | ripgrep `--glob` | File patterns; policy patterns use a small own matcher in `@mete/security`, because `node:path` `matchesGlob` skips dot files and compares Windows paths with case |
| File watching | `@parcel/watcher` | Incremental indexing |
| Terminal | node-pty | Interactive terminal; `shell.exec@1` uses `node:child_process` instead, because a PTY merges stdout and stderr |
| Git | simple-git (git CLI) | Status, diff, worktrees, checkpoints |
| Diff | diff (jsdiff) | Edit application and diff views |
| MCP | `@modelcontextprotocol/client`, `@modelcontextprotocol/server` and `@modelcontextprotocol/core` (SDK v2, ADR-163) | Client and server |
| Code parsing | web-tree-sitter (WASM grammars) | Code graph, no native builds |
| Graph in memory | graphology | Traversal |
| Markdown | unified, remark, gray-matter | Vault parsing, wikilinks, frontmatter |
| Web reading | @mozilla/readability, linkedom, turndown | Page to clean Markdown |
| Browser automation | Playwright | Previews, screenshots, crawling, E2E tests |
| SEO audit | Lighthouse (on Playwright's Chromium) | Local audits |

## External services (all free tiers, all adapters)

| Service | Base URL or access | Used for |
| --- | --- | --- |
| NVIDIA Build | `https://integrate.api.nvidia.com/v1` (OpenAI-compatible) | Chat, embeddings, rerank |
| OpenRouter | `https://openrouter.ai/api/v1`, models with `:free` | Chat |
| OpenCode Zen | `https://opencode.ai/inference/openai/v1` (OpenAI-compatible; tab 09) | Chat (free models change over time) |
| Hugging Face Spaces | MCP (Gradio MCP servers) | Media and specialist models |
| Exa | Exa MCP without key (default); Exa API with key | Web search |
| Tavily, You.com, Firecrawl | HTTP APIs with free keys | Web search fallbacks |

## Quality and release

| Area | Technology | Role |
| --- | --- | --- |
| Unit and contract tests | Vitest | All packages |
| LLM record and replay | MSW | Tests without quota |
| End-to-end | Playwright (Electron) | Desktop flows |
| MCP conformance | MCP Inspector | Manual and scripted checks |
| Accessibility | axe-core | UI checks in E2E |
| Electron security | Electronegativity | Misconfiguration scan |
| Vulnerabilities | osv-scanner, `pnpm audit` | Local CI |
| Documentation site | Astro Starlight | Static site, deployed to Cloudflare Pages (15 Testing, build and release) |

## Explicitly excluded

Docker or Podman as a requirement, GitHub Actions, Bottleneck, LangGraph, Tauri, a Python core, local model runtimes, telemetry SDKs, the Brave Search API in default chains.
