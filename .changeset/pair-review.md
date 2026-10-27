---
"@mete/core": minor
---

A task's `review.pair_with` role now reviews each submission before its approver, with `review.requested` and `review.completed`; its returns do not count toward the revision limit and end after `max_turns` (ADR-136).
