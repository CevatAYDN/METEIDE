# Team Usability Recovery

Status: APPROVED for staged workflow recovery, 2026-11-09.
The user approved this plan with "onayliyorum". New improvement contracts still
require the concrete I0 design; ordinary U/P/S/L work needs no repeated approval.
Date: 2026-11-09. Owner: Astra lead; bounded implementation: Sol.
Baseline: `c5d02494` plus the existing dirty worktree.

## Outcome

The user must be able to find a team, understand its work, manage project
permissions, edit a skill and review an improvement without knowing YAML paths,
capability identifiers or the command palette. Keep Theia, existing native
editors, theme tokens, codicons and the implemented security boundaries.

The latest usability complaint supersedes infrastructure-first continuation.
Existing implementation is preserved, not certified as usable or complete.

## Investigation Evidence

These are source findings, not a new running-app test:

| ID | Finding | Source |
| --- | --- | --- |
| UX-01 | Permissions are named "What the team may do alone"; Turkish navigation/search does not name "Izinler". Search examines group labels, hints, section names and linked commands, not the permission fields inside them. | `packages/ui-theia/src/application/settings-groups.ts:69`, `:227`; `packages/ui-theia/i18n/nls.tr.json:188` |
| UX-02 | The policy form edits only autonomy and two budget fields. Command allow lists, always-ask actions, deny rules and capability overrides have no form controls. A permission engine is not a usable permission-management screen. | `packages/ui-theia/src/application/section-draft.ts:46`; `SECURITY.md`, Policy file |
| UX-03 | Skills exposes discovery, read-only review, approval and disable. There is no edit/create action or route from a team to its skills. | `packages/ui-theia/src/application/skills-view.tsx:46`, `:142`; `packages/ui-theia/src/application/team-editor-model.ts` |
| UX-04 | A task can save a lesson after approval, but this is a checkbox within its work form. It does not evaluate the team or produce a reviewed skill revision. | `packages/ui-theia/src/application/work-fields.tsx:184`; `packages/core/src/application/lesson.ts:81` |
| UX-05 | Team editing presents internal capability ids, inactive fields and copy-as-new inputs alongside daily work. Team selection is a disclosure inside the single-agent composer; Settings Teams is only two command links. | `packages/ui-theia/src/application/member-card.tsx:119`; `team-hero.tsx:126`; `composer-view.tsx:109`; `settings-groups.ts:114` |
| UX-06 | S1 approval is not activation. S2 contracts and persistence foundations exist, but the complete runtime/composer path is not connected. Showing an approved skill as used would be false. | ADR-189/190/191; `docs/reviews/2026-11-08-skill-activation.md`; `packages/contracts/src/domain/daemon.ts:68` |

Historical visuals inspected:

- The 2026-11-08 Skills Light/wide and Dark/narrow captures under
  `.probe-skill-foundation-resume-e2e-1/`.
- The 2026-11-07 team form capture
  `.probe-ide-follow-through-evidence/team-advanced.e2e.ts-advan-4a221-ut-losing-capability-checks/advanced-team.png`.
- These show information hierarchy and long-form friction, not a new acceptance
  pass. The team capture predates changes to verification fields. No claim is
  made about the user's installed binary or its identity.

## Approaches

1. Discovery repair: expose the existing teams, Skills, Memory and policy
   screens with clearer names and direct routes. Small and low risk, but it
   does not provide missing policy editors or a team-improvement workflow.
2. Workflow recovery (recommended): deliver those routes first, then usable
   permissions, skill editing and a separate human-reviewed improvement flow.
   More work, with useful intermediate deliveries and explicit backend gates.

A shell/framework replacement, marketplace, autonomous training service and
new dependencies are not needed for either approach.

## Proposed Experience

- **Teams:** a direct team entry, selected team identity and work controls.
  Separate editing a template from watching an existing run. Preserve drafts
  when navigating; changed templates never rewrite an existing run.
- **Team details:** compact Members, Tasks and Learning views. Use ordinary
  capability labels with exact ids available in advanced details. Keep inactive
  fields and copy-as-new controls out of the primary form without deleting data.
- **Permissions:** directly named and searchable. Show workspace/global scope
  and existing rule groups: autonomy, ask-first actions, allowed commands,
  forbidden actions/paths and capability overrides. Saved, inherited and
  currently loaded values remain distinct. Do not invent a universal Allow
  switch: protected paths and policy precedence still win.
- **Skills:** Open in editor, then reread the saved source and review its new
  exact version before approval. Never save the masked preview over the raw
  file. Validate source/root identity; no automatic global-source mutation.
  Approved, selected, loaded, changed and unavailable are different states.
- **Learning:** bring the existing task-level lesson choices and related notes
  together without claiming that every task learns or that a saved note is a
  trained model. The team's role/task scope stays explicit.
- **Improve team:** user chooses an ended run and a target skill; the system
  produces an evidence-linked proposed revision, shows the difference and any
  evaluation gaps, and waits for explicit apply and version approval. No
  permission change, live-run rewrite or automatic skill approval.

The new improvement action is a product decision, not a renamed lesson checkbox.
It needs a concrete contract/spec before implementation. ROADMAP currently
reserves retrospectives for Phase 6. The proposal moves only this manually
started, human-reviewed skill-improvement flow into Phase 5, not scheduled
training, learning-router changes, consolidation or model fine-tuning.

## Delivery Boundaries

Every implementation slice owns one package and one concern, with about 300
changed lines including tests. Split a slice before exceeding that bound.
Main owns shared exports, canonical docs and integration; no overlapping writers.

| Slice | Owner / package | Concern and acceptance |
| --- | --- | --- |
| U1 | Sol / ui-theia | Direct team, Skills and Permissions routes using existing commands/widgets; translated search terms; no draft loss on navigation. |
| U2 | Sol / ui-theia | Team form hierarchy using existing member/task editors; daily actions remain visible, advanced fields preserve their values. |
| P1 | Sol / ui-theia | Typed draft/serialization for existing policy rule lists; preserve YAML comments, unrelated fields and inherited defaults. Tests first. |
| P2 | Sol / ui-theia | Permission controls and save/reload feedback over P1; explicit target, invalid-input refusal, stale-root protection. |
| S1 | Sol / ui-theia | Safe user-initiated skill editing through the native editor; changed content loses old-version eligibility and requires fresh review. |
| L1 | Sol / ui-theia | Existing lesson controls and Memory navigation presented together, with actual task scope and request cost. No retrospective claim. |
| I0 | Main / docs | After scope approval, specify the manual improvement flow, authority, evidence, budget, cancellation and retention; new ADR for the narrow Phase 5 addition. |
| I1 | Sol / contracts | The approved improvement request/result contract only; versioning and contract tests before consumers. |
| I2 | Sol / core | Bounded evidence/proposal generation through existing capability ports; no policy/template writes. Split collection and generation if needed. |
| I3 | Sol / cli | Native validated user-facing transport for I1/I2; no provider call in tests and no implicit mutation. |
| I4 | Sol / ui-theia | Proposal diff, explicit apply, changed-source refusal and separate skill approval; no fabricated improvement score. |
| V1 | Main / desktop | Isolated end-to-end fixtures for the complete approved flows after all development and source review. |

U1 is the first proposed coding assignment. I1-I4 cannot be dispatched from this
high-level plan alone: their concrete design and any contract decisions must
be reviewed first. New UI code cannot pretend an unavailable backend exists.

## Preserved S2 Work

- Keep all existing edits. No reset, commit, push, install or release.
- The previously orphaned C3a transport schemas now have their implementation;
  ADR-193 subsequently advances the management transport to protocol37.
  S2 runtime handlers are still absent.
- R5's ordered-prefix invariant is corrected in contracts and core state.
  Independent source recheck closed the finding; the root check executed these
  contract/storage regressions. This is not end-to-end skill activation.
- Complete the previously approved S2 dependency before claiming that a saved
  or selected skill actually reaches a model, including revocation/recovery.
  Follow its existing package-sized plan, not an unbounded infrastructure detour.

## Verification And Approval

Author regression tests before production edits. Per the user's sequencing,
execute tests only after the approved development and source-review pass.
Then run focused tests, `pnpm check`, and isolated Electron workflows with fake
providers. Record failures and output, not merely counts or screenshots.

Acceptance covers Turkish/English, light/dark/high-contrast, narrow panels,
keyboard/focus, stale workspace responses, preserved drafts, saved versus
effective permissions, denied writes, exact skill versions and cancellation.
Test a user finding a team, changing a permission, editing/reapproving a skill
and reviewing an improvement end to end. Automated fixtures prove mechanics;
they do not prove that a proposed skill increases real model quality.

No executable validation, UI launch or production code change was made during
the initial recovery investigation. Implementation/source review subsequently
completed, then final root, 53 English/Turkish Electron scenarios and chaos
passed after a Turkish command-palette correction. This is bounded Windows
source acceptance, not completion of I1-I4 or S2. Current evidence is in
`../../reviews/2026-11-09-team-workflow-recovery.md`.

Approval received: workflow recovery, beginning with U1, including the manually
started, human-reviewed improvement flow in the current product scope.

## Implementation Ledger

| Slice | Exact ownership | Status |
| --- | --- | --- |
| U1a | Main: Settings group commands, widget navigation, menu entry and focused tests | verified: final root and EN/TR Electron |
| U1b | Main: team-context entry buttons, translated discovery labels and tests | verified: final root and EN/TR Electron |
| P1a | Sol: policy-rule field schema/helpers and pure regression tests, no shared UI files | source-reviewed; root checks passed |
| P1b | Main: integrate rule values with existing comment-preserving section drafts and tests | source-reviewed; root checks passed |
| P2a | Sol: policy rule controls and focused rendering/interaction tests | root and English live checks passed |
| P2b | Main: file/session integration, stale-root guards and tests | source-reviewed; root checks passed |
| U2a | Sol: retained Member/Tasks panels and advanced disclosure | root and English live checks passed |
| U2b | Sol: extract tab helpers to retain file-size margin | source-reviewed; root checks passed |
| U2-R1 | Sol: task-list clicks reveal Tasks for same/different member; regression first | finding closed; root and live checks passed |
| L1 | Sol: existing task lesson navigation, not a fake retrospective action | root and English live checks passed |
| S1a | Sol: safe source-to-editor action and regression tests | root and native edit/save/reapproval checks passed |
| S1b | Main: Skills editor wiring, translated copy and review invalidation tests | root and native edit/save/reapproval checks passed |
| S1-R3-C | Main / contracts: additive native editor-source transport schema, protocol37 | source-reviewed; root checks passed |
| S1-R3-T | Sol / cli: attested opaque source-id resolution, no path/body input | source-reviewed; root and native editor checks passed |
| S1-R3-U | Main / ui-theia: transport binding, pre-open watch and reconnect retirement | finding closed; root and native editor checks passed |
| P-R2-A | Sol / ui-theia: capture save-batch scope, source validity and out-of-scope Reset drafts as separate bounded corrections | findings closed; root checks passed |
| P-R2-Y | Sol / ui-theia: preserve structured YAML entry comments, unchanged policy semantics | finding closed; root checks passed |
| I0 | Main: concrete manual-improvement design; no unreviewed new backend contract | proposed specification written; concrete contract approval pending |
| TR1 | Sol helper/main integration: native Turkish command matching and original-text highlights | verified: independent review, final root, native Turkish full-label action |
| R/V | Astra/main: source review, then final executable checks and isolated UI | verified for bounded Windows source: root34/34 uncached, Electron53/53, chaos1/1; release open |
