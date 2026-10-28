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

The level is set per workspace and MAY be lowered per capability. Level 3 requires checkpoints and verify gates to be active \[C\]. The gates and worktrees come with Phase 4; until then a CLI run at level 3 starts anyway and prints one line to stderr, `autonomy 3: verify gates and worktrees are not available yet (SECURITY.md); the run goes on with checkpoints only`, so the missing guarantee is never silent \[D\].

## Policy file

```yaml
# .mete/policy.yaml
autonomy: 2
overrides: { "shell.exec@1": 1 }           # per-capability level, never higher than autonomy
always_ask: [fs.delete, git.push, git.merge, plugin.install, mcp.install, mcp.sampling, release.publish, vault.write.personal]
never_allow:
  - { action: fs.write, path: "~/.ssh/**" }
  - { action: shell.exec, command: "rm -rf /*" }
  # Ending programs the agent did not start (ADR-063): a model must never close the user's windows.
  - { action: shell.exec, command: "*taskkill*" }
  - { action: shell.exec, command: "*tskill*" }
  - { action: shell.exec, command: "*Stop-Process*" }
  - { action: shell.exec, command: "spps *" }
  - { action: shell.exec, command: "kill *" }
  - { action: shell.exec, command: "pkill *" }
  - { action: shell.exec, command: "killall *" }
  - { action: shell.exec, command: "*.Kill*" }
shell:
  allow: ["pnpm *", "npm test", "npm run *", "git status", "git diff *"]
  always: []                                  # exact commands the user allowed for good (ADR-121)
budget: { cloud_requests_per_run: 150, max_hours: 6 }
approval_timeout_hours: 24
```

The file above is also the built-in default: a key the workspace and global files leave out takes its value from it \[D\]. Only overrides the user wrote must stay at or below `autonomy`; the built-in `overrides` is filled in after that check, so `autonomy: 0` without an `overrides` key is valid \[D\]. The effective budget of a run is the smaller of the template's `budget` and the policy's `budget` \[D\].

Action ids used by the policy: `fs.write`, `fs.delete` (a `fs.write@1` call with `delete: true`), `fs.write.outside`, `shell.exec`, `git.commit`, `git.push`, `git.merge`, `net.fetch`, `plugin.install`, `mcp.install`, `mcp.call` (an agent calling an MCP tool by name, level 1 of tab 10; asked at level 2 like every action not listed there, and its result is tainted external content [D]), `mcp.sampling`, `runtime.install`, `release.publish`, `vault.write.personal` \[D\]. Patterns use glob syntax \[D\]:

- Path patterns (`never_allow` paths, protected paths): `*` and `?` stay within one folder, `**` crosses folders, `dir/**` also matches `dir` itself, and names that start with a dot match like any other name. `~` is the home folder, and a relative pattern is relative to the workspace root. Paths are compared as absolute paths with `/` separators, without case on Windows.
- Command patterns (`shell.allow`, `never_allow` commands): `*` matches any text, including `/`, and the whole command must match after trimming and collapsing spaces. Commands run in a shell (tab 10), so a command that contains `&`, `|`, `;`, a line break, a backtick, `(`, `)`, `>` or `<` never matches `shell.allow`, even inside quotes, and asks instead. A `never_allow` command rule matches the whole command and also each part of it, where parts are split at `&&`, `||`, `;`, `&`, `|`, line breaks, backticks and parentheses (so the inside of `$(…)` and `(…)` is a part too). A `never_allow` command rule compares without case, since PowerShell and Windows programs ignore it (ADR-063); `shell.allow` keeps case. A `never_allow` list in a policy file replaces the built-in one, so a policy that writes its own keeps the process rules only by listing them.
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
8. A `shell.exec` whose command, trimmed and with collapsed spaces, is in `shell.always`, on a step that is not tainted: allow (ADR-121). It is matched exactly, never as a pattern.
9. Level 1: ask.
10. Level 2: allow `fs.write` inside the workspace or the global `worktrees/` and `snapshots/` folders, except a write to a script manifest (`package.json`, `.npmrc`, `pnpm-workspace.yaml`, `.pnpmfile.cjs`, `lefthook.yml`, `.husky/`, `.git/hooks/` or `.git/config`, anywhere under the workspace folder), which asks, because it changes which program an allow-listed command runs; allow `shell.exec` matching `shell.allow`, `git.commit`, `net.fetch` (its result is tainted external content) and `runtime.install` (runtimes download by themselves, tab 18); ask for everything else, including `fs.write.outside`.
11. An ask (steps 7, 9 and 10) that a grant of the run matches: allow. Grants never change a deny.

The verdict's `rule` names the step: `missing_input` (1), `never_allow:<index>` (2, the rule's position in the list), `protected_path` (3), `autonomy:0` (5), `autonomy:3` or `autonomy:3:outside` (6), `always_ask` (7), `shell.always` (8), `autonomy:1` (9), `autonomy:2:inside`, `autonomy:2:script_manifest`, `shell.allow`, `autonomy:2:action` or `autonomy:2` (10), and `granted:once` or `granted:run` (11) \[D\].

Answering an ask (ADR-121): when a check answers `ask`, the security module publishes `policy.asked` (docs/07) with the run, the action, the capability, the adapter, the rule and the command or path, each masked by `secrets.mask@1`; masking takes time, so the event may come after the `run.paused` the ask caused, and the module publishes every pending one before it stops. `policy.grant@1` `{ runId, scope, ask }` grants such an ask, `ask` being that event's action, capability, adapter and command or path: `once` holds for the first later check of the run that matches it, also on a tainted step, since it is the approval of the very call the user saw; `run` holds for the rest of the run, but not on a tainted step. A check matches a grant of its run with the same action, capability and adapter and, when the ask named one, the same command (trimmed, spaces collapsed) or path (compared as the rules compare paths); an ask that named neither covers every check of its action, capability and adapter, and a command or path that held a secret, which the event masks, matches nothing and asks again, so Always is refused for it. Grants live in the security module's process, so a restart forgets them and the call asks again. Always allow is offered only for a command: the user's command or click writes it to `shell.always` in the folder's `.mete/policy.yaml` (step 8) and grants `once` for the call that waits; every other action is answered once or for the run, because dropping it from `always_ask` would allow far more than one call \[D\].

The policy is read again whenever `.mete/policy.yaml` or the global settings file changes (the size and modification time of both are compared on each check), so a user who edits the policy after a run paused on an ask sees the new decision when the run resumes; an edit that does not parse or validate leaves the last valid policy in force and is logged, and a deleted file returns the defaults \[D\]. `policy.check@1` also takes a `tainted` flag and records it in the audit log; on a tainted step a `shell.always` command and a `run` grant ask again (ADR-121). The core reads a step as the whole attempt: once a `web.fetch@1` or `web.search@1` result joined an attempt's conversation, every later tool call of that attempt passes `tainted: true`, and the next attempt starts untainted [D].

Protected paths: agents MUST NOT write, delete or restore every `.mete/*.yaml` file (the policy, bindings, MCP servers, and the workspace's settings sections: `gateway`, `privacy`, `quota`, `workspace`, `models`), everything under `.mete/teams/` and `.mete/adapters/`, or the workspace's `.meteignore` (ADR-072: each of them changes which rules, providers, privacy choices, limits or teams a run uses, a mapping decides what a capability runs (ADR-120), and a re-include line in `.meteignore` would open the files it hides); only the user changes them, by hand, by a Settings screen on their click, or with a command they run such as `mete registry add` \[D\]. `.mete/assets/`, `.mete/artifacts/`, `.mete/knowledge/` and `.mete/skills/` are agent output and stay writable \[D\]. A task's worktree (`worktrees/<run id>/<task id>/`) is a copy of the workspace that merges back into it, so every rule that names a workspace path (`never_allow`, protected paths, script manifests) judges a path inside one as the same path in the workspace: the worktree's copy of `.mete/policy.yaml` or `.mete/teams/x.yaml` is protected too \[D\].

## Threat model

| Threat | Mitigation |
| --- | --- |
| Prompt injection in web pages, files or MCP results | External content is wrapped and labeled as data. A step that read external content is tainted; at level 2 its `always_ask` actions and all non-allow-listed commands need approval even if they were pre-approved \[C\]. The remembered approvals are a `run` grant and a `shell.always` command (ADR-121), and neither holds on a tainted step; a `once` grant is the approval of the very call that asked, so it holds \[D\] |
| An agent fetches a local service or a cloud metadata address through `web.fetch@1` | Only public `http` and `https` addresses are fetched, checked on every redirect hop; local names and loopback, private, link-local, shared and unspecified addresses are refused. A public name that resolves to a private address is not caught yet; that check comes with any setting that allows local hosts [D] |
| Malicious or hijacked plugin or MCP server | Only the user installs; pinned versions; SHA-256 checks; permissions shown at install; child process; circuit breaker \[C\]. Node-based third-party processes SHOULD start with the Node.js permission model (`--permission` with only the declared paths) \[D\] |
| Secret exfiltration | secretlint masking, `.meteignore`, keychain storage, no secrets in logs \[C\] |
| Allow-listed command run with a planted program | `shell.exec@1` refuses `env` keys that change which program runs or what it loads (tab 10) \[D\] |
| Allow-listed script runner with a planted script (`npm test`, `npm run *` or `pnpm *` after an agent edits `package.json`) | At level 2 a write to a script manifest asks, and checkpoints undo it; worktrees come with Phase 4. Residual: `pnpm *` can itself edit the manifest (`pnpm pkg set`, `pnpm exec`, `pnpm dlx`), the tests an agent writes run as its own code, and nothing runs in a sandbox. Narrowing `shell.allow` waits for the Phase 4 web-dev template, which shows which commands a coding run needs \[D\] |
| Destructive commands | Allow list, `never_allow`, checkpoints, worktrees \[C\] |
| Runaway loops and quota drain | Budgets, revision limit, 25-turn limit per attempt, kill switch \[C\] |
| Agent raising its own rights | Protected paths above; the policy engine runs outside the agent's reach \[D\] |
| Vulnerable METE dependencies | Exact pins, 14-day rule, osv-scanner, license check \[C\] |
| Electron misconfiguration | `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderers, strict CSP, Electronegativity in local CI \[C\] |

Third-party code still runs with the user's operating-system rights; METE enforces permissions on its own APIs and says so in the install dialog \[C\].

## Checkpoints and rollback

- Git workspaces: before every step that may write, METE records the state as a commit under `refs/mete/checkpoints/<run id>/<n>`, which creates no branches \[D\].
- Other workspaces: before the first write to a file in a step, that file is copied to the global `snapshots/<run id>/<n>/` folder, or its absence is recorded; restoring snapshot n undoes every step from n on, and commands run through `shell.exec@1` are not copied (ADR-080) \[D\].
- Every checkpoint can be restored with one click; restoring publishes `rollback.performed`. A restore waits for the run to be paused or ended, changes only files, and first records the current state as a new checkpoint, so it can itself be undone (ADR-079) \[D\].
- Checkpoints are kept 14 days after the run ends \[D\]. The process that drives runs (the one that recovers them) removes older runs' checkpoints when core-engine starts, so a command that only reads never removes them \[D\].

## Kill switch

"Stop all" (a button in the status bar and `Ctrl+Shift+.`) cancels every run, aborts in-flight model calls, rejects pending MCP sampling and pauses triggers \[D\]. It asks nothing first, then says how many runs it cancelled; a cancelled run cannot be resumed (ADR-065). Triggers come with Phase 6, so there are none to pause yet.

## Audit log

Every side-effect action writes a row to the workspace `mete.db`: time, run, agent, action, capability, adapter, SHA-256 of the arguments, decision and matching policy rule. The log is viewable and exportable as JSON \[C\]: `mete audit` prints it, and the desktop's "METE: Open audit log" lists it newest first, filtered by run, verdict and action, and exports the rows it shows as JSON to a file the user picks (ADR-053) \[D\]. `policy.check@1` writes the row in the same call, into the `audit_log` table, with `action` as the caller named it (a `fs.write` the policy treats as `fs.write.outside` is logged as `fs.write`); when the row cannot be written the check returns `audit_failed`, and callers MUST treat that as deny \[D\]. Removing a run deletes its events, model calls and rows but never its audit rows: they record what was done in the folder (ADR-143) \[D\].

## Triggers

| Trigger | Configuration |
| --- | --- |
| Manual | Start button, command palette, CLI `mete run` |
| Schedule | Cron expression in `.mete/workspace.yaml` |
| File change | Glob pattern |
| Issue source | `issues.source@1` with a label filter |
| Webhook | HTTP on 127.0.0.1 only, with a per-trigger token \[D\] |

Triggered runs use priority P2 and the workspace autonomy level. Runs at level 3 MUST use worktrees or snapshots \[C\].
