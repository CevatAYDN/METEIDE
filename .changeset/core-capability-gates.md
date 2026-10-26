---
"@mete/core": minor
---

A verify gate that names a capability runs: the game studio's developer and tester gates call `gameengine.build@1` and `gameengine.test@1` when an adapter provides them, an error goes back to the agent like a failed command, and a policy ask pauses the run. A capability no adapter provides is skipped with a warning, so a team whose engine is not bound runs as before.
