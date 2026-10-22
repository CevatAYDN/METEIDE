// Width and height of a PNG from its IHDR chunk, which every PNG starts with. Pure.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image size, or undefined when the bytes are not a PNG. */
export const pngSize = (bytes: Uint8Array) => {
	if (bytes.length < 24 || SIGNATURE.some((b, i) => bytes[i] !== b))
		return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
};
