---
"@mete/core": minor
"@mete/ui-theia": minor
---

Agents keep working instead of stopping short (ADR-126). A run that uses its 25 model turns now pauses for its budget instead of failing, and a resume gives it 25 more; the desktop offers Resume for a budget pause with a line that names the budget. A reply whose text holds tool calls (`<tool_call>` blocks, or one JSON object naming an offered tool) runs those calls instead of ending the run. Every run opens with the workspace: its top folder's names and the first of `AGENTS.md`, `CLAUDE.md` or `README.md`, labeled as data.
