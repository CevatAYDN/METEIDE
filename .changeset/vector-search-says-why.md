---
"@mete/knowledge": patch
---

A search by meaning that cannot run (a query vector of another size than the stored ones, or a vector table that cannot be searched) is logged as a warning, and the keyword results still answer. Before, any such error looked like "nothing near" with no trace (docs/11).
