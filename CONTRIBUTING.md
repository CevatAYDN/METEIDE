# 14 Coding standards

Repository file: `CONTRIBUTING.md` (coding section). Depends on: 03 Architecture, 06 Kernel and modules.

METE code follows SOLID at module level and clean architecture inside each package; local CI enforces every rule that a machine can check.

## SOLID in METE

| Principle | Rule in this codebase |
| --- | --- |
| Single responsibility | One module serves one concern; one adapter wraps one external tool; one function does one thing |
| Open/closed | New behavior arrives as a new adapter, module or template. Core changes need an ADR. Core MUST NOT branch on provider, tool or model names |
| Liskov substitution | Every adapter of a capability passes the same contract test kit, so any of them can replace another |
| Interface segregation | Capability contracts stay small; consumers require the narrowest capability they need; no catch-all service interfaces |
| Dependency inversion | High-level code depends on capability contracts resolved from the registry or DI, never on concrete adapters. Concrete wiring happens only in composition roots: `apps/cli`, `apps/desktop`, and the daemon bootstrap |

## Package structure

```
packages/<name>/
  src/
    domain/          pure types and logic; no I/O; imports nothing from application or infrastructure
    application/     use cases; uses domain; talks to the outside only through ports (interfaces)
    infrastructure/  adapters for SQLite, HTTP, MCP, files; implements ports
    module.ts        the MeteModule: manifest, activate, deactivate
    index.ts         public API only: types, contracts, the module
  test/              mirrors src/
  README.md          purpose, manifest summary, capabilities
```

Imports point inward only: infrastructure → application → domain. dependency-cruiser fails the build otherwise \[D\].

## TypeScript

- `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, ESM only.
- `any` is forbidden. Data from outside (files, network, models, MCP) enters as `unknown` and is parsed with Zod at the boundary.
- Named exports only; no default exports. No `enum`; use string literal unions with `as const`.
- Data is immutable by default: `readonly` fields and `ReadonlyArray`.
- Every cancellable async function accepts an `AbortSignal`. Floating promises are a lint error.
- No side effects at import time; no global singletons. Services come from `ModuleContext` or DI.

## Errors

- Expected failures return `Result<T, E>`; `E` is a discriminated union with a `code` field (ADR-034).
- Exceptions mean bugs. The supervisor catches them, logs them and restarts the module if needed.
- Errors are never swallowed. User-facing text comes from i18n keys, never from raw exception messages.

## Naming

- Files: `kebab-case.ts`. Types and classes: `PascalCase`. Functions and variables: `camelCase`. `UPPER_SNAKE_CASE` only for true constants.
- Tests: `*.test.ts`. Contract kits: `*.contract.ts`. Capability ids and event types follow the conventions on the overview tab.

## Size limits

Defaults \[D\]: a function has at most 40 lines and 4 parameters (use an options object beyond that); a file has at most 400 lines; complexity is at most 10. Exceeding a limit requires a comment that explains why. Biome enforces these in `pnpm check` (`biome.json`), measuring complexity as its cognitive complexity; tests and the contract kits in `@mete/testing` are exempt from the two line limits.

## Comments and documentation

- Comments explain why, not what.
- Every public export has a one-line TSDoc comment.
- When behavior described in these documents changes, the document changes in the same commit.

## Logging

- pino with structured fields: `module`, `runId`, `taskId`, `agentId`.
- Levels: `error` for a failure the user sees, `warn` for a fallback or degradation, `info` for lifecycle, `debug` for development.
- Secrets and prompts MUST NOT appear in global logs.

## Configuration values

No magic numbers. Each package keeps its defaults in `src/defaults.ts`, each named and commented with the document tab that defines it.

## Cross-platform rules

- Paths only through `node:path`; never join with `/` or `\` by hand.
- `.gitattributes` forces LF in the repository; edit tools preserve a file's own line endings.
- Commands spawn with argument arrays, never shell strings built by concatenation.
- Import paths must match file name case exactly (lint rule).
- Temporary files through `os.tmpdir()`; no hardcoded drive letters or home paths.
- File operations retry on Windows lock errors (10 Tools, MCP and runtimes).

## Dependencies

A new runtime dependency needs an ADR (ADR-035). Prefer the Node.js standard library. Versions are exact.

## Commits and versions

- Conventional Commits: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `chore`; scope = package name, for example `feat(quota): add credits_per_month unit`.
- One logical change per commit. A user-visible change adds a Changesets entry.
- Branch names: `<type>/<short-description>`.

## Definition of done

- [ ] Type check, Biome and dependency-cruiser pass
- [ ] Unit tests for new logic; contract tests pass for every touched capability
- [ ] No new `any`, no disabled lint rule without a reason comment
- [ ] Documentation updated when behavior changed; ADR added when a decision changed
- [ ] Changeset added for user-visible changes
- [ ] Works on Windows; Linux checked through WSL2 for platform-sensitive code
