# 15 Testing, build and release

Repository file: `docs/15-testing-build-release.md`. Depends on: 05 Tech stack, 14 Coding standards.

All checks run on the developer's machine through lefthook and package scripts; tests never call real models; releases are built locally for Windows and, through WSL2, for Linux \[C\].

## Test types

| Type | Tool | Scope | When |
| --- | --- | --- | --- |
| Unit | Vitest | Domain and application code | pre-push, affected packages |
| Integration | Vitest, real SQLite in a temp folder, in-process kernel | Package boundaries | pre-push, affected packages |
| Contract | Kits in `@mete/testing` | Every adapter of every capability | pre-push for touched capabilities; full at release |
| LLM replay | Hand-written fetch fakes and scripted adapters now; MSW cassettes once `pnpm test:record` exists | Agent flows with recorded or scripted model responses | pre-push |
| End-to-end | Playwright for Electron | Desktop flows: onboarding, run, approval, replay | release |
| Chaos | Seeded script | Disable optional modules one by one and in random sets; the app must start and finish the single-agent fixture task. `pnpm test:chaos` leaves each optional module of the CLI's composition out, then five sets drawn from `CHAOS_SEED`, then all of them, and finishes the typo-fix fixture with a scripted provider each time \[D\] | release |
| MCP conformance | MCP Inspector, scripted | METE as server; METE as client against a Node, a Python and an HTTP reference server \[D\] | release |
| Accessibility | axe-core inside E2E | No serious or critical violations \[D\] | release |
| Security | Electronegativity, osv-scanner, `pnpm audit` (high and critical fail), `pnpm licenses list` | Whole repository | release |

Rules:

- Tests MUST NOT call real model providers. Cassettes are recorded only by `pnpm test:record` with the developer's own keys and committed with secrets masked \[C\]. `pnpm test:record` is not built yet; until it is, provider and gateway tests answer through hand-written fetch fakes and agent flows through scripted `provider.chat@2` adapters, and MSW stays the planned replay tool (tab 05).
- Coverage targets: 90% of lines in `domain/` folders, 75% per package overall; `ui-theia`'s Theia bindings (widgets, contributions, modules, its RPC service and the commands that need Theia's services) run only inside Theia, so they are outside the unit measure and the desktop end-to-end tests cover them \[D\].

## Performance budgets

Phase 1 measures a baseline on the reference machine (the founder's Windows PC): cold start, idle memory, studio frame rate with 6 agents, and indexing time per 1,000 files. From then on, a release fails if any metric regresses by more than 10% from the last accepted baseline \[D\]. Absolute targets are set from that baseline, not guessed.

Phase 1 baseline, recorded from a live `mete run` of an edit task on the reference machine (cold start is the time until the workspace is open; the run figures come from `model_calls` and `runs`) \[D\]:

| Metric | Value | Measured | Commit |
| --- | --- | --- | --- |
| CLI cold start | 1.13 s, median of 5 `mete status` runs after a warm-up, Node 23.9.0 | 2026-10-22 | ab9f1c1 |
| Idle memory (RSS) | 130 MB at the end of `mete status`, median of 5 (101 to 158 MB) | 2026-10-22 | ab9f1c1 |
| Model calls per run | 21: 7 answered and 14 refused with 401 by two OpenRouter models on every turn | 2026-10-22 | ab9f1c1 |
| Prompt and completion tokens per run | 14,000 prompt and 412 completion over the 7 answered calls | 2026-10-22 | ab9f1c1 |
| Median model call latency | 1,065 ms for an answered call; 39 ms for a refused one | 2026-10-22 | ab9f1c1 |
| Run wall time | 9.4 s; 65.0 s when the refused calls used up OpenRouter's 20 requests a minute and the gateway waited 50 s | 2026-10-22 | fc12407, ab9f1c1 |

CLI cold start remeasured on 2026-10-23: 1.48 s, median of 5 `mete status` runs after a warm-up in an empty folder, on Node 24.21.0, the `devEngines` runtime `pnpm` runs (6c5b85b). It was 1.71 s before playwright-core loaded only on first need, and the same runs on Node 23.9.0 took 1.91 s, so the growth over the baseline comes from the CLI, not from Node; most of the rest is loading the ES module graph at start. It is 31% over the accepted 1.13 s, an open finding for the release.

The Phase 1 exit gate counts as passed on 2026-10-22 \[D\]. Live runs finished the edit task with free providers only (fc12407, ab9f1c1) and recorded the baseline above. Quota exhaustion paused live runs: OpenRouter's daily limit ran out on 2026-10-21, and twice `quota.exhausted` was followed by `run.paused` with reason `quota` and `resumesAt` at the reset. Both runs were cancelled before the reset, so the automatic resume is covered only by tests (`packages/core/test/application/engine.test.ts`, "pauses on exhausted quota and resumes by itself at the reset"). The first live run that goes through a reset closes this gap.

Phase 2 exit gate, as of 2026-10-22: `apps/cli/test/research.test.ts` runs `templates/research.yaml` through every real module with scripted models, a Tavily fake and a page fake. It turns a topic into a cited `research-report@1` that the lead approves, and it blocks the report after the fourth revision (the default limit of 3), pauses for the human and completes once the human sends it back. The gate counts as passed on these tests on 2026-10-22, as Phase 1 did with its pause and resume; the live run with free models and a Tavily key is still open, and the first one closes that gap [D].

Phase 3 exit gate, as of 2026-10-22: `apps/cli/test/seo-audit.test.ts` runs `templates/seo-audit.yaml` through every real module with scripted models, a fake browser runner, a Tavily fake and a page fake. It turns a URL into a `seo-audit@1` whose every fix cites an audit of the Lighthouse report, and its search falls back from the built-in Exa server to Tavily. A one-off run of the real browser runner on 2026-10-22 took a screenshot and a Lighthouse audit of `https://example.com/`. `pnpm check:mcp` (`scripts/mcp-conformance.mjs`) runs the MCP Inspector CLI 2.10.1 against the built `mete mcp` in a temporary workspace: `initialize`, `tools/list --strict` with no schema problem, the four tools, a refusal from each tool that starts no run, and `run.lock` released afterwards. It passed on 2026-10-22; `apps/cli/test/mcp.test.ts` covers the same command with an SDK client on fakes. The script downloads the Inspector and, like `mete run`, needs one provider key although it makes no model call, so it stays out of `pnpm check`. The same script then runs the CLI's app as a client in a temporary workspace against three reference servers at exact pinned versions: `@modelcontextprotocol/server-everything` 2026.8.31 over stdio through `npx` and over streamable HTTP, and `mcp-server-time` 2026.8.18 over stdio through `uvx` on the managed uv. Each must list its tool (`echo`, `get_current_time`) and answer one call; that part needs no provider key but downloads the servers and uv, and it passed on 2026-10-22. The gate run, 2026-10-22: `mete run --template seo-audit` on a real public site of the founder's, with OpenRouter's free models, ended `completed` with exit 0 in about two minutes; its report parses as `seo-audit@1`, its four scores equal the categories of the saved Lighthouse report (96, 100, 81, 100) and each of its ten fixes cites an audit that exists in that report; the screenshot and the Lighthouse report are in `.mete/assets/`. That closes the Phase 3 gate \[D\]. The free quota showed its limit: in that run 29 of 38 model calls went to models that did not answer, three OpenRouter models rejecting every call because METE asks for no training on prompts (`No endpoints found matching your data policy`), and a second run on another site reached OpenRouter's daily cap of 50 requests and paused until the reset \[D\].

Phase 4 exit gate, 2026-10-23: `apps/cli/test/web-dev.test.ts` runs `templates/web-dev.yaml` through every real module with scripted models. The gate run, `mete run --template web-dev` with free Groq models, built the page, merged the work and scored 100, 100, 96 and 100 in Lighthouse, above the 85 the gate asks for. That closes the Phase 4 gate (ADR-044) \[D\].

Phase 5 exit gate, as of 2026-10-23: not passed. `apps/cli/test/game-studio.test.ts` runs `templates/game-studio.yaml` with scripted models. A live run in the desktop app (autonomy 3, `shell.exec@1` at 2, free NVIDIA models) went from the approved design through six spawned tasks, each approved by the lead, to `completed`; it paused once for quota and went on with "Resume now". The prototype does not pass its acceptance yet: the game plays and scores, but its game-over screen never shows, because its stylesheet hides it in both rules. The lead approved the change and the tester passed it, both from reading the code, while no capability could play the game. The other three templates have no desktop run yet \[D\].

## Local CI

| Hook or script | Runs |
| --- | --- |
| pre-commit | Biome on staged files, `tsc --noEmit` on affected packages, dependency-cruiser |
| pre-push | Unit, integration, contract and replay tests on affected packages; secretlint on the diff |
| `pnpm release:check` | Every test type above, all security checks, all builds the machine can produce |

## Builds

| Target | Format | Built on |
| --- | --- | --- |
| Windows x64 | NSIS installer \[D\] | Windows |
| Linux x64 | AppImage and `.deb` \[D\] | WSL2 |
| macOS | After MVP \[C\] | A Mac, later |
| CLI | npm package `@mete/cli` with binary `mete` \[D\]; also bundled in the desktop app | Any |

- Installs use `pnpm install --frozen-lockfile`.
- Native modules MUST have prebuilt binaries. Desktop builds rebuild them for Electron's ABI with `@electron/rebuild`; the CLI uses Node.js ABI prebuilds \[C\].

## Release process

1. `pnpm changeset version` updates versions and changelogs.
2. `pnpm release:check` passes. It runs every release-tier check and reports them once: `pnpm check`, all tests (the contract kits included), `pnpm test:chaos`, `pnpm check:mcp`, `pnpm audit --audit-level high`, `pnpm licenses list --prod` (the licenses of what ships; a license outside the docs/05 list fails it, an SPDX `OR` passing when one choice is allowed), osv-scanner (it must be on `PATH`), Electronegativity on the desktop's main process (a HIGH finding fails it, like a high audit finding, except `LIMIT_NAVIGATION_GLOBAL_CHECK`: Theia blocks `will-navigate` and limits `window.open` with `setWindowOpenHandler` for every web contents, which the check, written for the removed `new-window` event, does not see) and the desktop bundle; it fails while the Windows installer, the end-to-end and the accessibility tests are not built \[D\].
3. Build Windows locally and Linux in WSL2.
4. Generate SHA-256 checksums for every artifact.
5. Publish through `release.publish@1`; the default adapter runs `gh release create` from the developer's machine \[C\].
6. electron-updater reads the same release for Windows and Linux AppImage updates \[C\].

Signing: builds ship unsigned first; the README explains the SmartScreen warning step by step. An application to SignPath Foundation for free Windows signing is part of Phase 7 \[C\].

Versions: SemVer. The public MVP is `0.1.0`. `1.0.0` comes after macOS support and a frozen plugin API \[D\]. A breaking kernel API change needs a major version and a migration guide.

## Documentation site

Astro Starlight builds these documents into a static site locally; it is deployed with `wrangler pages deploy` to Cloudflare Pages' free plan \[D\]. The site is a copy; the Markdown in `docs/` stays the source.
