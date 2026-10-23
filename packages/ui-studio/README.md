# @mete/ui-studio

Studio view (PixiJS). Visual reference: docs/19-studio-view-prototype.md.

Modules: ui-studio

Today the package holds the run view model the Team panel's views share (ADR-051, docs/13): `applyEvent` and `applyAll` fold one run's events into a `TeamView`, each event id applied once, so the history from `mete/events` and the live `mete/event` stream can overlap. Cards are placed by task status alone (`placeOf`: the Board columns of ADR-051). It depends only on `@mete/contracts` and is a library, not a kernel module yet Agents are folded too (`agents.ts`): each with its role, provider and model, its task, whether it is thinking and the tool it waits on, from the envelope agent id the core sets (shortcut: messages join with the Studio view; quota waits and request counts wait for events that name the agent, since the quota module publishes `quota.*` without one; the PixiJS renderer comes with the Studio).
