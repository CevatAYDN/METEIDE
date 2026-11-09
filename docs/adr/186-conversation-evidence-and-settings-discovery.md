# ADR-186: Visible model evidence and searchable settings navigation

Status: Accepted
Date: 2026-11-08

## Context

The user approved U3-U5 in
`docs/superpowers/plans/2026-11-08-reference-product-completion.md`.
The observed model is hidden in conversation diagnostics, Settings search
misses visible hints/actions, and an unused conversation list claims a failed
search. The existing Theia controls and daemon data are sufficient.

## Decision

- Show compact, wrapping model metadata in the conversation header, outside
  diagnostics. The unique taskless `assistant` in the displayed run's event
  fold supplies its last observed provider/model. Missing or ambiguous evidence
  says it was not reported. Never infer it from a preferred model or from the
  bounded activity feed. This does not attribute every older message to it.
- When run metadata is available, show its flat single-agent model reference
  separately as Preferred model, or Automatic when the preference is absent.
  The engine rejects role maps for single-agent starts; do not infer a valid
  preference or Automatic from a present role-map shape. Neither guarantees the next model;
  no inheritance label is shown because the current response carries no
  preference provenance. Missing metadata does not imply Automatic.
  Once metadata is known, use the same acknowledged preference state as the
  existing picker, including successful changes and clearing that emit no run
  event. A pending/refused/stale change must not become displayed evidence.
- Extend Settings search to translated group hints and labels of linked native
  actions. Per group, an existing category-label match retains the group,
  otherwise existing section-name/title matches retain their narrower result.
  Hint/action-label matching is the fallback to that group. Do not search
  setting values, secrets, file paths, internal command IDs or remote sources.
  Case/accent folding also handles Turkish dotless i in visible-label searches.
- A successful empty conversation list with a blank/whitespace query says
  No conversations yet. A nonempty query retains the no-matching-search notice.
  Loading, failure and no-folder states cannot assert empty success. Keep the
  existing start/retry actions and naming.
- English and Turkish resources change together. No new dependency, capability,
  event, daemon message, setting, permission or automatic model call is needed.
- Partly supersedes ADR-180's narrow Settings search scope and the placement of
  model evidence in single-agent diagnostics. Other behavior remains unchanged.

## Consequences

Users can find native settings actions and distinguish observed model data from
preferences. Tests are authored before changes, but execution and interactive
QA are batched at development end as the user requested. No new release or
platform acceptance is implied by implementing these UI changes.

## Alternatives Rejected

- A second settings search service or editor fork: existing metadata suffices.
- Treat the preference as the last model: fallback makes that false.
- Guess which message a model wrote from a single run-level field: no such
  attribution is provided by this slice.
