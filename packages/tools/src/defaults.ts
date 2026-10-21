// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Tab 10, Built-in tools: fs.grep@1 maxResults. */
export const GREP_MAX_RESULTS = 200;

/** Tab 10, Built-in tools: shell.exec@1 timeoutSec. */
export const SHELL_TIMEOUT_SEC = 120;

/** Tab 10, Built-in tools: characters kept per shell output stream. */
export const STREAM_MAX_CHARS = 30_000;

/** Tab 10, Built-in tools: a NUL byte in this many leading bytes marks a binary file. */
export const BINARY_SNIFF_BYTES = 8 * 1024;

/** Tab 09, Privacy: `.meteignore` lines that always apply. */
export const METEIGNORE_DEFAULTS = [
	".env*",
	"*.pem",
	"*.key",
	"id_rsa*",
	"secrets/",
] as const;
