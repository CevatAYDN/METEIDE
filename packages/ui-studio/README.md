# @mete/ui-studio

Studio view (PixiJS). Visual reference: docs/19-studio-view-prototype.md.

Modules: ui-studio

Today the package holds the run view model the Team panel's views share (ADR-051, docs/13): `applyEvent` and `applyAll` fold one run's events into a `TeamView`, each event id applied once, so the history from `mete/events` and the live `mete/event` stream can overlap. Cards are placed by task status alone (`placeOf`: the Board columns of ADR-051). It depends only on `@mete/contracts` and is a library, not a kernel module yet (shortcut: agents, messages and quota waits join the fold with the Studio view; the PixiJS renderer comes then).
