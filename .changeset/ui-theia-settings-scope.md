---
"@mete/ui-theia": minor
---

The Settings screen has one switch at its top, This folder or All folders, that sets where every form saves, in place of a "Save for every folder" box in each form (the custom endpoints card keeps its own choice). Each form says where its value comes from: "Changed for this folder" with a Reset button that removes the form's keys from this folder's file, or "From all folders' file". Clearing a field now also removes the map it leaves empty, so a Reset leaves no `budget: {}` behind (ADR-095).
