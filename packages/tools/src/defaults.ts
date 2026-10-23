// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Tab 10, Built-in tools: fs.grep@1 maxResults. */
export const GREP_MAX_RESULTS = 200;

/** Tab 10, Built-in tools: shell.exec@1 timeoutSec. */
export const SHELL_TIMEOUT_SEC = 120;

/** Tab 10, Built-in tools: how long a killed shell's output may stay open before stragglers are swept. */
export const KILL_GRACE_MS = 1000;

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

/** Tab 10, Built-in tools: characters web.fetch@1 keeps of a page's Markdown. */
export const WEB_FETCH_MAX_CHARS = 100_000;

/** Tab 10, Built-in tools: bytes web.fetch@1 reads of a response before it gives up. */
export const WEB_FETCH_MAX_BYTES = 5_000_000;

/** Tab 10, Built-in tools: how long one web.fetch@1 call may take, redirects included. */
export const WEB_FETCH_TIMEOUT_MS = 30_000;

/** Tab 10, Built-in tools: redirects web.fetch@1 follows. */
export const WEB_FETCH_MAX_REDIRECTS = 5;

/** Tab 10, Built-in tools: Tavily's search endpoint (docs/05, search providers). */
export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

/** Tab 10, Built-in tools: the most results Tavily returns for one search. */
export const TAVILY_MAX_RESULTS = 20;

/** Tab 10, Built-in tools: how long one browser.screenshot@2 or seo.audit@2 call may take. */
export const BROWSER_TIMEOUT_MS = 120_000;

/** Tab 10, Built-in tools: characters of the browser runner's stderr kept for its error messages. */
export const RUNNER_STDERR_CHARS = 2000;

/** Tab 10, Built-in tools: how long installing Chromium on first use may take. */
export const CHROMIUM_INSTALL_TIMEOUT_MS = 600_000;
