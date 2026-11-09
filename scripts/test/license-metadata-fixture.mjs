import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Exercise the production boundary without a Windows-only installed dependency. */
export const withLicenseFixture = async (run) => {
	const root = mkdtempSync(join(tmpdir(), "mete-license-report-"));
	const installed = join(root, "node_modules", "@vscode", "windows-ca-certs");
	const manifest = {
		name: "@vscode/windows-ca-certs",
		version: "0.3.4",
		license: "BSD-3-Clause",
	};
	const entry = {
		name: manifest.name,
		versions: ["0.3.4"],
		paths: [installed],
		license: "BSD",
	};
	const licenseGroups = { BSD: [entry] };
	const license = readFileSync(
		new URL("./fixtures/windows-ca-certs-0.3.4.LICENSE", import.meta.url),
	);
	const writeManifest = () =>
		writeFileSync(join(installed, "package.json"), JSON.stringify(manifest));
	try {
		mkdirSync(installed, { recursive: true });
		writeManifest();
		writeFileSync(join(installed, "LICENSE"), license);
		await run({
			root,
			installed,
			manifest,
			entry,
			licenseGroups,
			license,
			writeManifest,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
};
