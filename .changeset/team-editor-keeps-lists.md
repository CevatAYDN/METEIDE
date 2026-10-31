---
"@mete/ui-theia": patch
---

The team editor keeps every entry of a list it cannot fully read, such as a capability list with a number in it or a lone value where a list belongs, and every verify gate it cannot read. Before, one bad entry blanked the whole list on screen, and the next edit of that list wrote the blank list back, dropping what the file held.
