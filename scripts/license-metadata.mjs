import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";

const NAME = "@vscode/windows-ca-certs";
const VERSION = "0.3.4";
// Reviewed upstream v0.3.4 LICENSE, CRLF -> LF only; see the R2 review report.
const LICENSE_SHA256 =
	"206d4ff536b874471338314df6a504dd70551fff81624bf097d107ff471f88ad";
const Package = z.object({
	name: z.string().min(1),
	versions: z.array(z.string().min(1)).min(1),
	paths: z.array(z.string().refine(isAbsolute)).min(1),
	license: z.string().min(1),
});
const Report = z
	.record(z.string().min(1), z.array(Package).min(1))
	.refine((groups) => Object.keys(groups).length > 0)
	.refine((groups) =>
		Object.entries(groups).every(([license, entries]) =>
			entries.every((pkg) => pkg.license === license),
		),
	);
const Manifest = z.object({
	name: z.literal(NAME),
	version: z.literal(VERSION),
	license: z.literal("BSD-3-Clause"),
});
const failure = (message) => ({
	ok: false,
	error: { code: "license_metadata", message },
});
const inside = (root, path) => {
	const child = relative(root, path);
	return (
		child !== "" &&
		child !== ".." &&
		!child.startsWith(`..${sep}`) &&
		!isAbsolute(child)
	);
};

const verifyInstalled = (path, modules) => {
	try {
		const installed = realpathSync(path);
		if (!inside(modules, installed))
			return failure("package path outside node_modules");
		const manifestPath = realpathSync(join(installed, "package.json"));
		const licensePath = realpathSync(join(installed, "LICENSE"));
		if (!inside(installed, manifestPath) || !inside(installed, licensePath))
			return failure("package evidence symlink escapes its directory");
		const manifest = Manifest.safeParse(
			JSON.parse(readFileSync(manifestPath, "utf8")),
		);
		if (!manifest.success)
			return failure("shipped manifest does not match reviewed correction");
		const license = readFileSync(licensePath, "utf8").replace(/\r\n/g, "\n");
		const digest = createHash("sha256").update(license).digest("hex");
		return digest === LICENSE_SHA256
			? { ok: true, value: undefined }
			: failure("shipped LICENSE SHA256 differs from reviewed source");
	} catch {
		return failure("missing, unreadable or malformed shipped license evidence");
	}
};

const correction = (pkg, root) => {
	if (pkg.versions.length !== 1 || pkg.versions[0] !== VERSION)
		return failure("unreviewed or mixed versions in BSD metadata correction");
	try {
		const modules = realpathSync(join(root, "node_modules"));
		for (const path of pkg.paths) {
			const checked = verifyInstalled(path, modules);
			if (!checked.ok) return checked;
		}
		return {
			ok: true,
			value: `verified metadata correction ${NAME}@${VERSION}: BSD -> BSD-3-Clause; LICENSE SHA256 ${LICENSE_SHA256}; ${pkg.paths.length} path(s)`,
		};
	} catch {
		return failure("canonical node_modules is unavailable");
	}
};

/** Validate pnpm's raw report and resolve only the reviewed installed metadata correction. */
export const readLicenseMetadata = (text, root) => {
	let parsed;
	try {
		parsed = Report.safeParse(JSON.parse(text));
	} catch {
		return failure("malformed license report JSON");
	}
	if (!parsed.success) return failure("malformed license report shape");
	const packages = [];
	const evidence = [];
	for (const pkg of Object.values(parsed.data).flat()) {
		if (pkg.license === "BSD" && pkg.name === NAME) {
			const checked = correction(pkg, root);
			if (!checked.ok) return checked;
			evidence.push(checked.value);
			packages.push({ ...pkg, license: "BSD-3-Clause" });
		} else packages.push(pkg);
	}
	return { ok: true, value: { packages, evidence } };
};
