# R1 Release Dependency Security

## Status

Main integration update, November 8: the six selected versions are installed and
the full release run's audit now returns two high advisory entries. OSV reports
8 package/version rows and 11 findings, including 2 critical and 2 high.
The selected slice and installed-consumer tests pass; release acceptance remains
blocked. Detailed current evidence is in `2026-11-08-lead-work.md`.

Implemented one bounded policy slice: six exact override entries for five package
names. Eligibility and configuration checks are verified; installation, runtime
compatibility and release acceptance are NOT verified. The lead owns lockfile
resolution, installation and subsequent release checks. No advisory ignore,
release-age exemption, dependency manifest, patch, script or existing document
was changed by R1.

## Scope and Baseline

- Workspace: `C:\Users\wwwla\Documents\Github\METEIDE`.
- Baseline HEAD: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b`.
- Evidence collection started November 7, 2026, Europe/Istanbul; implementation
  continued November 8 after midnight. The assigned ledger filename is retained.
- Required policy: docs/05, docs/15, ADR-035/066/103/115/163/179; exact
  `minimumReleaseAge: 20160` minutes, no new runtime dependency without an ADR.
- Owned files: this new ledger and override/security comments in
  `pnpm-workspace.yaml`. Other workers' changes are outside this slice.
- Original scans below preceded the lead's ca-certs patch/install. R1 paused all
  pnpm commands and workspace YAML writes during session `93481`, then resumed
  only after the lead confirmed completion. That install did not install R1's
  later override selections.
- `.probe-release-check-20261107.log` was not used as detailed advisory evidence.

## Reproduced Failures

`pnpm audit --audit-level high --json` exited **1**. Six returned high advisory
entries: Zod, Electron, body-parser on two major lines, multer, follow-redirects.
Audit metadata reports 6 high, 2 critical, 7 moderate, 6 low and 1,385 dependencies;
the two critical decompress advisories are already excluded from the returned
advisory list by the existing `auditConfig.ignoreGhsas`. They are not resolved.

`osv-scanner scan source --lockfile pnpm-lock.yaml --format json` exited **1**.
The text-format rerun also exited **1** and reported:
`Total 17 packages affected by 23 known vulnerabilities (2 Critical, 8 High, 8 Medium, 5 Low, 0 Unknown) from 1 ecosystem.`
These are 17 package/version records, not 17 distinct package names (there are
14 names). OSV's CVSS buckets differ from GitHub's textual severity, notably for
uuid and deepmerge. OSV still reports both excluded critical decompress findings.

`pnpm why --recursive --json <package>` mapped current installed parents and
representative root paths. The lockfile was also parsed with installed `yaml`,
not searched as a substitute for a structured dependency graph.

## Eligible Slice

Exact npm publication timestamps below were obtained with
`npm view <name>@<version> version license engines dependencies peerDependencies time --json`
and independently checked against the public npm registry metadata. Eligibility
was calculated at the deliberately conservative instant **2026-11-07T00:00:00Z**:
publication must be no later than **2026-10-24T00:00:00Z**, not merely dated October 24.
All six remain older than 20160 minutes on November 8.

| Package: installed -> selected | npm publication (UTC) | Age at conservative instant | License | Advisory |
| --- | --- | --- | --- | --- |
| electron: 42.11.14 -> 42.11.16 | 2026-10-20T02:53:45.996Z | 17.88 days | MIT | [E] |
| body-parser: 1.20.8 -> 1.20.9 | 2026-10-22T11:38:27.889Z | 15.51 days | MIT | [B] |
| body-parser: 2.3.0 -> 2.4.0 | 2026-10-22T11:39:38.614Z | 15.51 days | MIT | [B] |
| multer: 2.4.0 -> 2.5.0 | 2026-10-22T11:58:46.216Z | 15.50 days | MIT | [M] |
| fast-uri: 3.1.8 -> 3.1.9 | 2026-10-19T23:05:26.357Z | 18.04 days | BSD-3-Clause | [F1]-[F4] |
| serialize-javascript: 7.1.2 -> 7.1.3 | 2026-10-22T21:24:35.883Z | 15.11 days | BSD-3-Clause | [S] |

### Paths and Compatibility Evidence

Paths use `desktop` for `@mete/desktop`; all named Theia packages are 1.76.0.

| Selected dependency | Observed dependency path / parent constraint |
| --- | --- |
| electron | `desktop > @theia/core > @theia/electron > electron`; desktop also has a direct dependency. Theia's peer is exactly 42.8.1; the existing security override already accepts same-major patch releases. This is that exception, not a claim that the exact peer is satisfied. |
| body-parser 1 | `desktop > @theia/core > body-parser` and `@theia/filesystem > body-parser`, both `^1.20.8`; also `@theia/core > express@4.22.3 > body-parser`, `~1.20.5`. 1.20.9 satisfies all three. |
| body-parser 2 | `desktop > @theia/plugin-ext > @theia/ai-mcp > @modelcontextprotocol/sdk@1.32.1 > express@5.2.1 > body-parser`; parent range `^2.2.1` includes 2.4.0. |
| multer | `desktop > @theia/filesystem > multer`, parent `^2.3.0` includes 2.5.0. |
| fast-uri | `desktop > @theia/plugin-ext > @theia/ai-mcp > @modelcontextprotocol/sdk@1.32.1 > ajv@8.20.0 > fast-uri`; `^3.0.1` includes 3.1.9. |
| serialize-javascript | `desktop > @theia/cli > mocha@11.8.0 > serialize-javascript`. Mocha declares `^6.0.2`, but the existing override already selects `^7.1.2`. 7.1.3 advances that installed major, not a new 6-to-7 decision. |

All selected versions have the same child package names as their installed
counterparts. Every existing locked child version satisfies the selected version's
published dependency range. No child package addition is needed for this slice.
Published Node requirements are compatible with Node 24.22.0: Electron >=22.12.0,
body-parser 2 >=18, multer >=10.16.0, serializer >=20; body-parser 1 supports older
Node, fast-uri declares no Node engine. These facts establish eligibility, not
binary, behavioral or packaged-app compatibility.

The upstream maintainer advisory APIs were fetched for [E], [B], [M], [S] and
[F1]-[F4], confirming the fixed lines. GitHub's global advisory API supplied the
remaining ranges and upstream references; npm timestamps, not advisory dates,
control release eligibility. No upstream source code or advisory prose was copied.

## Complete Remaining Finding Map

The eligible table covers nine of the 23 OSV finding rows. The following 14 rows
remain outside this slice. Counts are a baseline partition, not a post-install
scan or a prediction of a release pass.

| Installed package/version | Advisory / OSV CVSS | Observed path / precise blocker |
| --- | --- | --- |
| @tootallnate/once 1.1.2 | [O], 3.3 | `desktop > @theia/plugin-ext > @vscode/proxy-agent@0.13.2 > once`; also via `http-proxy-agent@4.0.1`. Fixed 2.0.1 (2026-05-03T18:05:21.169Z, MIT), but crossing major 1 -> 2 requires parent upgrade/API review. Existing once 2.0.1 through http-proxy-agent 5 is unaffected. |
| decompress 4.2.1 | [D1], 6.4 | `desktop > @theia/cli > decompress`; plugin-ext and plugin-ext-vscode also depend on it. No fixed release under this package name. |
| decompress 4.2.1 | [D2], 9.1 | Same paths; no fixed release. Existing pnpm exclusion preserved, OSV still fails. |
| decompress 4.2.1 | [D3], 5.5 | Same paths; no fixed release. |
| decompress 4.2.1 | [D4], 9.1 | Same paths; no fixed release. Existing pnpm exclusion preserved, OSV still fails. |
| deepmerge 4.3.1 | [DM], 5.3 | `desktop > @theia/core > @theia/application-package > deepmerge`; also @theia/localization-manager. Registry latest is 4.3.1 and advisory has no fix. Replacing/patching it needs a separately owned decision. |
| diff 7.0.0 | [DI], 2.7 | `desktop > @theia/cli > mocha@11.8.0 > diff`, `^7.0.0`. Fixed 8.0.3 (2026-01-12T15:01:26.760Z, BSD-3-Clause) requires parent/API major review. Theia SCM's diff 5.2.2 is already fixed. |
| follow-redirects 1.16.1 | [R], 8.2 | `desktop > @theia/core > @theia/application-package > nano@10.1.4 > axios@1.20.0 > follow-redirects`; also http-proxy 1.18.1. Fix 1.16.2 published 2026-10-25T21:32:25.963Z: eligible only at 2026-11-08T21:32:25.963Z (November 9, 00:32:25.963 Istanbul). Still too young at implementation. Do not downgrade to remove the finding; 1.16 introduced sensitiveHeaders. |
| glob 10.5.0 | [G], 6.3 | `desktop > @theia/cli > mocha > glob`; also filesystem > rimraf 5.0.10. Fix 14.0.2 published 2026-10-27T22:07:00.325Z; eligible 2026-11-10T22:07:00.325Z, then still needs major/parent review. |
| minimatch 9.0.9 | [MM], 6.9 | `desktop > @theia/cli > mocha > glob@10.5.0 > minimatch`; also mocha directly and @electron/universal. Fix 11.0.1 published 2026-10-27T22:26:03.755Z; eligible 2026-11-10T22:26:03.755Z and crosses major. |
| minimatch 10.2.6 | [MM], 6.9 | `desktop > @theia/filesystem > minimatch`; also navigator, search-in-workspace, app-builder-lib and opfs-worker. Same young 11.0.1 fix; needs owner review of each parent contract. |
| uuid 7.0.3 | [U], 7.5 | `desktop > @theia/core > react-tooltip@4.5.1 > uuid`. Fix 11.1.1 published 2026-04-29T15:17:24.795Z (MIT); parent/API major upgrade required. |
| uuid 8.3.2 | [U], 7.5 | `desktop > @theia/filesystem > trash@7.2.0 > uuid`. Same 11.1.1 fix and major review; Theia core's own 11.1.1 is unaffected. |
| zod 3.25.76 | [Z], 8.2 | `desktop > @theia/cli > puppeteer[-core] > chromium-bidi > zod`; also `@mete/tools > lighthouse > puppeteer-core > chromium-bidi > zod`. Both chromium-bidi 16.0.1 and 17.0.2 require `^3.24.1`. Fix 4.6.6 published 2026-10-11T16:18:23.878Z (MIT) is old enough but not compatible with those declared ranges. Request a browser-dependency-chain upgrade supporting fixed Zod, with puppeteer/Lighthouse regression checks, not a global Zod 3 -> 4 override. METE's Zod 4.6.7 is unaffected. |

The fixed `@xhmikosr/decompress` releases in [D2]/[D4] are a different package,
not a fixed `decompress` version. An alias/replacement would need ADR-035 and
review of Theia's extension installation/extraction paths under ADR-180 as well
as build-time plugin download; do not assume the historical build-only rationale
proves current runtime exposure is absent.

## Checks and Handoff

- Evidence-first configuration assertion: direct `node -e` with installed yaml
  parsed `pnpm-workspace.yaml` and compared the six keys/versions below. Before
  editing it exited **1**, reporting all six mismatches; after editing it exited
  **0**, with `mismatches: []`. Additional assertions confirmed all non-override
  settings and unrelated overrides match HEAD, and both owned files use LF.
- Direct Node registry/semver eligibility probe exited **0**, six records checked:
  exact timestamp age, allowed license, unchanged major, parent ranges (with the
  existing Electron/serializer exceptions above), identical child package names
  and satisfaction of all new child ranges by baseline locked versions.
- `node --experimental-vm-modules --test --test-name-pattern "release |windows-ca-certs" scripts/test/maintenance.test.mjs`
  exited **0**, **22 tests passed, 0 failed**. These existing offline regressions
  substitute release process effects; they verify fail-closed reporting and strict
  license policy, not the newly selected dependency implementations.
- `git diff --check` exited **0**. Slice size: 13 inserted / 2 removed YAML lines
  plus this new ledger, below 300 changed lines.
- Post-edit direct YAML inspection confirms the lock still contains Electron
  42.11.14, body-parser 1.20.8/2.3.0, multer 2.4.0, fast-uri 3.1.8 and serializer
  7.1.2. The lead's earlier install did not apply these later selections.
- No R1 install, lockfile regeneration, build or real model-provider call ran.
- `pnpm check` was deliberately not run by R1: it invokes `tsc -b`, outside the
  assignment's no-build boundary, and pnpm may auto-install mismatched state.
- Lead next: serialize lockfile/install; inspect the resolved six versions and
  child graph; run `pnpm check`, focused desktop/browser/MCP regressions,
  `pnpm audit --audit-level high --json`, and both OSV formats. Only then assess
  release checks. The unresolved table above must not be hidden by blanket ignores.

Reproducible read-only configuration assertion (no pnpm invocation):

```powershell
$check = @'
const fs = require("node:fs"), path = require("node:path");
const { createRequire } = require("node:module");
const yaml = createRequire(path.resolve("packages/kernel/package.json"))("yaml");
const cfg = yaml.parse(fs.readFileSync("pnpm-workspace.yaml", "utf8"));
const expected = {
  electron: "42.11.16",
  "body-parser@>=1.20.0 <1.20.9": "1.20.9",
  "body-parser@>=2.0.0 <2.4.0": "2.4.0",
  "multer@>=2.0.0 <2.5.0": "2.5.0",
  "fast-uri@>=3.0.0 <3.1.9": "3.1.9",
  "serialize-javascript": "7.1.3"
};
const mismatches = Object.entries(expected).filter(([k, v]) => cfg.overrides[k] !== v);
if (cfg.minimumReleaseAge !== 20160) throw Error("release age policy changed");
console.log(JSON.stringify({ assertion: "eligible security selections", mismatches }));
if (mismatches.length) process.exitCode = 1;
'@
node -e $check
```

## Sources

The normalized ledger above is derived from current scans and these references.
Maintainer sources for the selected slice were retrieved through
`https://api.github.com/repos/<owner>/<repo>/security-advisories/<GHSA>`.
Remaining advisory metadata was retrieved through
`https://api.github.com/advisories/<GHSA>`.
Registry metadata: `https://registry.npmjs.org/<package>`, with scoped names URL-encoded.

[E]: https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9
[B]: https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828
[M]: https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m
[F1]: https://github.com/fastify/fast-uri/security/advisories/GHSA-333x-w4r6-6crp
[F2]: https://github.com/fastify/fast-uri/security/advisories/GHSA-w74x-v6f9-j3xg
[F3]: https://github.com/fastify/fast-uri/security/advisories/GHSA-wjr9-j795-jxcr
[F4]: https://github.com/fastify/fast-uri/security/advisories/GHSA-xhq7-xmqj-769h
[S]: https://github.com/yahoo/serialize-javascript/security/advisories/GHSA-m5mm-p8h7-m29v
[O]: https://github.com/advisories/GHSA-vpq2-c234-7xj6
[D1]: https://github.com/advisories/GHSA-h39j-r5qq-r9mm
[D2]: https://github.com/XhmikosR/decompress/security/advisories/GHSA-hrh2-vp3x-79xf
[D3]: https://github.com/advisories/GHSA-jwp9-9v96-94mx
[D4]: https://github.com/XhmikosR/decompress/security/advisories/GHSA-mp2f-45pm-3cg9
[DM]: https://github.com/TehShrike/deepmerge/issues/273
[DI]: https://github.com/kpdecker/jsdiff/security/advisories/GHSA-73rr-hh4g-fpgx
[R]: https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-mrwp-f3q8-3g9p
[G]: https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4
[MM]: https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249
[U]: https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq
[Z]: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
