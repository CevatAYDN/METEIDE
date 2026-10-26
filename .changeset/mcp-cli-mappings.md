---
"@mete/mcp": minor
"@mete/contracts": minor
---

A workspace can map image, 3D and game engine capabilities onto its own servers and programs: mapping files in `.mete/adapters/` load after the built-in ones, and a `cli` mapping runs its program through `shell.exec@1`, so the policy is asked for the command line, for example a browser game's `npm run build` as `gameengine.build@1`. An argument a shell could read as more than one word fails the call; `http` mappings still do not run.
