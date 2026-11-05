// The Content-Security-Policy the desktop's main process adds to its own frontend documents
// (ADR-175). Theia 1.76 sets none. Pure, so a test reads the policy without Electron.
//
// Why each directive, read from the built frontend (apps/desktop/lib/frontend/bundle.js) and Theia:
// - default-src 'self': the frontend loads from file:// (ElectronMainApplication.createWindowUri),
//   so 'self' is that origin; everything not named below is refused.
// - script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval': the bundle compiles preference schemas with
//   `new Function` (ajv, in @theia/core's preference validation) and loads WebAssembly (vscode-oniguruma
//   for TextMate grammars), so eval cannot be refused today; remote scripts still are. The Phase 5 gate
//   may tighten this when ajv's precompiled path lands.
// - style-src 'self' 'unsafe-inline': Monaco and the React panels write inline styles.
// - worker-src 'self' blob:: Monaco's editor worker and Theia's plugin worker come from the bundle's
//   folder, and the language workers from a Blob URL (bundle.js, `URL.createObjectURL`).
// - connect-src: the frontend speaks to the Theia backend on localhost over WebSocket and HTTP
//   (Endpoint, ws-connection-source.js), and plugin webviews answer at `{uuid}.webview.localhost`;
//   data: because the bundle inlines vscode-oniguruma's onig.wasm as a data: URL and fetches it
//   (seen in the app: without it every TextMate grammar fails with "Failed to fetch").
// - frame-src: plugin webviews and the mini-browser load through the backend on localhost.
// - img-src adds data: and blob: (icons, screenshots) and https: for Markdown previews.
// - font-src adds data: (codicons inlined by the bundle).
// - object-src 'none', base-uri 'none', form-action 'none': the frontend has no plugins, <base> or forms.

const LOCAL = "http://localhost:* ws://localhost:* http://*.localhost:*";

/** The policy for a frontend served from file:// that talks to a local Theia backend. */
export const cspFor = (): string =>
	[
		"default-src 'self'",
		"script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
		"style-src 'self' 'unsafe-inline'",
		"worker-src 'self' blob:",
		`connect-src 'self' data: ${LOCAL}`,
		`frame-src 'self' ${LOCAL}`,
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");

/** Whether a response is one of the app's own documents: a file:// HTML page under the frontend folder. */
export const isOwnDocument = (
	url: string,
	frontendDir: string,
	resourceType: string,
): boolean => {
	if (resourceType !== "mainFrame" && resourceType !== "subFrame") return false;
	if (!url.startsWith("file://")) return false;
	const path = decodeURIComponent(new URL(url).pathname)
		.replace(/^\/([A-Za-z]:)/, "$1")
		.replaceAll("\\", "/");
	const dir = frontendDir.replaceAll("\\", "/").replace(/\/$/, "");
	return path.startsWith(`${dir}/`) && path.endsWith(".html");
};
