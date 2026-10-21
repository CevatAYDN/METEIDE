# 11 Knowledge layer

Repository file: `docs/11-knowledge-layer.md`. Depends on: 06 Kernel and modules, 09 Models, providers and quota.

Agents find knowledge in this order: code graph, then grep, then reading files; long-term memory lives in two Obsidian-compatible vaults; one hybrid search serves all of it \[C\].

## Code knowledge graph (`code.graph@1`)

- Structural pass: web-tree-sitter grammars. First languages: TypeScript, JavaScript, C#, GDScript, Python, HTML, CSS, JSON, Markdown \[D\]. It runs on every file change, costs no quota and marks edges `EXTRACTED` \[C\].
- Node kinds: file, module, class, interface, type, function, method, exported variable, concept. Edge kinds: contains, defines, imports, calls, extends, implements, references.
- Semantic pass (optional, uses `llm.chat@1`): only for files that agents touched in a run or that the user opened; adds concept nodes and `INFERRED` edges with a score from 0 to 1; runs at quota priority P2 \[C\].
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

## Hybrid search (`knowledge.search@1`)

Input: `query`, `scope` (`workspace` | `personal` | `all`, default `all`), `k` (default 8), optional filters on note type and path.

1. Keyword: FTS5 BM25 over code chunks and notes.
2. Vector: sqlite-vec cosine similarity over `llm.embed@1` embeddings.
3. Graph: one-hop expansion from the top results; `EXTRACTED` edges weigh 1.0, `INFERRED` edges 0.5 \[D\].
4. Backlinks: notes that link to or from the top notes.
5. Fusion: Reciprocal Rank Fusion with k = 60. Workspace results weigh 1.0, personal results 0.7 \[D\].
6. Rerank: when `llm.rerank@1` exists and the caller marks the query important (review and approval contexts), the top 30 are reranked \[D\].

Degradation: no embeddings → no vector source; no graph → no graph source; no vault → code only; no knowledge-search module → plain ripgrep \[C\].

## Indexing

- Chunking \[D\]: code by symbol up to 1,500 tokens; Markdown by heading section up to 1,000 tokens; other text in 1,000-token windows with 100 tokens of overlap.
- Embedding cache key: SHA-256 of the chunk text plus the embedding model id. Only changed chunks are embedded, in batches of 32 \[D\].
- Changing the embedding model triggers a background re-index; vectors store the model id that produced them \[C\].
- Index jobs run in a worker thread at quota priority P2, so they never slow interactive work \[C\].
