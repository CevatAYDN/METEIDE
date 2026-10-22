# 10 Tools, MCP and runtimes

Repository file: `docs/10-tools-mcp-runtimes.md`. Depends on: 06 Kernel and modules, 12 Autonomy and security.

Built-in tools cover files, shell, web and git; everything else arrives through MCP servers, CLI or HTTP adapters bound to capabilities, at one of three integration levels.

## Built-in tools

| Capability | Input | Output | Rules |
| --- | --- | --- | --- |
| `fs.read@1` | path, startLine?, endLine? | content, totalLines, lineEnding | Workspace or worktree only; `.meteignore` paths refused |
| `fs.write@1` | path and content (createOnly?), or path and delete: true | bytes written | Workspace or worktree; elsewhere only when `policy.check@1` allows `fs.write.outside`; the step was checkpointed first |
| `fs.edit@1` | path, oldStr, newStr, replaceAll? | replacements | `oldStr` MUST match exactly once unless `replaceAll`; otherwise an error with the match count. The file's existing line endings are kept \[C\] |
| `fs.list@1`, `fs.glob@1` | path or pattern | paths | Respects `.gitignore` and `.meteignore` |
| `fs.grep@1` | pattern, glob?, caseSensitive?, maxResults (default 200) | matches with file and line | ripgrep |
| `shell.exec@1` | command, cwd?, timeoutSec (default 120), env? | exitCode, stdout, stderr | Output cut to 30,000 characters per stream \[D\]; policy allow list; Windows default shell PowerShell, Git Bash when configured \[C\] |
| `web.fetch@1` | url | markdown, title, finalUrl | readability + turndown; output cut to 100,000 characters \[D\] |
| `web.search@1` | query, maxResults (default 8) | title, url, snippet per result | Fallback chain from 06 Kernel and modules |
| `vcs.git@1` | operation: status, diff, commit, merge, worktree create or remove, checkpoint create, restore or prune | operation result | git CLI through simple-git; worktree and merge come with the team engine (Phase 2) |
| `browser.screenshot@1` | url or file, viewport | image artifact | Playwright Chromium, downloaded on first use |
| `seo.audit@1` | url, categories | score and findings per category | Lighthouse on Playwright Chromium |

On Windows, file operations retry on lock errors (`EBUSY`, `EPERM`, `EACCES`) 3 times after 100, 300 and 1,000 ms \[D\]. The shell tool tells the model the operating system and shell name in every call \[C\].

Rules shared by the file and shell tools (types in tab 06) \[D\]:

- Reads (`fs.read@1`, `fs.list@1`, `fs.glob@1`, `fs.grep@1`) stay inside the workspace and the global `worktrees/` folder. Paths are resolved through symbolic links before any check; a new file uses its parent folder. A delete removes a link itself, never the file it points to; the checks still use the target. On Windows a path that names an NTFS stream (a colon after the drive letter, such as `policy.yaml::$DATA`) is refused with `bad_input` before any check, because the stream name would slip past the protected paths.
- Every write asks `policy.check@1` first: `fs.write@1` and `fs.edit@1` with action `fs.write`, or `fs.write.outside` outside the workspace and worktrees; a delete with `fs.delete`; `shell.exec@1` with `shell.exec` and the command. A `deny` verdict returns `denied` and an `ask` verdict returns `approval_required`, both with the verdict's rule; the core then pauses the run with reason `approval`, and resume repeats the call; the core does not remember such approvals yet. Team tasks that wait for the human are answered with `mete approve` and `mete revise` instead (tab 08).
- `web.fetch@1` asks `policy.check@1` with action `net.fetch`, then fetches the page with every redirect hop checked: at most 5 redirects, `http` or `https` only, and never `localhost`, a `.local`, `.localhost`, `.internal` or `.home.arpa` name, or a loopback, private, link-local, shared or unspecified address (`bad_input`). It reads at most 5,000,000 bytes within 30 seconds; HTML becomes Markdown through Readability (the whole body when it finds no article) and turndown, other `text/*` is kept as is, and any other type is `bad_input`. A network error, a timeout, an HTTP error status or a larger page is `io` [D].
- `web.search@1` asks `policy.check@1` with action `net.fetch` too. Until the MCP client (Phase 3) brings Exa MCP, it needs an HTTP key: tools-web provides it through Tavily (`POST https://api.tavily.com/search` with the key as a bearer token, at most 20 results) only when the keychain has `search/tavily/apiKey`, set with `mete key set tavily`; without the key tools-web still provides `web.fetch@1` and logs a warning. Search providers keep their keys under `search/<id>/apiKey`, model providers under `providers/<id>/apiKey` (tab 09). A refused key, a spent plan or an answer that does not parse is `io`. The Exa API, You.com and Firecrawl adapters come when a key for them is in use [D].
- The default `.meteignore` lines from tab 09 always apply; the workspace's `.meteignore` adds lines on top and MAY re-include a default with `!`. Ignored files are refused by `fs.read@1`, `fs.edit@1` and `fs.write@1` (writes and deletes, so an agent never replaces a file such as `.env` that no checkpoint holds) and left out of `fs.list@1`, `fs.glob@1` and `fs.grep@1`.
- Text is UTF-8; a file with a NUL byte in its first 8 KB is `binary`. `fs.edit@1` matches `oldStr` and `newStr` with LF line endings in a CRLF file and writes CRLF back; in a file with mixed endings it matches the raw text.
- `shell.exec@1` runs `powershell.exe -NoProfile -NonInteractive -Command <command>` on Windows and `/bin/sh -c <command>` elsewhere, as a child process with separate stdout and stderr and no stdin, in `cwd` (default: the workspace root), which stays inside the workspace and worktrees like a read; `env` adds variables to the inherited environment, except keys that change which program runs or what it loads, which are refused with `bad_input` because the policy sees only the command: `PATH`, `PATHEXT`, `PSModulePath`, `COMSPEC`, `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_*`, `PYTHONPATH`, `PYTHONSTARTUP`, `PERL5OPT`, `RUBYOPT`, `BASH_ENV`, `ENV`, `GIT_*`, the bash tracing keys `SHELLOPTS`, `BASHOPTS` and `PS4`, exported bash functions `BASH_FUNC_*`, the .NET hooks `COR_*`, `CORECLR_*`, `COMPlus_*` and `DOTNET_*`, and any key that is not a plain name (letters, digits and `_`, not starting with a digit), compared without case. A NUL byte in a command, an `env` value or a grep pattern or glob is refused with `bad_input`. The `shell` settings section picks Git Bash on Windows: `shell: { windows: git-bash, gitBashPath: <path> }` (default `windows: powershell`); when Git Bash is chosen but not found, the call fails with `io`. PowerShell first sets its console output to UTF-8, and after the command exits with 0 when the last statement succeeded, otherwise with the last native exit code, or 1 for a failed cmdlet; without this, it reports 1 for any failed native command and garbles non-ASCII cmdlet output. A timeout kills the whole process tree and reports `exitCode: null`; a cancelled run kills it the same way and the call fails with `io`.
- A stream longer than 30,000 characters keeps its first and last 15,000 characters with a `[<n> characters cut]` line between them.
- `vcs.git@1` runs git in the workspace. When the workspace is not a git repository or git is missing, the module fails to activate, so the chain is empty and core uses file snapshots (tab 06). `commit` asks `policy.check@1` with action `git.commit`; `status`, `diff` and the checkpoint operations have no policy action. A `diff` is cut like a shell stream. There is no push operation.
- `checkpoint.create` records the working tree, untracked files included and ignored files left out, as a commit whose parent is `HEAD` (none before the first commit), under the next free `refs/mete/checkpoints/<run id>/<n>`; it uses its own index file and the author and committer `METE`, so it changes no branch, no `HEAD` and not the user's index. `checkpoint.restore` takes only such a ref and brings only the working tree back to that commit: changed files revert, deleted files return and files added since, unless ignored, are removed; `HEAD`, the index, ignored files and the protected paths (`.mete/policy.yaml`, `.mete/bindings.yaml`, `.mete/mcp.yaml`, `.meteignore`) stay as they are, except that a folder standing where the checkpoint had a file is removed with everything in it, ignored files included, so the file can return. `checkpoint.prune` deletes the refs of one run.

## MCP client

METE supports the whole protocol, not only tool calls \[C\]:

| Feature | METE behavior |
| --- | --- |
| Transports | stdio, Streamable HTTP, legacy SSE |
| Authentication | OAuth for remote servers; tokens in the keychain |
| Tools, resources, prompts | Exposed to agents through capabilities or raw access (level 1) |
| Sampling | Routed through the gateway and the quota pool; the first request of each server asks the user once \[D\] |
| Elicitation | Desktop opens a form; CLI asks in the terminal |
| Roots | The workspace root and the vault roots the policy allows |
| Progress, cancellation, list changes | Shown in the UI; cancellation follows run cancellation |
| Content types | Text, image, audio, resource links; binary results are saved in `.mete/assets/` with a manifest entry |

Server configuration lives in `.mete/mcp.yaml` (workspace) and in global settings:

```yaml
servers:
  - id: blender
    transport: stdio
    runtime: python                 # node | python | binary | container
    command: uvx
    args: ["blender-mcp==<pinned version>"]
    permissions: [fs.read, fs.write]
  - id: hf-spaces
    transport: streamable-http
    url: https://huggingface.co/mcp
    auth: oauth
```

Configuration files and bindings MAY name servers and tools. Team templates MUST NOT \[C\].

`McpConfigSchema` in `@mete/contracts` checks the file: server ids are kebab-case and unique, a stdio server names its `runtime` and `command` (`args` default to none), a remote server has an `http` or `https` `url` and `auth` `none` unless set, and `permissions` default to none; unknown keys are refused \[D\].

The mcp-client module provides `mcp.tools@1`. It starts a server on the first call that names it, and listing tools starts every configured server; it keeps one connection per server and reconnects after a close. Every call asks `policy.check@1` with action `mcp.call` before the server starts. Images are saved in `.mete/assets/` and named by path; audio and binary resources are saved there too and linked by their file URL. A server that cannot start or answer returns an `io` error with the last 2000 characters of its stderr; a server that fails while tools are listed is logged and skipped. Until the runtime manager and OAuth land, `command` runs as configured and `auth: oauth` servers are refused with a message \[D\].

## Integration levels

| Level | Effort | What it gives |
| --- | --- | --- |
| 1 Raw | None | An agent with the right permission can call the server's tools directly by name |
| 2 Mapping | A YAML file | The server, CLI or HTTP API implements a METE capability and can be bound |
| 3 Code | A TypeScript adapter | Multi-step logic, conversions, special error handling |

Level 2 mapping file:

```yaml
# adapters/3dsmax-mcp.yaml
apiVersion: mete/v1
kind: AdapterMapping
metadata: { id: 3dsmax-mcp, version: 1.0.0 }
type: mcp                           # mcp | cli | http
server: 3dsmax
implements:
  3d.cleanup@1:
    tool: run_maxscript
    args: { script: "optimize_mesh '{{input.file}}' ops:#({{input.ops | join(',')}})" }
    output: { file: "{{result.path}}", report: "{{result.text}}" }
    features: [decimate, uv_unwrap]
```

A CLI mapping, for example a game engine build:

```yaml
type: cli
implements:
  gameengine.build@1:
    command: "{{config.enginePath}}"
    args: ["-batchmode", "-quit", "-projectPath", "{{workspace.path}}", "-executeMethod", "{{config.buildMethod}}", "-logFile", "-"]
    success: { exitCode: 0 }
    output: { log: "{{stdout}}" }
```

Template expressions use `{{path}}` with the filters `join` and `json` only \[D\]. Bindings choose among adapters:

```yaml
# .mete/bindings.yaml
3d.cleanup@1: [blender-mcp, 3dsmax-mcp]
gameengine.build@1: [unity-cli]
web.search@1: [exa-mcp, tavily, exa-api, youcom, firecrawl]
```

When a new MCP server is added, an agent MAY draft a level 2 mapping from its tool list. The draft activates only after the user approves it and it passes the capability's contract test kit \[C\].

## Managed runtimes

| Runtime | Source | Rule |
| --- | --- | --- |
| Node.js | System `node` and `npx` when version 20 or newer; otherwise the official Node.js 24 LTS archive into `runtimes/node/` \[D\] | Used for `npx` servers |
| Python | uv binary into `runtimes/uv/`; uv installs the Python version a server needs | Used for `uvx` servers and optional engines \[C\] |
| Binary | Download URL and SHA-256 from the registry entry; mismatch aborts \[D\] | Used for native servers |
| Container | Only when `docker` or `podman` is already installed | Otherwise such servers stay inactive with a notice \[C\] |

## Plugins, skills and extensions

- Plugin: a METE module package with a manifest, installed into the global `plugins/` folder, always in its own process (third-party trust) \[C\].
- Install rule: agents MAY find and propose a plugin or MCP server; only the user installs it, after seeing its permissions. Versions are pinned \[C\].
- Skills: `SKILL.md` folders in `.mete/skills/` (workspace) and the global `skills/` folder; matched to tasks by their description \[C\].
- VS Code extensions: installed through Theia from Open VSX. They become agent tools only if they expose an MCP server \[D\].

## Registries

`registry.search@1` adapters, in order: the official MCP registry, the METE registry (a git repository with `index.json`), a local folder \[C\]. A registry entry holds: id, kind (`mcp`, `plugin`, `skill`, `template`, `mapping`), version, source URL, SHA-256, runtime, permissions, description.

## METE as an MCP server

`mete mcp` serves stdio; the desktop can also serve Streamable HTTP on 127.0.0.1 \[D\]. Exposed tools: `mete_run_team`, `mete_task_status`, `mete_knowledge_search` \[D\]. Other tools (Claude Code, Cursor, Cline) can then use METE teams and knowledge.
