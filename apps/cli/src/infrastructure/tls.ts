import { TLS_KEY_EXCHANGE } from "../defaults.js";

// The key exchange every TLS connection of this process offers (ADR-160). Node 24 with OpenSSL offers the
// hybrid post-quantum group by default; Electron's Node, which runs the desktop's daemon, does not.

/** The part of node:tls the setting needs. */
export type TlsDefaults = {
	DEFAULT_ECDH_CURVE: string;
	createSecureContext(options: { ecdhCurve: string }): unknown;
};

/** Makes TLS_KEY_EXCHANGE the default when the runtime accepts it; true when it did. */
export const preferHybridKeyExchange = (tls: TlsDefaults): boolean => {
	try {
		tls.createSecureContext({ ecdhCurve: TLS_KEY_EXCHANGE });
	} catch {
		return false;
	}
	tls.DEFAULT_ECDH_CURVE = TLS_KEY_EXCHANGE;
	return true;
};
