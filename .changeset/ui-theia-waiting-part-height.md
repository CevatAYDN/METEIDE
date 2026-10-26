---
"@mete/ui-theia": patch
---

The METE view's Waiting for you part comes back with its share of the side bar's height (a fifth) each time a run starts waiting, instead of Theia's minimum, which cut its answers off below the run's name. The other open parts keep their proportions, a part the user collapsed stays collapsed, and a view that is not on screen takes the share when it shows.
