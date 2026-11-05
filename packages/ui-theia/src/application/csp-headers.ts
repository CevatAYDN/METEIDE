import { isOwnDocument } from "./csp.js";

// Adds a Content-Security-Policy header to the desktop's own documents (ADR-175), over the shape of
// Electron's `session.webRequest.onHeadersReceived` so a test hands in a fake.

/** The header values Electron hands over: a string or several. */
type Headers = Record<string, string | string[]>;

/** What onHeadersReceived gives a listener, the fields the installer reads. */
export type HeadersDetails = {
	readonly url: string;
	readonly resourceType: string;
	readonly responseHeaders?: Headers | undefined;
};

/** What the listener answers. */
export type HeadersResponse = {
	readonly responseHeaders?: Headers;
};

/** The one method of Electron's WebRequest the installer uses. */
export type HeadersHook = {
	onHeadersReceived(
		listener: (
			details: HeadersDetails,
			callback: (response: HeadersResponse) => void,
		) => void,
	): void;
};

const HEADER = "Content-Security-Policy";

/** Installs the policy for the HTML documents under `frontendDir`; other responses pass unchanged. */
export const installCsp = (
	hook: HeadersHook,
	frontendDir: string,
	policy: string,
): void => {
	hook.onHeadersReceived((details, callback) => {
		if (!isOwnDocument(details.url, frontendDir, details.resourceType)) {
			callback({});
			return;
		}
		callback({
			responseHeaders: { ...details.responseHeaders, [HEADER]: [policy] },
		});
	});
};
