// The pre-push secret scan of docs/15 (Local CI): "secretlint on the diff". lefthook pipes git's
// pre-push lines on stdin; every line each pushed commit adds is linted, since a secret a later
// commit removes still reaches the remote's history. A hit names the commit, the file and the rule,
// never the value.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRESET = "@secretlint/secretlint-rule-preset-recommend";
const NONE = /^0+$/;

// The rules are the security package's runtime (secrets.mask@1); resolving them there adds no root dependency.
const fromSecurity = createRequire(
	join(ROOT, "packages", "security", "package.json"),
);
const load = (id) => import(pathToFileURL(fromSecurity.resolve(id)).href);

const git = (args) =>
	execFileSync("git", args, {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		stdio: ["ignore", "pipe", "ignore"],
	});

const known = (sha) => {
	try {
		git(["cat-file", "-e", `${sha}^{commit}`]);
		return true;
	} catch {
		return false;
	}
};

/** The commits one pre-push line sends: `<local ref> <local sha> <remote ref> <remote sha>`. */
const rangeOf = (line) => {
	const [, local, , remote] = line.trim().split(/\s+/);
	if (!local || NONE.test(local)) return undefined; // a deleted ref sends no commits
	return remote && !NONE.test(remote) && known(remote)
		? [`${remote}..${local}`]
		: [local, "--not", "--remotes"];
};

// shortcut: merge commits' own lines are not scanned, add -m when merges carry edits.
/** The lines each commit adds, keyed by `<short sha> <file>`. */
const addedLines = (range) => {
	const out = new Map();
	let key = "";
	let sha = "";
	const log = git(["log", "-p", "--unified=0", "--format=%x00%h", ...range]);
	for (const line of log.split("\n")) {
		if (line.startsWith("\0")) sha = line.slice(1);
		else if (line.startsWith("+++ "))
			key = `${sha} ${line.slice(4).replace(/^b\//, "")}`;
		else if (line.startsWith("+")) {
			if (!out.has(key)) out.set(key, []);
			out.get(key).push(line.slice(1));
		}
	}
	return out;
};

const ranges = readFileSync(0, "utf8")
	.split("\n")
	.filter((l) => l.trim())
	.map(rangeOf)
	.filter(Boolean);
const [{ lintSource }, { creator }] = await Promise.all([
	load("@secretlint/core"),
	load(PRESET),
]);
const options = {
	config: { rules: [{ id: PRESET, rule: creator }] },
	noPhysicFilePath: true,
};
let found = 0;
for (const range of ranges) {
	for (const [key, lines] of addedLines(range)) {
		const file = key.slice(key.indexOf(" ") + 1);
		const source = {
			content: lines.join("\n"),
			filePath: file,
			ext: extname(file),
			contentType: "text",
		};
		const { messages } = await lintSource({ source, options });
		if (messages.length === 0) continue;
		found++;
		console.error(
			`${key} ${[...new Set(messages.map((m) => m.ruleId))].join(", ")}`,
		);
	}
}
if (found > 0) {
	console.error(
		"Push refused: a pushed commit adds a secret. Take it out of those commits (git rebase -i, or git commit --amend for the last one) and push again.",
	);
	process.exitCode = 1;
}
