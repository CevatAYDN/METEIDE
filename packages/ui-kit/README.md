# @mete/ui-kit

Design tokens and shared React components.

Modules: none (not a MeteModule)

Today it holds the design tokens of docs/13 (Design system): `TOKENS`, the light and dark colours of the token table, `tokenProperties(mode)`, the same colours as CSS custom properties (`--bg`, `--panel`, …) for a panel's root, so they never leak into Theia's, and `SHAPE`, the border and radius sizes. `test/tokens.test.ts` reads docs/13's table, so the colours cannot drift from it (shortcut: Baloo 2 needs a decision on where its font files come from, and the shared React components come with the panels that share them).
