# R3 Old Dependency Compatibility

## Status

Main integration update: installed-mode compatibility tests now pass 10/10,
including both once and both uuid consumer edges. Independent Astra review
confirmed the resolutions and consumer checks. Native Linux acceptance remains
open; the rejected diff selector is still absent. The full release run still
fails audit and OSV on the remaining dependencies (see the lead-work ledger).

Implemented three exact-old-version selectors: once 1.1.2 -> 2.0.1 and uuid
7.0.3/8.3.2 -> 11.1.1. Isolated candidate consumer checks pass. Installation,
lockfile resolution, desktop bundling, native Linux behavior and release gates
are NOT verified. diff 7.0.0 -> 8.0.3 is BLOCKED by actual Mocha inline output
incompatibility; no diff selector, shim, replacement or dependency was added.

## Scope and Ownership

Workspace: `C:\Users\wwwla\Documents\Github\METEIDE`, November 8, 2026.
Read AGENTS, glossary, architecture, module rules, contributing, roadmap,
docs/05 and docs/15, FAQ, relevant accepted ADRs 035/066/103/115/163/179,
and the R1 ledger. Used ponytail, systematic-debugging and TDD.
Only this ledger, `scripts/test/security-compatibility.test.mjs`, and the three
selectors/comments in `pnpm-workspace.yaml` are R3 writes. Existing R1 YAML
ownership overlap was flagged before writing and retained in place.
The lead owns root test wiring, manifests, lockfile, all workspace installs/builds.
No pnpm command, install, build, provider call, commit, publish, new ignore or
release-age exemption ran. All pre-existing YAML policies compare equal after
removing just the three R3 entries. The lockfile SHA-256 stayed
`3fe614f3cbbeca6f9068f4bbc7926bc5c21a89184f378994fb50967d3d7709cd`
across the scoped edit.

## Primary Eligibility Evidence

Registry metadata was fetched directly with Node fetch and parsed with installed
Zod. Published tarballs were fetched with
`node <installed-npm-cli.js> pack <name>@<version> --ignore-scripts --json --cache <owned>/npm-cache --pack-destination <owned>/<name>`.
No project/global install ran. Names/versions were checked in pack output and
extracted manifests; SHA-512 matched both npm pack and registry `dist.integrity`.
The three candidate LICENSE files were read. All have empty runtime, optional
and peer dependency sets, so these selections add no child dependencies.

| Candidate | Publication UTC | Age at 2026-11-08T00:00:00Z | License / Node |
| --- | --- | --- | --- |
| @tootallnate/once 2.0.1 | 2026-05-03T18:05:21.169Z | 188.25 days | MIT; >=10 |
| diff 8.0.3 (not selected) | 2026-01-12T15:01:26.760Z | 299.37 days | BSD-3-Clause; >=0.3.1 |
| uuid 11.1.1 | 2026-04-29T15:17:24.795Z | 192.36 days | MIT; no manifest engine constraint |

All exceed docs/05's 20160-minute minimum. Candidate executions used Node
24.22.0, including uuid's node CJS and browser ESM exports.
Live GitHub advisory API responses confirm once `<2.0.1` fixed at 2.0.1,
diff `>=6.0.0 <8.0.3` fixed at 8.0.3, and uuid `<11.1.1` fixed at 11.1.1.
The uuid advisory concerns bounds checks in v3/v5/v6, not its parents' v4 calls.

Exact archive integrities:

- once: `sha512-HqmEUIGRJ5fSXchkVgR5F7qn48bDBzv0kWj/Kfu5e6uci4UlEeng4331LnBkWffb++Ei3FOVLxo8JJWMFBDMeQ==`
- diff: `sha512-qejHi7bcSD4hQAZE0tNAawRK1ZtafHDmMTMkrrIGgSLl7hTnQHmKCeB45xAcbfTqK2zowkM3j3bHt/4b/ARbYQ==`
- uuid: `sha512-vIYxrBCC/N/K+Js3qSN88go7kIfNPssr/hHCesKCQNAjmgvYS2oqr69kIufEG+O4+PfezOH4EbIeHCfFov8ZgQ==`

## Every Affected Parent

Structured `pnpm-lock.yaml` snapshot traversal found exactly these five old
dependency edges, including optionalDependencies traversal. Tests resolve them
through the real desktop -> Theia parents, not a convenient hoisted uuid.
All parent manifest entry points and source/declaration references were inspected.
No parent imports removed deep exports or exposes once types through declarations.

| Parent / constraint | Actual consumed surface and result |
| --- | --- |
| @vscode/proxy-agent 0.13.2 / once ^1.1.2 | `out/agent.js:16,118` uses default-import interop, awaits connect and discards its value. The socket-local connect branch is unreachable in these published bytes (`socket` remains null); actual proxy paths delegate to agents. Published PAC factory/class, DIRECT, PROXY success and failed-proxy fallback were exercised. |
| http-proxy-agent 4.0.1 / once 1 | `dist/agent.js:19,139` uses the same interop and discards connect's value, returning the socket separately. Factory/class callback preserves socket identity, absolute request URL, proxy auth, connection rejection and listener cleanup. |
| mocha 11.8.0 / diff ^7.0.0 | `lib/reporters/base.js:16,521,542` consumes root CJS createPatch and diffWordsWithSpace; public generateDiff consumes value/added/removed, not count. No merge, custom Diff inheritance, async return, deep ESM or removed type exports are used. The bundled browser mocha.js embeds its own diff and is not replaced by this override. BLOCKED below. |
| react-tooltip 4.5.1 / uuid ^7.0.3 | `dist/index.js:5,2347` uses require("uuid").v4(); `dist/index.es.js:3,2340` uses named v4. Generated string is prefixed with t and used in ID/class/CSS/aria. Real CJS and ESM tooltip public rendering succeeds with candidate node/browser exports. No uuid/v4 deep import. |
| trash 7.2.0 / uuid ^8.3.2 | `lib/linux.js:6,31` uses require("uuid").v4() as files/<uuid> and info/<uuid>.trashinfo. The exported async Linux function moves an owned fixture and preserves its content and matching trashinfo identity. procfs/mount discovery and trash root are OS-boundary fakes; this is not native Linux acceptance or a call to the user's trash. |

once is NOT globally API-compatible: v1 exports a callable function plus spread,
and resolves the first event argument with a cancel method; v2 exports default,
resolves the argument array and takes AbortSignal instead. Neither affected parent
reads the value/cancel/spread; their compiled interop accepts both shapes.
uuid 11 preserves the only consumed root named v4 in CJS/browser ESM. The tests
also retain a fixed RFC v4 vector, typed-buffer identity/offset and 64 unique IDs.

## Blocked Diff Evidence

The first 11-case corpus preserved Mocha unified/inline rendered output; its
baseline SHA-256 is pinned from unchanged Mocha + installed diff 7, not generated
from a candidate. An expanded 196-pair tokenizer probe found 58 consumed-field
differences. The durable counterexample is actual="a", expected="a\u00adb":

- diff 7: unchanged `{value:"a", added:false, removed:false}`, then added soft-hyphen+b.
- diff 8.0.3: removed a, then added a+soft-hyphen+b.
- Mocha public inline generateDiff with colors off renders `a\u00adb` on 7 but
  `aa\u00adb` on 8.0.3. ANSI highlighting also changes the unchanged-prefix region.

diff's own 8.0.3 release notes describe soft-hyphen and multiplication/division
tokenizer changes; these affect diffWordsWithSpace too. Upstream also removes
merge and changes Diff/types/deep ESM paths, although this parent does not use
those. Stop applies because real consumed behavior changed, not merely because
the semver range differs. Lead must approve a parent upgrade/behavior decision
separately; do not force diff or add a shim to pass this regression.

## Checks and Lead Handoff

Before selectors, the new policy assertion failed on missing once selector.
Installed behavior passed; installed identity remained red. Candidate once/uuid
behavior passed before YAML edits. No assertion was weakened or skipped.

- `node --experimental-vm-modules --test scripts/test/security-compatibility.test.mjs`:
  exit 1; 9 passed, 1 failed, 0 skipped. Resolution shows once 1.1.2 twice and
  uuid 7.0.3/8.3.2, rather than the selected 2.0.1/11.1.1. Expected until main install.
- `node --experimental-vm-modules scripts/test/security-compatibility.test.mjs --candidate-root <owned>`:
  exit 0; 10 passed, 0 failed/skipped. Substitutes verified once/uuid candidate
  bytes into unchanged parent consumers; uses installed diff 7. Not an install.
- Same candidate command with `--diff-candidate`: exit 1; 9 passed, 1 failed,
  0 skipped. The retained Mocha soft-hyphen regression rejects diff 8.0.3.
- `node node_modules/@biomejs/biome/bin/biome check scripts/test/security-compatibility.test.mjs`:
  exit 0 after formatting; no rule suppression. Candidate selection uses direct
  script CLI arguments, so no Turbo env/config change is needed.
- `git diff --check`: exit 0. Owned temporary archives/cache/fixtures removed;
  no temporary process or persistent server remains.
- `pnpm check`: NOT RUN by R3 under the explicit no-pnpm/no-build assignment.
  Main must wire this file into test:scripts with --experimental-vm-modules,
  serialize lock/install, rerun the installed-mode command and pnpm check, then
  run relevant desktop/proxy/browser/Linux, audit, license and OSV/release gates.

decompress, deepmerge, Zod, follow-redirects, glob and minimatch remain outside R3.
R1's six selections and all existing policies/ignores are unchanged. These checks
are compatibility evidence only, not a security-scan pass or release approval.

## Sources

- npm metadata: https://registry.npmjs.org/%40tootallnate%2Fonce ,
  https://registry.npmjs.org/diff , https://registry.npmjs.org/uuid
- once: https://api.github.com/advisories/GHSA-vpq2-c234-7xj6 ;
  upstream fix https://github.com/TooTallNate/once/commit/b9f43cc5259bee2952d91ad3cdbd201a82df448a
- diff: https://api.github.com/repos/kpdecker/jsdiff/security-advisories/GHSA-73rr-hh4g-fpgx ;
  exact packed release-notes.md and LICENSE from diff 8.0.3.
- uuid: https://api.github.com/repos/uuidjs/uuid/security-advisories/GHSA-w5hq-g745-h8pq ;
  exact packed README.md, LICENSE.md and package.json from uuid 11.1.1.
