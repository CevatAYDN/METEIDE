# 15 Testing, build and release

Repository file: `docs/15-testing-build-release.md`. Depends on: 05 Tech stack, 14 Coding standards.

All checks run on the developer's machine through lefthook and package scripts; tests never call real models; releases are built locally for Windows and, through WSL2, for Linux \[C\].

## Test types

| Type | Tool | Scope | When |
| --- | --- | --- | --- |
| Unit | Vitest | Domain and application code | pre-push, affected packages |
| Integration | Vitest, real SQLite in a temp folder, in-process kernel | Package boundaries | pre-push, affected packages |
| Contract | Kits in `@mete/testing` | Every adapter of every capability | pre-push for touched capabilities; full at release |
| LLM replay | MSW cassettes | Agent flows with recorded model responses | pre-push |
| End-to-end | Playwright for Electron | Desktop flows: onboarding, run, approval, replay | release |
| Chaos | Seeded script | Disable optional modules one by one and in random sets; the app must start and finish the single-agent fixture task | release |
| MCP conformance | MCP Inspector, scripted | METE as server; METE as client against a Node, a Python and an HTTP reference server \[D\] | release |
| Accessibility | axe-core inside E2E | No serious or critical violations \[D\] | release |
| Security | Electronegativity, osv-scanner, `pnpm audit` (high and critical fail), `pnpm licenses list` | Whole repository | release |

Rules:

- Tests MUST NOT call real model providers. Cassettes are recorded only by `pnpm test:record` with the developer's own keys and committed with secrets masked \[C\].
- Coverage targets: 90% of lines in `domain/` folders, 75% per package overall \[D\].

## Performance budgets

Phase 1 measures a baseline on the reference machine (the founder's Windows PC): cold start, idle memory, studio frame rate with 6 agents, and indexing time per 1,000 files. From then on, a release fails if any metric regresses by more than 10% from the last accepted baseline \[D\]. Absolute targets are set from that baseline, not guessed.

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
2. `pnpm release:check` passes.
3. Build Windows locally and Linux in WSL2.
4. Generate SHA-256 checksums for every artifact.
5. Publish through `release.publish@1`; the default adapter runs `gh release create` from the developer's machine \[C\].
6. electron-updater reads the same release for Windows and Linux AppImage updates \[C\].

Signing: builds ship unsigned first; the README explains the SmartScreen warning step by step. An application to SignPath Foundation for free Windows signing is part of Phase 7 \[C\].

Versions: SemVer. The public MVP is `0.1.0`. `1.0.0` comes after macOS support and a frozen plugin API \[D\]. A breaking kernel API change needs a major version and a migration guide.

## Documentation site

Astro Starlight builds these documents into a static site locally; it is deployed with `wrangler pages deploy` to Cloudflare Pages' free plan \[D\]. The site is a copy; the Markdown in `docs/` stays the source.
