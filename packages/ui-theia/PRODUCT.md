# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers using METE's Theia/Electron desktop to work in a project, converse with
agents, run explicit teams, and connect tools without learning METE's internal
configuration vocabulary. Windows first; Linux is a separate acceptance target.

## Product Purpose

Make project work, model selection, tools and extensions understandable from the
desktop itself. Capability contracts, provider adapters, persisted runs and human
approval gates remain the implementation boundaries.

## Operating Context

An existing project has editors, a terminal, changes, agent conversations, optional
team views, models, MCP tools and settings. Editor extensions are not agent tools.
Users must explicitly approve installation and permission-sensitive actions.

## Capabilities and Constraints

docs/ and accepted ADRs remain authoritative. The approved 2026-11-07 continuation
covers compact familiar controls, searchable settings, guided MCP setup,
conversation tool selection, and user-initiated Open VSX / VSIX extension management.
No account enrollment, provider impersonation, hidden installation, telemetry or
silent interruption of running work. Existing user files and YAML comments survive.

## Evidence on Hand

Current source and the 2026-11-07 Electron captures, including the oversized
conversation summary and composer crowded at the lower edge. Older artboards in
docs/design describe the incumbent look, not acceptance of the new compact layout.

## Product Principles

- Everyday actions should not require editing YAML.
- A saved setting is not a connected tool; states must distinguish them.
- Advanced configuration remains available without leading the ordinary path.
- Unknown permissions or compatibility are never represented as verified.
- Test UI behavior in the actual Electron application.

## Accessibility & Inclusion

English and Turkish, visible keyboard focus, semantic controls, readable contrast,
light/dark/high-contrast themes and narrow desktop panels.
