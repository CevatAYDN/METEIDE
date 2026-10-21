import type { Io } from "../application/commands.js";

// The process terminal behind Io: lines to stdout and stderr, a secret read without echo.

const CTRL_C = "\u0003";
const BACKSPACE = new Set(["\u007f", "\b"]);

const readPiped = async () => {
	let data = "";
	for await (const chunk of process.stdin) data += String(chunk);
	return data.trim();
};

// Raw mode keeps the key off the screen; Ctrl+C gives up and returns nothing.
const readHidden = (prompt: string) =>
	new Promise<string>((resolve) => {
		const stdin = process.stdin;
		let value = "";
		const finish = (v: string) => {
			stdin.off("data", onData);
			stdin.setRawMode(false);
			stdin.pause();
			process.stderr.write("\n");
			resolve(v.trim());
		};
		const onData = (chunk: Buffer | string) => {
			for (const c of String(chunk)) {
				if (c === "\r" || c === "\n") return finish(value);
				if (c === CTRL_C) return finish("");
				value = BACKSPACE.has(c) ? value.slice(0, -1) : value + c;
			}
		};
		process.stderr.write(prompt);
		stdin.setRawMode(true);
		stdin.resume();
		stdin.on("data", onData);
	});

/** The real terminal. */
export const processIo: Io = {
	out: (line) => void process.stdout.write(`${line}\n`),
	err: (line) => void process.stderr.write(`${line}\n`),
	readSecret: (prompt) =>
		process.stdin.isTTY ? readHidden(prompt) : readPiped(),
	onInterrupt: (fn) => {
		process.on("SIGINT", fn);
		return () => void process.off("SIGINT", fn);
	},
};
