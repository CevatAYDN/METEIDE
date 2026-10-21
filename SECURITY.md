# 12 Autonomy and security

Repository file: `SECURITY.md`. Depends on: 06 Kernel and modules, 10 Tools, MCP and runtimes.

Without containers there is no operating-system isolation, so METE stays safe through layers: policy-gated tools, worktrees, an allow list, checkpoints, budgets and human gates \[C\].

## Autonomy levels

| Level | Runs without asking | Asks first |
| --- | --- | --- |
| 0 Suggest | Planning and model calls only | Every action; nothing is written |
| 1 Step approval | Reads | Every action with a side effect |
| 2 Risky approval (default) | Reads, writes inside the workspace or a worktree, allow-listed commands | Everything in `always_ask` and every non-allow-listed command |
| 3 Full autonomy | Everything except `never_allow`; writes only in worktrees or snapshots; a report at the end | Nothing during the run |

The level is set per workspace and MAY be lowered per capability. Level 3 requires checkpoints and verify gates to be active \[C\].

## Policy file

```yaml
# .mete/policy.yaml
autonomy: 2
overrides: { "shell.exec@1": 1 }           # per-capability level, never higher than autonomy
always_ask: [fs.delete, git.push, git.merge, plugin.install, mcp.install, mcp.sampling, release.publish, vault.write.personal]
never_allow:
  - { action: fs.write, path: "~/.ssh/**" }
  - { action: shell.exec, command: "rm -rf /*" }
shell:
  allow: ["pnpm *", "npm test", "npm run *", "git status", "git diff *"]
budget: { cloud_requests_per_run: 150, max_hours: 6 }
approval_timeout_hours: 24
```

The file above is also the built-in default: a key the workspace and global files leave out takes its value from it \[D\]. Only overrides the user wrote must stay at or below `autonomy`; the built-in `overrides` is filled in after that check, so `autonomy: 0` without an `overrides` key is valid \[D\]. The effective budget of a run is the smaller of the template's `budget` and the policy's `budget` \[D\].

Action ids used by the policy: `fs.write`, `fs.delete` (a `fs.write@1` call with `delete: true`), `fs.write.outside`, `shell.exec`, `git.commit`, `git.push`, `git.merge`, `net.fetch`, `plugin.install`, `mcp.install`, `mcp.sampling`, `runtime.install`, `release.publish`, `vault.write.personal` \[D\]. Patterns use glob syntax \[D\]:

- Path patterns (`never_allow` paths, protected paths): `*` and `?` stay within one folder, `**` crosses folders, `dir/**` also matches `dir` itself, and names that start with a dot match like any other name. `~` is the home folder, and a relative pattern is relative to the workspace root. Paths are compared as absolute paths with `/` separators, without case on Windows.
- Command patterns (`shell.allow`, `never_allow` commands): `*` matches any text, including `/`, and the whole command must match after trimming and collapsing spaces. Commands run in a shell (tab 10), so a command that contains `&`, `|`, `;`, a line break, a backtick, `(`, `)`, `>` or `<` never matches `shell.allow`, even inside quotes, and asks instead. A `never_allow` command rule matches the whole command and also each part of it, where parts are split at `&&`, `||`, `;`, `&`, `|`, line breaks, backticks and parentheses (so the inside of `$(…)` and `(…)` is a part too).
- A `never_allow` path rule for `fs.write` also covers `fs.delete` and `fs.write.outside`, and protected paths cover all three.
- `policy.check@1` receives the real absolute path the adapter will touch; resolving symbolic links is the caller's job.

`policy.check@1` decides in this order, and the verdict names the step that fired \[D\]:

1. A write action without `path`, or a `shell.exec` without `command`: deny, because no rule can be checked.
2. A `never_allow` rule matches: deny.
3. A write to a protected path: deny.
4. The effective level is the lower of `autonomy` and the capability's entry in `overrides`.
5. Level 0: deny, because suggest mode writes nothing.
6. Level 3: allow, except `fs.write` or `fs.delete` outside the workspace and the global `worktrees/` and `snapshots/` folders, which is denied because level 3 never asks.
7. The action is in `always_ask`: ask.
8. Level 1: ask.
9. Level 2: allow `fs.write` inside the workspace or the global `worktrees/` and `snapshots/` folders, `shell.exec` matching `shell.allow`, `git.commit`, `net.fetch` (its result is tainted external content) and `runtime.install` (runtimes download by themselves, tab 18); ask for everything else, including `fs.write.outside`.

The verdict's `rule` names the step: `missing_input` (1), `never_allow:<index>` (2, the rule's position in the list), `protected_path` (3), `autonomy:0` (5), `autonomy:3` or `autonomy:3:outside` (6), `always_ask` (7), `autonomy:1` (8), and `autonomy:2:inside`, `shell.allow`, `autonomy:2:action` or `autonomy:2` (9) \[D\].

`policy.check@1` also takes a `tainted` flag and records it in the audit log; the flag changes no decision until the core remembers approvals (Phase 2).

Protected paths: agents MUST NOT write `.mete/policy.yaml`, `.mete/bindings.yaml` or `.mete/mcp.yaml`; only the user changes them \[D\].

## Threat model

| Threat | Mitigation |
| --- | --- |
| Prompt injection in web pages, files or MCP results | External content is wrapped and labeled as data. A step that read external content is tainted; at level 2 its `always_ask` actions and all non-allow-listed commands need approval even if they were pre-approved \[C\] |
| Malicious or hijacked plugin or MCP server | Only the user installs; pinned versions; SHA-256 checks; permissions shown at install; child process; circuit breaker \[C\]. Node-based third-party processes SHOULD start with the Node.js permission model (`--permission` with only the declared paths) \[D\] |
| Secret exfiltration | secretlint masking, `.meteignore`, keychain storage, no secrets in logs \[C\] |
| Destructive commands | Allow list, `never_allow`, checkpoints, worktrees \[C\] |
| Runaway loops and quota drain | Budgets, revision limit, 25-turn limit per attempt, kill switch \[C\] |
| Agent raising its own rights | Protected paths above; the policy engine runs outside the agent's reach \[D\] |
| Vulnerable METE dependencies | Exact pins, 14-day rule, osv-scanner, license check \[C\] |
| Electron misconfiguration | `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderers, strict CSP, Electronegativity in local CI \[C\] |

Third-party code still runs with the user's operating-system rights; METE enforces permissions on its own APIs and says so in the install dialog \[C\].

## Checkpoints and rollback

- Git workspaces: before every step that may write, METE records the state as a commit under `refs/mete/checkpoints/<run id>/<n>`, which creates no branches \[D\].
- Other workspaces: before the first write to a file in a step, that file is copied to the global `snapshots/<run id>/<n>/` folder \[D\].
- Every checkpoint can be restored with one click; restoring publishes `rollback.performed`.
- Checkpoints are kept 14 days after the run ends \[D\].

## Kill switch

"Stop all" (toolbar button and `Ctrl+Shift+.`) cancels every run, aborts in-flight model calls, rejects pending MCP sampling and pauses triggers \[D\].

## Audit log

Every side-effect action writes a row to the workspace `mete.db`: time, run, agent, action, capability, adapter, SHA-256 of the arguments, decision and matching policy rule. The log is viewable and exportable as JSON \[C\]. `policy.check@1` writes the row in the same call, into the `audit_log` table, with `action` as the caller named it (a `fs.write` the policy treats as `fs.write.outside` is logged as `fs.write`); when the row cannot be written the check returns `audit_failed`, and callers MUST treat that as deny \[D\].

## Triggers

| Trigger | Configuration |
| --- | --- |
| Manual | Start button, command palette, CLI `mete run` |
| Schedule | Cron expression in `.mete/workspace.yaml` |
| File change | Glob pattern |
| Issue source | `issues.source@1` with a label filter |
| Webhook | HTTP on 127.0.0.1 only, with a per-trigger token \[D\] |

Triggered runs use priority P2 and the workspace autonomy level. Runs at level 3 MUST use worktrees or snapshots \[C\].
