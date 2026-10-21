---
"@mete/tools": patch
---

File tools on Windows refuse a path that names an NTFS stream (`file::$DATA`), which could write a protected file such as `.mete/policy.yaml`.
