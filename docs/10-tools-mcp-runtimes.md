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
| `browser.screenshot@1` | url (http or https), fullPage (default false) | path of the image in `.mete/assets/`, width, height | Playwright Chromium, downloaded on first use; `policy.check@1` with `net.fetch`, public addresses only like `web.fetch@1` [D] |
| `seo.audit@1` | url (http or https) | scores (performance, accessibility, bestPractices, seo, each 0-100), audits (id, title, score 0-100 or null when Lighthouse does not score it, details?), reportPath of the full report in `.mete/assets/` | Lighthouse on Playwright Chromium; a category Lighthouse leaves unscored fails the call with `io` naming it, never a 0; the result is external content [D] |

The browser module runs each `browser.screenshot@1` and `seo.audit@1` call in a child process of its own, so a Chromium or Lighthouse crash never reaches the main process; a call that takes longer than 120 seconds is killed, and every failure returns `io` with the last 2000 characters of the child's stderr. A screenshot's page may request public addresses only; an audit checks the page's own address, and Lighthouse loads the page's resources itself. Lighthouse runs through its programmatic API, which never starts its error reporting \[D\]. When Chromium is missing, the first call asks `policy.check@1` for `runtime.install` (allowed at autonomy 2) and runs Playwright's own installer (`playwright install chromium`, at most 10 minutes); calls at the same time share one install, and a failed install returns `io` with the installer's stderr \[D\]. Audits use Lighthouse's defaults, mobile emulation with simulated throttling, so the scores are mobile scores \[D\].

On Windows, file operations retry on lock errors (`EBUSY`, `EPERM`, `EACCES`) 3 times after 100, 300 and 1,000 ms \[D\]. The shell tool tells the model the operating system and shell name in every call \[C\].

Rules shared by the file and shell tools (types in tab 06) \[D\]:

- Reads (`fs.read@1`, `fs.list@1`, `fs.glob@1`, `fs.grep@1`) stay inside the workspace and the global `worktrees/` folder. Paths are resolved through symbolic links before any check; a new file uses its parent folder. A delete removes a link itself, never the file it points to; the checks still use the target. On Windows a path that names an NTFS stream (a colon after the drive letter, such as `policy.yaml::$DATA`) is refused with `bad_input` before any check, because the stream name would slip past the protected paths.
- Every write asks `policy.check@1` first: `fs.write@1` and `fs.edit@1` with action `fs.write`, or `fs.write.outside` outside the workspace and worktrees; a delete with `fs.delete`; `shell.exec@1` with `shell.exec` and the command. A `deny` verdict returns `denied` and an `ask` verdict returns `approval_required`, both with the verdict's rule; the core then pauses the run with reason `approval`, and resume repeats the call; the core does not remember such approvals yet. Team tasks that wait for the human are answered with `mete approve` and `mete revise` instead (tab 08).
- `web.fetch@1` asks `policy.check@1` with action `net.fetch`, then fetches the page with every redirect hop checked: at most 5 redirects, `http` or `https` only, and never `localhost`, a `.local`, `.localhost`, `.internal` or `.home.arpa` name, or a loopback, private, link-local, shared or unspecified address (`bad_input`). It reads at most 5,000,000 bytes within 30 seconds; HTML becomes Markdown through Readability (the whole body when it finds no article) and turndown, other `text/*` is kept as is, and any other type is `bad_input`. A network error, a timeout, an HTTP error status or a larger page is `io` [D].
- `web.search@1` asks `policy.check@1` with action `net.fetch` too. Its default adapter is the level 2 mapping `exa-mcp` over the built-in keyless `exa` server (MCP client, below); the CLI's built-in binding is `web.search@1: [exa-mcp, tavily]`, which `bindings.yaml` replaces, and a failed Exa call falls back to Tavily (tab 06, Capability resolution) \[D\]. tools-web provides the Tavily adapter, id `tavily` (`POST https://api.tavily.com/search` with the key as a bearer token, at most 20 results) only when the keychain has `search/tavily/apiKey`, set with `mete key set tavily`; without the key tools-web still provides `web.fetch@1` and logs a warning. Search providers keep their keys under `search/<id>/apiKey`, model providers under `providers/<id>/apiKey` (tab 09). A refused key, a spent plan or an answer that does not parse is `io`. The Exa API, You.com and Firecrawl adapters come when a key for them is in use [D].
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

Each saved file adds one line to `.mete/assets/manifest.jsonl`: `path`, `mediaType`, `bytes`, `sha256`, the `server` and `tool` that made it, the `runId` when the call has one, and `at` \[D\]. A license field joins with the Assets view (tab 13).

Cancelling a run sends `notifications/cancelled` for the call in flight (pausing lets it finish, docs/08). A progress step goes to the log until the team panel shows it in Phase 5, and a call that reports progress is not cut off by the request timeout. A `tools/list_changed` notice makes the client read the server's tool list again, so the next call sees the new tools \[D\].

A stdio server starts in the workspace folder, not in the folder `mete` was launched from, and the client tells every server that folder as its one root \[D\]; the vault roots join it in Phase 4.

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

`McpConfigSchema` in `@mete/contracts` checks the file: server ids are kebab-case and unique, a stdio server names its `runtime` and `command` (`args` default to none), a `binary` one also its `https` `url` and lowercase `sha256` and no other runtime has them, a remote server has an `http` or `https` `url` and `auth` `none` unless set, and `permissions` default to none; unknown keys are refused \[D\].

The mcp-client module provides `mcp.tools@1`. It starts a server on the first call that names it, and listing tools starts every configured server; it keeps one connection per server and reconnects after a close. Every call asks `policy.check@1` with action `mcp.call` before the server starts. Images are saved in `.mete/assets/` and named by path; audio and binary resources are saved there too and linked by their file URL. A server that cannot start or answer returns an `io` error with the last 2000 characters of its stderr; a server that fails while tools are listed is logged and skipped. Before a stdio server starts, `runtime.ensure@1` makes its `runtime` ready and puts its folder first on the server's `PATH`, so `command` runs as configured; for a `binary` server that folder holds its `url` download, checked against its `sha256`. Until OAuth lands, `auth: oauth` servers are refused with a message \[D\]. One server is built in: `exa`, Exa's hosted server at `https://mcp.exa.ai/mcp?tools=web_search_advanced_exa`, which needs no key; an `mcp.yaml` entry with the id `exa` replaces it (for example the same URL with `&exaApiKey=` for higher limits), and every other built-in fills in only where no entry has its id \[D\].

## Integration levels

| Level | Effort | What it gives |
| --- | --- | --- |
| 1 Raw | None | An agent with the right permission can call the server's tools directly by name |
| 2 Mapping | A YAML file | The server, CLI or HTTP API implements a METE capability and can be bound |
| 3 Code | A TypeScript adapter | Multi-step logic, conversions, special error handling |

Level 1: a team role whose capabilities name `mcp.tools@1` gets each tool of each configured server as one model tool, `mcp_<server>_<tool>` with every character other than letters, digits, `_` and `-` turned into `_`, the server's input schema as its parameters, and a description that names the server. Templates never name servers (tab 08). A tool is left out, with a warning naming the server, the tool and the reason, when its name would exceed 64 characters, repeats an earlier name or its input schema is not an object. The tools are listed on every model call of such a role, so the first call starts every configured server (MCP client). A call goes to `mcp.tools@1` `call` with the server, the tool and the arguments, so it asks `mcp.call`; its result is external content, labeled and tainting like a web result, and it takes no checkpoint and never moves to another adapter \[D\].

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

Template expressions use `{{path}}` with the filters `join` and `json` only \[D\]. A path starts from `input` (the capability input), `result` (what the tool returned), `workspace` (`workspace.path`) or `item` (inside `each`). For an MCP tool, `result` is the structured content when the server sends it, otherwise the text blocks parsed as JSON when they parse to an object, otherwise an object with only `text`; `result.text` always holds the joined text blocks. A string that is exactly one expression keeps the value's type (a list stays a list); expressions inside longer text become text. `{ each: "{{result.results}}", as: { title: "{{item.title}}" } }` maps a list item by item. The mapped output MUST pass the capability's output schema in `@mete/contracts` (`MAPPABLE_OUTPUTS`), or the call fails with an error naming the mapping, the capability and the field; a capability with no output schema there cannot be mapped yet. Each `implements` entry names the policy `action` its calls ask (`mcp.call` when unset), and `AdapterMappingSchema` in `@mete/contracts` checks the file \[D\]. The mcp-client module reads the built-in `adapters/` folder when it starts and provides each entry under its mapping id; a file that fails the schema, a `cli` or `http` mapping (not run yet), an id used twice, a server missing from `mcp.yaml` or a capability with no output schema is skipped with a warning naming the file and the reason \[D\]. Bindings choose among adapters:

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
| Binary | The server's `url` and `sha256` in `mcp.yaml`, copied from its registry entry; mismatch aborts \[D\] | Used for native servers |
| Container | Only when `docker` or `podman` is already installed | Otherwise such servers stay inactive with a notice \[C\] |

The mcp-client module provides `runtime.ensure@1` (`RuntimeEnsureInputSchema` in `@mete/contracts`). Its input is `{runtime: node | python | container}` or `{runtime: binary, url, sha256}` with an `https` URL and a lowercase SHA-256; its output is `{binDir}`, the folder holding the runtime's commands, which the caller puts first on the child process's `PATH` and runs the configured command unchanged \[D\]. Node.js 24.21.0 and uv 0.12.23 are pinned with the SHA-256 of their `win-x64` and `linux-x64` archives in `packages/mcp/src/defaults.ts`; another platform gets a `not_found` error naming it \[D\]. A download happens only when a server first needs the runtime, never at startup, and asks `policy.check@1` with action `runtime.install` first. The archive is checked against its SHA-256 before it is opened, a mismatch aborts, and the system `tar` (bsdtar on Windows 10 and newer, GNU tar on Linux) extracts it into a partial folder that is renamed into place only when complete: `runtimes/node/<version>/`, `runtimes/uv/<version>/` and `runtimes/bin/<sha256>/` in the global folder \[D\]. A binary URL that is not a `.zip`, `.mcpb` (a zip bundle), `.tar.gz` or `.tgz` archive is saved as one executable file named by the URL's last segment. GNU tar reads no zip archives, so on Linux a `.zip` or `.mcpb` binary fails with `io` until a zip reader is chosen \[D\]. `container` downloads nothing: it returns the folder of `docker` or `podman` found on `PATH`, or `not_found`. A download and extract that together take longer than 10 minutes fail with `io` \[D\].

## Plugins, skills and extensions

- Plugin: a METE module package with a manifest, installed into the global `plugins/` folder, always in its own process (third-party trust) \[C\].
- Install rule: agents MAY find and propose a plugin or MCP server; only the user installs it, after seeing its permissions. Versions are pinned \[C\].
- Skills: `SKILL.md` folders in `.mete/skills/` (workspace) and the global `skills/` folder; matched to tasks by their description \[C\].
- VS Code extensions: installed through Theia from Open VSX. They become agent tools only if they expose an MCP server \[D\].

## Registries

`registry.search@1` adapters, in order: the official MCP registry, the METE registry (a git repository with `index.json`), a local folder \[C\]. A registry entry holds: id, kind (`mcp`, `plugin`, `skill`, `template`, `mapping`), version, source URL, SHA-256, runtime, permissions, description.

The registry module (`@mete/mcp`) provides `registry.search@1` (`RegistrySearchInputSchema` in `@mete/contracts`). Its input is `{query, kind?}`; its output is `{entries}`, each `{id, kind, version, description, source, runtime, sha256?, permissions}` at its newest version only, and a search never installs anything \[D\]. Only the official MCP registry adapter exists yet: it asks `policy.check@1` with action `net.fetch`, then reads `https://registry.modelcontextprotocol.io/v0.1/servers?search=<query>&version=latest&limit=20` within 30 seconds with its own fetch (adapter id `official-mcp-registry`), because the registry answers JSON and `web.fetch@1` takes pages only \[D\]. Its entries are kind `mcp`, so a search for another kind finds none. The first package of a known type gives the runtime and the source: `npm` gives `node` and `npm:<identifier>`, `pypi` gives `python` and `pypi:<identifier>`, `oci` gives `container` and `oci:<identifier>`, `mcpb` gives `binary` with its download URL and its `fileSha256`; a server with no such package and a remote gives `remote` and the remote's URL; any other server is left out. The official registry names no permissions and hashes only `mcpb` files, so its other entries have no `sha256` and all have empty `permissions` \[D\]. A network error, an HTTP error status or an answer that does not parse is `io`. The METE registry and the local folder wait until their repository and folder are chosen \[D\].

`mete registry add <name>` is how the user installs an official registry server; agents never run it (Install rule). It asks `net.fetch`, reads `https://registry.modelcontextprotocol.io/v0.1/servers/<name>/versions/latest` and appends one entry to the workspace's `.mete/mcp.yaml`, keeping the file's comments and other entries; nothing is written unless the whole file still passes `McpConfigSchema` \[D\]. The entry's id is the last segment of the name, lowercased with every other character run turned into `-`; an id already in the file or used by a built-in server is refused. The first `npm` or `pypi` package served over stdio becomes `npx -y <identifier>@<version>` or `uvx <identifier>==<version>`; one whose version is missing or `latest` is refused, because versions are pinned. Without such a package, the first `streamable-http` or `sse` remote becomes a remote entry with `auth: none`. `oci` and `mcpb` packages are refused with a hint to edit `mcp.yaml` by hand \[D\]. The command prints the entry, that the registry names no permissions for it, and one `to do:` line for each required environment variable, required package argument or required remote header, which the user fills in \[D\].

## METE as an MCP server

`mete mcp` serves stdio; the desktop can also serve Streamable HTTP on 127.0.0.1 \[D\]. Exposed tools: `mete_run_team`, `mete_task_status`, `mete_approve`, `mete_knowledge_search` \[D\]. Other tools (Claude Code, Cursor, Cline) can then use METE teams and knowledge.

The mcp-server module (`@mete/mcp`) serves these tools over the transport its host gives it \[D\]:

| Tool | Input | Result |
|---|---|---|
| `mete_run_team` | `{goal, templateId?}` | `{runId}` at once; the run goes on in the background |
| `mete_task_status` | `{runId}` | `{status, reason?, tasks: [{id, title, status}], output?, artifacts: [path]}`; `reason` is the pause reason or the failure, `output` the summary of a completed run, tasks and artifacts come from the run's events |
| `mete_approve` | `{runId, taskId?, decision: approve\|revise, feedback?}` | `{runId}`; a revision needs feedback (`team.engine@2` approve) |
| `mete_knowledge_search` | `{query}` | always an error until the knowledge base exists (Phase 4) |

Every refusal of `team.engine@2` is a tool result with `isError` and the text `<code>: <message>`; a router that is unsure lists the templates to choose from.

`mete mcp [<folder>]` serves one workspace: the folder given, else the current one. Hosts that start servers elsewhere (Cursor, Cline, Claude Desktop) pass the folder \[D\]. When the host leaves, the runs it started stop with the process and come back paused on the next start (tab 07, recovery) \[D\]. To add it:

- Claude Code, from the project folder: `claude mcp add mete -- mete mcp`
- Other hosts: `{"mcpServers": {"mete": {"command": "mete", "args": ["mcp", "<folder>"]}}}`
