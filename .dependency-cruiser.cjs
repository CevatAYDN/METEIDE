// Import rules from ARCHITECTURE.md (layers, public index.ts, capability isolation).
const L3 = "packages/(storage|security|quota|gateway)/";
const L4 = "packages/(providers|tools|mcp|knowledge|engines)/";
const L5 = "packages/core/";
const L6 = "(apps/|packages/ui-)";

module.exports = {
	forbidden: [
		{
			name: "contracts-standalone",
			comment: "contracts MUST NOT import any METE package (ADR-036)",
			severity: "error",
			from: { path: "^packages/contracts/" },
			to: { path: "^(packages|apps)/", pathNot: "^packages/contracts/" },
		},
		{
			name: "kernel-only-contracts",
			comment: "kernel MUST import only contracts (ADR-036)",
			severity: "error",
			from: { path: "^packages/kernel/" },
			to: {
				path: "^(packages|apps)/",
				pathNot: "^packages/(kernel|contracts)/",
			},
		},
		{
			name: "no-upward-from-platform",
			severity: "error",
			from: { path: `^${L3}` },
			to: { path: `^(${L4}|${L5}|${L6})` },
		},
		{
			name: "no-upward-from-capabilities",
			severity: "error",
			from: { path: `^${L4}` },
			to: { path: `^(${L5}|${L6})` },
		},
		{
			name: "no-capability-to-capability",
			comment:
				"a capability module resolves other capabilities through the kernel registry",
			severity: "error",
			from: { path: `^${L4}` },
			to: { path: `^${L4}`, pathNot: "^packages/$1/" },
		},
		{
			name: "no-upward-from-core",
			severity: "error",
			from: { path: `^${L5}` },
			to: { path: `^${L6}` },
		},
		{
			name: "public-index-only",
			comment: "other packages are imported only through their public index.ts",
			severity: "error",
			from: { path: "^(packages|apps)/([^/]+)/" },
			to: {
				path: "^packages/([^/]+)/src/(?!index.ts$)",
				pathNot: "^packages/$2/",
			},
		},
		{
			name: "theia-only-in-ui-theia",
			comment:
				"Theia is imported only by the desktop shell and its extension package (ADR-002, ADR-045)",
			severity: "error",
			from: {
				path: "^(packages|apps)/",
				pathNot: "^(packages/ui-theia|apps/desktop)/",
			},
			to: { path: "node_modules/@theia/" },
		},
		{
			name: "desktop-talks-to-the-daemon",
			comment:
				"the desktop and its extension reach the core only through the daemon protocol: they import @mete/contracts, for the run view model @mete/ui-studio, and for the design tokens @mete/ui-kit (ADR-024, ADR-045, ADR-051, ADR-069)",
			severity: "error",
			from: { path: "^(packages/ui-theia|apps/desktop)/" },
			to: {
				path: "^(packages|apps)/[^/]+/src/",
				pathNot:
					"^(packages/contracts|packages/ui-kit|packages/ui-studio|packages/ui-theia|apps/desktop)/",
			},
		},
		{
			name: "no-circular",
			severity: "error",
			from: {},
			to: { circular: true },
		},
	],
	options: {
		doNotFollow: { path: "node_modules" },
		// The Theia application's generated folders are bundles, not source (apps/desktop).
		exclude: {
			path: "(^|/)dist/|^apps/desktop/(lib|src-gen)/|^apps/desktop/(esbuild|gen-esbuild[^/]*)\\.mjs$",
		},
		tsPreCompilationDeps: true,
		// Maps @mete/<name> onto its source so package-name imports are checked too.
		tsConfig: { fileName: "tsconfig.depcruise.json" },
	},
};
