---
"@mete/contracts": minor
---

The daemon error data can now be `not_ready` with the `reasons` lines (protocol version 2): `DaemonErrorDataSchema` is a union of an `EngineError` code and `not_ready`, and `DaemonErrorData` is its type.
