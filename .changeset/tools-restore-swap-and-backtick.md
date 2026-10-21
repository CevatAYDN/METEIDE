---
"@mete/tools": patch
---

`checkpoint.restore` brings back a folder that was replaced by a file, which failed with `io` before. A folder standing where the checkpoint had a file is removed with everything in it, ignored files included, so the file can return. A PowerShell command that ends in a backtick no longer swallows the exit tail and reports exit 0.
