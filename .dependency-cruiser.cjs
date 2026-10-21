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
			to: { path: "^(packages|apps)/", pathNot: "^packages/(kernel|contracts)/" },
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
			name: "no-circular",
			severity: "error",
			from: {},
			to: { circular: true },
		},
	],
	options: {
		doNotFollow: { path: "node_modules" },
		exclude: { path: "(^|/)dist/" },
		tsPreCompilationDeps: true,
		// Maps @mete/<name> onto its source so package-name imports are checked too.
		tsConfig: { fileName: "tsconfig.depcruise.json" },
	},
};
