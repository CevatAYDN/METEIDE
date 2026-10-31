---
"@mete/tools": patch
---

`fs.grep@1` keeps a match on a line, or in a file path, that is not UTF-8, with replacement characters where bytes do not decode. Before, ripgrep reported such matches as bytes and they were dropped without a word.
