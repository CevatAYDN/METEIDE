# 11 Knowledge layer

Repository file: `docs/11-knowledge-layer.md`. Depends on: 06 Kernel and modules, 09 Models, providers and quota.

Agents find knowledge in this order: code graph, then grep, then reading files; long-term memory lives in two Obsidian-compatible vaults; one hybrid search serves all of it \[C\].

## Code knowledge graph (`code.graph@1`)

- Structural pass: web-tree-sitter grammars. First languages: TypeScript, JavaScript, C#, GDScript, Python, HTML, CSS, JSON, Markdown \[D\]. It runs on every file change, costs no quota and marks edges `EXTRACTED` \[C\].
- Node kinds: file, module, class, interface, type, function, method, exported variable, concept. Edge kinds: contains, defines, imports, calls, extends, implements, references.
- Semantic pass (optional, uses `llm.chat@2`): only for files that agents touched in a run or that the user opened; adds concept nodes and `INFERRED` edges with a score from 0 to 1; runs at quota priority P2 \[C\].
- Incremental: `@parcel/watcher` plus a per-file SHA-256 cache; only changed files are parsed again \[C\].
- Storage: tables `graph_nodes` and `graph_edges` in the workspace `mete.db`; graphology in memory for traversal.
- Freshness: a node whose file hash changed since extraction is returned with `stale: true` \[C\].
- Rule: an agent MUST read the source file before editing based on an `INFERRED` edge \[C\].
- Graphify MAY serve `code.graph@1` through an MCP or skill adapter instead of the built-in graph \[C\].

## Vaults (`vault.read@1`, `vault.write@1`)

| Vault | Location | Holds | Goes to git |
| --- | --- | --- | --- |
| Personal | Chosen at onboarding, default `Documents/METE Vault` | The user's preferences, cross-project lessons, journal | No (it is outside workspaces) |
| Workspace | `.mete/knowledge/` | Project decisions, entities, lessons, run reports | Yes |

Folder layout of both vaults \[D\]:

```
decisions/   why something was chosen
lessons/     what worked or failed (artifact type lesson@1)
entities/    characters, customers, keywords, places, people as roles
journal/     YYYY-MM-DD.md daily notes and run reports
inbox/       notes waiting for human review
preferences.md   (personal vault only) how the user wants agents to work
```

Note frontmatter \[D\]:

```yaml
---
type: lesson            # decision | lesson | entity | journal | inbox
title: Write collision tests early
created: 2026-10-21T10:00:00Z
updated: 2026-10-21T10:00:00Z
source: run/<run id>    # or human
tags: [testing, game-studio]
private: false          # true = never retrieved for a model
pinned: false           # true = never ages (Aging and restore)
---
```

Links are Obsidian `[[wikilinks]]`; backlinks are indexed. Both vaults open in Obsidian unchanged \[C\].

Writing rules, to keep the vault clean \[C\]:

- Agents MAY write only `lesson`, `entity`, `journal` and `decision` notes.
- Default limit: 3 new notes per run \[D\].
- Before writing, the agent searches for a similar note; similarity of 0.85 or more updates that note instead \[D\].
- A weekly consolidation job (autonomy module, priority P2) proposes merges and deletions; the user approves them \[D\].
- A lesson that appears in 2 or more workspaces is proposed for promotion to the personal vault. At autonomy level 3 promotion is automatic \[D\].
- Personal notes are retrieved only when relevant and are never copied into workspace files \[C\].
- ai-memory MAY serve `knowledge.search@1`, `vault.read@1` and `vault.write@1` through an MCP mapping, as Graphify may serve `code.graph@1`; the built-in modules stay the default (ADR-041) \[C\].

Both tools are model tools (`vault_read`, `vault_write`) over the workspace vault, offered to a team role whose capabilities name them; the single agent keeps the `fs`, `shell` and `vcs` tools (tab 08). Their shapes are in tab 06 (ADR-145) \[D\]:

- `vault.read@1` answers a note as written. A note with `private: true` is refused with `ignored`; a path that leaves the vault or enters `.history/` is `bad_input`.
- `vault.write@1` writes a lesson, entity or decision note to `<folder>/<slug>.md` with `source: run/<run id>`, or appends `### <title>` and the body to the day's journal note. The slug is the title in NFKD without combining marks, lower case, each run of other characters than letters and digits one `-`, trimmed and cut at 60 characters; an empty slug is `bad_input`, and a Windows device name gets `-note` appended.
- A note whose slug exists in its folder is updated instead: its body is replaced, `created` and `source` are kept, `updated` is set and the tags are merged; a note with `private: true` there is never replaced (`ignored`). The title match stands in for the 0.85 similarity until embeddings come.
- The 3-notes limit counts the run's new lesson, entity and decision notes, from its `vault.note.saved` events (`events.read@1`); a 4th is `bad_input`.
- Notes are read and written through `fs.read@1` and `fs.write@1` without the task's worktree, so the policy, `.meteignore` and the audit apply (as `fs.write@1`), and a note lands in the workspace vault. Every write, run reports included, goes through one queue.
- `scope: personal` answers `not_found` until the personal vault's folder is chosen at onboarding.

## Run reports

When a run ends (`run.completed`, `run.failed` or `run.cancelled`) the vault module appends a section for it to the workspace vault's `journal/YYYY-MM-DD.md`, the local date of the ending event: goal, status, models used, tool calls per capability, failed calls with their error codes, checkpoints, changed files and the summary, built from the run's persisted events (`events.read@1`) without a model call, after its handoff is written, so the changed files are its `handoff.created` `files`. The section stays when the run is removed, as its artifacts do (ADR-143, ADR-144). Prompts and tool output are never copied. Run reports and handoffs (tab 08, Run memory) are written by METE itself (the core for handoffs, the vault module for run reports), not by agents, and do not count toward the 3-notes limit \[D\].

## Aging and restore

Memory ages without a model call (ADR-041, ideas from ai-memory) \[D\]:

- Each note has a retention score: `salience · e^(−0.02 · age in days) + 0.6 · ln(1 + accesses) · e^(−0.04 · days since the last access)`, with salience 1.0 for `decision` and `entity`, 0.8 for `lesson` and 0.5 for `journal`. Decisions, entities and notes with `pinned: true` in their frontmatter never age.
- An access is a note returned by `knowledge.search@1`, read through `vault.read@1` or reached through backlink expansion, counted at most once per note per 60 seconds.
- A note whose score falls below 0.20 is cold: hybrid search ranks it after the others, and nothing is deleted.
- The weekly consolidation proposes, for the user to approve: compacting a cold note to its frontmatter, title, first paragraph and extracted facts (file paths, error codes, capability ids, decisions); merging notes with similarity 0.85 or more; and flagging likely contradictions, notes of the same type that share a tag with similarity from 0.40 to 0.75. A flag is advice; it changes nothing by itself.
- Before any automated rewrite or merge, the previous version is copied to `<vault>/.history/<note path>/<timestamp>.md`; `vault restore` brings a version back. Nothing is deleted without the user's approval.
- A checkpoint rollback (tab 10) leaves the workspace vault as it is, so the notes and run reports written after the checkpoint stay (ADR-146).

## Hybrid search (`knowledge.search@1`)

Input: `query`, `scope` (`workspace` | `personal` | `all`, default `all`), `k` (default 8), optional filters on note type and path.

1. Keyword: FTS5 BM25 over code chunks and notes.
2. Vector: sqlite-vec cosine similarity over `llm.embed@1` embeddings.
3. Graph: one-hop expansion from the top results; `EXTRACTED` edges weigh 1.0, `INFERRED` edges 0.5 \[D\].
4. Backlinks: notes that link to or from the top notes.
5. Fusion: Reciprocal Rank Fusion with k = 60. Workspace results weigh 1.0, personal results 0.7 \[D\].
6. Rerank: when `llm.rerank@1` exists and the caller marks the query important (review and approval contexts), the top 30 are reranked \[D\].

Degradation: no embeddings → no vector source; no graph → no graph source; no vault → code only; no knowledge-search module → plain ripgrep \[C\].

Output: the results best first, at most `k`, each with the note's path relative to the vault, its scope, type and title, the matching section's heading, a snippet of the section of at most 40 tokens (the whole note is read through `vault.read@1`) and its rank in each source that found it. Today the keyword source answers alone, over the workspace vault's notes (ADR-149) \[D\]:

- The index is the FTS5 table `knowledge_chunks` and the table `knowledge_files` in the workspace `mete.db`: one row per heading section, a section over 1,000 tokens split into several rows, frontmatter left out, tokenizer `unicode61` with accents folded. The dotless `ı` is not folded into `i`.
- A note's title is its frontmatter `title`, else its first `#` heading, else its file name; its type is its frontmatter `type` when that is one of the five above, else its folder's. A note with neither, such as a file at the vault's top, is not indexed; a workspace without a vault answers no results.
- Before each search the vault's `.md` files are listed through `fs.glob@1` and read through `fs.read@1`, so `.meteignore` applies; a note whose SHA-256 is unchanged is not indexed again. `.history/` and notes with `private: true` are never indexed.
- Each word of the query is searched as a phrase, never as FTS5 syntax; results are ordered by BM25, then by path.
- `scope: personal` answers `not_found` until the personal vault's folder is chosen; `all` answers the workspace's results.
- The model tool `knowledge_search` goes to a team role whose capabilities name `knowledge.search@1`; the single agent keeps the `fs`, `shell` and `vcs` tools (tab 08).

## Indexing

- Chunking \[D\]: code by symbol up to 1,500 tokens; Markdown by heading section up to 1,000 tokens; other text in 1,000-token windows with 100 tokens of overlap.
- Embedding cache key: SHA-256 of the chunk text plus the embedding model id. Only changed chunks are embedded, in batches of 32 \[D\].
- Changing the embedding model triggers a background re-index; vectors store the model id that produced them \[C\].
- Index jobs run in a worker thread at quota priority P2, so they never slow interactive work \[C\]. The vault's keyword index runs in-process before each search until code and embeddings are indexed (ADR-149).
- Notes with `private: true` and files matched by `.meteignore` are never embedded, because embedding sends their text to a provider \[D\].

## Shared memory server

From Phase 7, a workspace MAY sync with a shared memory server that the user runs (ADR-041) \[D\]:

- It is off by default and turns on only when `memory: { server: <url> }` is set in `settings.yaml`; the server's token is kept in the keychain under account `memory/server/token`. The connection uses TLS except on 127.0.0.1.
- Only workspace vault notes and handoffs are sent, masked like model input; notes with `private: true` and paths matched by `.meteignore` are never sent. Prompts, tool output, run conversations, events and the personal vault never leave the machine.
