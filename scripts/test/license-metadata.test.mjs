import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { withLicenseFixture } from "./license-metadata-fixture.mjs";
import { releaseScript } from "./maintenance-fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("release license boundary verifies shipped metadata without rewriting the raw BSD report", () =>
	withLicenseFixture(async ({ root, licenseGroups }) => {
		const raw = JSON.stringify(licenseGroups);
		const { state, messages } = await releaseScript({ root, licenseGroups });
		assert.equal(state.exitCode, 0);
		assert.ok(
			messages.some((message) =>
				message.includes(
					"verified metadata correction @vscode/windows-ca-certs@0.3.4: BSD -> BSD-3-Clause",
				),
			),
		);
		assert.equal(JSON.stringify(licenseGroups), raw);
	}));

for (const [label, change] of [
	[
		"unknown BSD package",
		(f) => {
			f.entry.name = "unknown";
		},
	],
	[
		"wrong version",
		(f) => {
			f.entry.versions = ["0.3.5"];
		},
	],
	[
		"mixed versions",
		(f) => {
			f.entry.versions.push("0.3.5");
		},
	],
	[
		"wrong manifest name",
		(f) => {
			f.manifest.name = "unknown";
			f.writeManifest();
		},
	],
	[
		"wrong manifest version",
		(f) => {
			f.manifest.version = "0.3.5";
			f.writeManifest();
		},
	],
	[
		"unpatched manifest",
		(f) => {
			f.manifest.license = "BSD";
			f.writeManifest();
		},
	],
	[
		"other allowed manifest",
		(f) => {
			f.manifest.license = "MIT";
			f.writeManifest();
		},
	],
	[
		"changed LICENSE hash",
		(f) => writeFileSync(join(f.installed, "LICENSE"), `${f.license}\n`),
	],
	["missing LICENSE", (f) => rmSync(join(f.installed, "LICENSE"))],
	["missing manifest", (f) => rmSync(join(f.installed, "package.json"))],
	[
		"malformed manifest",
		(f) => writeFileSync(join(f.installed, "package.json"), "{"),
	],
	[
		"empty paths",
		(f) => {
			f.entry.paths = [];
		},
	],
	[
		"relative path",
		(f) => {
			f.entry.paths = ["node_modules"];
		},
	],
	[
		"missing second copy",
		(f) => {
			f.entry.paths.push(join(f.root, "node_modules", "missing"));
		},
	],
	[
		"group mismatch",
		(f) => {
			f.entry.license = "MIT";
		},
	],
	[
		"other BSD remains",
		(f) => {
			f.licenseGroups.BSD.push({ ...f.entry, name: "unknown" });
		},
	],
]) {
	test(`release license correction fails closed: ${label}`, () =>
		withLicenseFixture(async (f) => {
			change(f);
			const { state, messages } = await releaseScript(f);
			assert.equal(state.exitCode, 1);
			assert.equal(
				messages.filter((message) => /^(pass|fail)\s/.test(message)).length,
				13,
			);
		}));
}

for (const label of ["outside", "node_modules-sibling", "symlink escape"]) {
	test(`release license correction rejects ${label}`, () =>
		withLicenseFixture(async (f) => {
			const outside = join(f.root, label);
			cpSync(f.installed, outside, { recursive: true });
			const link = join(f.root, "node_modules", "escape");
			if (label === "symlink escape") symlinkSync(outside, link, "junction");
			f.entry.paths = [label === "symlink escape" ? link : outside];
			assert.equal((await releaseScript(f)).state.exitCode, 1);
		}));
}

for (const filename of ["package.json", "LICENSE"]) {
	test(`release license correction rejects ${filename} file symlink escape`, () =>
		withLicenseFixture(async (f) => {
			const file = join(f.installed, filename);
			const outside = join(f.root, filename);
			writeFileSync(outside, readFileSync(file));
			rmSync(file);
			symlinkSync(outside, file, "file");
			const { state, messages } = await releaseScript(f);
			assert.equal(state.exitCode, 1);
			assert.ok(
				messages.some((message) =>
					message.includes("package evidence symlink escapes its directory"),
				),
			);
		}));
}

for (const licenseOutput of [
	"null",
	"[]",
	"{",
	"{}",
	'{"MIT":[]}',
	'{"MIT":[{"name":"incomplete"}]}',
]) {
	test(`release license report rejects malformed input: ${licenseOutput}`, async () => {
		const { state, messages } = await releaseScript({ licenseOutput });
		assert.equal(state.exitCode, 1);
		assert.equal(
			messages.filter((message) => /^(pass|fail)\s/.test(message)).length,
			13,
		);
	});
}

test("release license correction accepts unchanged CRLF text and an internal junction", () =>
	withLicenseFixture(async (f) => {
		writeFileSync(
			join(f.installed, "LICENSE"),
			f.license.toString().replace(/\n/g, "\r\n"),
		);
		const alias = join(f.root, "node_modules", "alias");
		symlinkSync(f.installed, alias, "junction");
		f.entry.paths.push(alias);
		assert.equal((await releaseScript(f)).state.exitCode, 0);
	}));

for (const [license, accepted] of [
	["BSD", false],
	["BSD-3-Clause", true],
	["GPL-3.0-only", false],
	["AGPL-3.0-only", false],
	["Unknown-License", false],
]) {
	test(`release license gate remains strict for ${license}`, async () => {
		const { state } = await releaseScript({
			licenseGroups: {
				[license]: [
					{
						name: "fixture",
						versions: ["1.0.0"],
						paths: [join(ROOT, "node_modules", "fixture")],
						license,
					},
				],
			},
		});
		assert.equal(state.exitCode, accepted ? 0 : 1);
	});
}

test("windows-ca-certs patch corrects only license metadata and preserves the Spectre patch", () => {
	const root = mkdtempSync(join(tmpdir(), "mete-ca-license-"));
	const before = {
		name: "@vscode/windows-ca-certs",
		version: "0.3.4",
		contributors: [{ name: "Microsoft Corporation" }],
		license: "BSD",
		bugs: {
			url: "https://github.com/microsoft/vscode-windows-ca-certs/issues",
		},
		homepage: "https://github.com/microsoft/vscode-windows-ca-certs",
	};
	const binding = [
		'        "libraries": ["-lcrypt32"]',
		"      },",
		'      "msvs_configuration_attributes": {',
		'        "SpectreMitigation": "Spectre"',
		"      },",
		'      "msvs_settings": {',
		'        "VCCLCompilerTool": {',
		"",
	].join("\n");
	try {
		writeFileSync(
			join(root, "package.json"),
			`${JSON.stringify(before, null, 2)}\n`,
		);
		writeFileSync(join(root, "binding.gyp"), binding);
		execFileSync(
			"git",
			[
				"-c",
				"core.autocrlf=false",
				"apply",
				join(ROOT, "patches", "@vscode__windows-ca-certs@0.3.4.patch"),
			],
			{ cwd: root, stdio: "pipe" },
		);
		assert.deepEqual(
			JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
			{ ...before, license: "BSD-3-Clause" },
		);
		assert.equal(
			readFileSync(join(root, "binding.gyp"), "utf8"),
			binding.replace('        "SpectreMitigation": "Spectre"\n', ""),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
