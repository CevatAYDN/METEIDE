# ADR-192: User-directed team workflow recovery

Status: Accepted
Date: 2026-11-09

## Context

The user approved the team-usability recovery plan after reporting that teams,
skills and permissions are not understandable or usable. Existing capabilities
are scattered across a technical team form, Settings and Memory. S1 provides
version management but no editing action, and the policy form exposes only
autonomy and budgets.

## Decision

- Keep Theia, native editors, theme tokens and capability boundaries. Add direct,
  translated team-context routes to Skills and Permissions. Opening an existing
  Settings surface MUST preserve drafts; explicit Refresh remains distinct.
- Rename the policy group to Permissions and approvals in user-facing copy.
  Keep its stable internal id and workspace/global save targets. Add structured
  editing for the existing `always_ask`, `never_allow`, `shell.allow`,
  `shell.always` and `overrides` values, validated by `PolicySchema`.
  This adds no permission, action, runtime dependency or policy evaluation rule.
- Save only explicitly changed fields, preserving other YAML values and comments.
  Missing values remain inherited; an explicit empty list is not inheritance.
  Unsupported/invalid values MUST be visible and MUST NOT be silently cleared.
  A workspace or save-target change retires pending reads/actions for the old
  context. Saving and current runtime effectiveness remain distinct.
- Team forms group ordinary member/task work separately from advanced ids,
  inactive fields and copy-as-new actions. Existing values and user drafts survive
  navigation. Existing lesson choices stay task-scoped and retain their actual
  cloud-request cost. A saved lesson is not model training.
- Skills MAY open an existing validated local source in the native editor on
  the user's click. Never write masked previews back to raw sources, open a
  caller-supplied arbitrary path, silently save, or renew an approval after edit.
  Fresh source/version review is still required; S1 approval is not S2 activation.
- The user-approved product scope now includes a manually started, human-reviewed
  improvement proposal for an ended run and a target skill. Only that bounded
  workflow is pulled from Phase 6. Before implementing its new backend contract,
  specify evidence, budget, cancellation, retention, version conflicts and explicit
  apply/approve in I0. Do not expose a working improvement action before the
  approved backend exists. No automatic fine-tuning, permission changes,
  retrospective scheduling, consolidation or learning-router change is included.

This partly supersedes ADR-082's policy-form field restriction, ADR-095's
permission-group naming, ADR-075/076's team-form placement and ADR-189's UI
action scope. Their persistence, human-action and authorization rules stand.
ADR-144's Phase 6 boundary changes only for the manual improvement scope above.

## Consequences

Deliver package-sized slices from
`../superpowers/plans/2026-11-09-team-usability-recovery.md`.
Tests are authored first and executed after the approved development and source
review pass. Full acceptance needs `pnpm check` and actual isolated Electron
interaction, including Turkish and narrow panels, not screenshots alone.
S2 runtime wiring remains an explicit dependency of any skill-use claim.

## Alternatives Rejected

- Renaming a lesson checkbox to Train team without a real improvement flow.
- Showing a blanket Allow control that bypasses policy precedence.
- Replacing Theia or adding a second editor/settings persistence system.
- Automatically changing or approving skills, team templates or permissions.
