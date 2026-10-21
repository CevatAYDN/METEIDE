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

The effective budget of a run is the smaller of the template's `budget` and the policy's `budget` \[D\].

Action ids used by the policy: `fs.write`, `fs.delete` (a `fs.write@1` call with `delete: true`), `fs.write.outside`, `shell.exec`, `git.commit`, `git.push`, `git.merge`, `net.fetch`, `plugin.install`, `mcp.install`, `mcp.sampling`, `runtime.install`, `release.publish`, `vault.write.personal` \[D\]. Patterns use glob syntax.

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

Every side-effect action writes a row to the workspace `mete.db`: time, run, agent, action, capability, adapter, SHA-256 of the arguments, decision and matching policy rule. The log is viewable and exportable as JSON \[C\].

## Triggers

| Trigger | Configuration |
| --- | --- |
| Manual | Start button, command palette, CLI `mete run` |
| Schedule | Cron expression in `.mete/workspace.yaml` |
| File change | Glob pattern |
| Issue source | `issues.source@1` with a label filter |
| Webhook | HTTP on 127.0.0.1 only, with a per-trigger token \[D\] |

Triggered runs use priority P2 and the workspace autonomy level. Runs at level 3 MUST use worktrees or snapshots \[C\].
