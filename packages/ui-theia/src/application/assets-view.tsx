import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { type AssetRow, sizeText } from "../domain/assets.js";
import { CELL, PANEL, TABLE } from "./look.js";
import { noFolderText } from "./status-text.js";
import { when } from "./time-text.js";

// The Assets view (docs/13, Assets; ADR-114): the files tools save under .mete/assets/, newest
// first — an image as its picture, and every row's media type, size and the call that saved it.
// Inline styles on Theia's CSS variables, as the other panels.

/** A row as the view draws it: the file's metadata and the URL its picture comes from. */
export type AssetItem = AssetRow & { readonly url: string };

/** What the view draws: waiting, no folder, why reading failed, or the files. */
export type AssetsModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "failed"; readonly message: string }
	| { readonly kind: "rows"; readonly rows: readonly AssetItem[] };

const DASH = "—";

const THUMB: CSSProperties = {
	width: 72,
	height: 44,
	objectFit: "cover",
	borderRadius: 6,
	background: "var(--raised, var(--theia-editorWidget-background))",
};

const PLACEHOLDER: CSSProperties = {
	...THUMB,
	display: "grid",
	placeItems: "center",
	fontSize: 10,
	color: "var(--muted, var(--theia-descriptionForeground))",
};

const extOf = (name: string) => name.split(".").pop()?.toUpperCase() ?? DASH;

const Preview = ({ row }: { readonly row: AssetItem }) =>
	row.image ? (
		<img src={row.url} alt={row.name} style={THUMB} />
	) : (
		<span style={PLACEHOLDER} aria-hidden="true">
			{extOf(row.name)}
		</span>
	);

const originText = (row: AssetItem) =>
	row.origin ? `${row.origin.server} · ${row.origin.tool}` : DASH;

// An image needs no Open: its picture is the point, and Theia has no image viewer to open it in.
const Open = ({
	row,
	onOpen,
}: {
	readonly row: AssetItem;
	readonly onOpen: (url: string) => void;
}) =>
	row.image ? null : (
		<button
			type="button"
			className="mete-button"
			onClick={() => onOpen(row.url)}
			title={nls.localize("mete/assets/openFile", "Open")}
		>
			{nls.localize("mete/assets/openFile", "Open")}
		</button>
	);

const Rows = ({
	rows,
	onOpen,
}: {
	readonly rows: readonly AssetItem[];
	readonly onOpen: (url: string) => void;
}) =>
	rows.length === 0 ? (
		<p>
			{nls.localize(
				"mete/assets/none",
				"No assets yet: a tool that saves a file, and every screenshot, appears here.",
			)}
		</p>
	) : (
		<table style={TABLE}>
			<thead>
				<tr>
					{[
						nls.localize("mete/assets/preview", "Preview"),
						nls.localize("mete/assets/name", "Name"),
						nls.localize("mete/assets/type", "Type"),
						nls.localize("mete/assets/from", "From"),
						nls.localize("mete/assets/size", "Size"),
						nls.localize("mete/assets/when", "When"),
						nls.localize("mete/assets/openFile", "Open"),
					].map((h) => (
						<th key={h} scope="col" style={CELL}>
							{h}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr key={row.path}>
						<td style={CELL}>
							<Preview row={row} />
						</td>
						<td style={CELL}>{row.name}</td>
						<td style={CELL}>{row.mediaType}</td>
						<td style={CELL}>{originText(row)}</td>
						<td style={CELL}>{sizeText(row.bytes)}</td>
						<td style={CELL}>{row.at ? when(row.at) : DASH}</td>
						<td style={CELL}>
							<Open row={row} onOpen={onOpen} />
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);

const Body = ({
	model,
	onOpen,
}: {
	readonly model: AssetsModel;
	readonly onOpen: (url: string) => void;
}) => {
	if (model.kind === "loading")
		return <p>{nls.localize("mete/assets/loading", "Reading the assets…")}</p>;
	if (model.kind === "no_folder") return <p>{noFolderText()}</p>;
	if (model.kind === "failed") return <p role="alert">{model.message}</p>;
	return <Rows rows={model.rows} onOpen={onOpen} />;
};

/** The Assets view for a model, with its Refresh button. */
export const AssetsView = ({
	model,
	onOpen,
	onRefresh,
}: {
	readonly model: AssetsModel;
	readonly onOpen: (url: string) => void;
	readonly onRefresh: () => void;
}) => (
	<section style={PANEL} aria-live="polite">
		<Body model={model} onOpen={onOpen} />
		<div>
			<button type="button" className="mete-button" onClick={onRefresh}>
				{nls.localize("mete/home/refresh", "Refresh")}
			</button>
		</div>
	</section>
);
