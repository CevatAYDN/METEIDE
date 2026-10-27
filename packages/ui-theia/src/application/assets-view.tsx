import { nls } from "@theia/core/lib/common/nls";
import { type AssetRow, sizeText } from "../domain/assets.js";
import { Icon } from "./roster-look.js";
import { ScreenHero } from "./screen-hero.js";
import { noFolderText } from "./status-text.js";
import { when } from "./time-text.js";

// The Assets view (docs/13, Assets; ADR-114): the files tools save under .mete/assets/, newest
// first — an image as its picture, and every row's media type, size and the call that saved it.
// Laid out by style/mete-assets.css.

/** A row as the view draws it: the file's metadata and the URL its picture comes from. */
export type AssetItem = AssetRow & { readonly url: string };

/** What the view draws: waiting, no folder, why reading failed, or the files. */
export type AssetsModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "failed"; readonly message: string }
	| { readonly kind: "rows"; readonly rows: readonly AssetItem[] };

const DASH = "—";

const extOf = (name: string) => name.split(".").pop()?.toUpperCase() ?? DASH;

const Preview = ({ row }: { readonly row: AssetItem }) =>
	row.image ? (
		<img className="mete-asset-thumb" src={row.url} alt={row.name} />
	) : (
		<span className="mete-asset-ext" aria-hidden="true">
			{extOf(row.name)}
		</span>
	);

// The server and the tool that saved the file, on two lines; the dot between them is for text.
const Origin = ({ row }: { readonly row: AssetItem }) =>
	row.origin ? (
		<>
			<span className="mete-asset-server">{row.origin.server}</span>
			<span className="mete-asset-sep"> · </span>
			<span className="mete-asset-tool">{row.origin.tool}</span>
		</>
	) : (
		DASH
	);

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
			className="mete-button quiet"
			onClick={() => onOpen(row.url)}
			title={nls.localize("mete/assets/openFile", "Open")}
			aria-label={nls.localize("mete/assets/openNamed", "Open {0}", row.name)}
		>
			<Icon name="go-to-file" />
			{nls.localize("mete/assets/openFile", "Open")}
		</button>
	);

const Heads = () => (
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
			<th key={h} scope="col">
				{h}
			</th>
		))}
	</tr>
);

const Rows = ({
	rows,
	onOpen,
}: {
	readonly rows: readonly AssetItem[];
	readonly onOpen: (url: string) => void;
}) =>
	rows.length === 0 ? (
		<p className="mete-assets-state">
			{nls.localize(
				"mete/assets/none",
				"No assets yet: a tool that saves a file, and every screenshot, appears here.",
			)}
		</p>
	) : (
		<section
			className="mete-table-card mete-assets-card"
			aria-label={nls.localize("mete/assets/title", "Assets")}
		>
			<table>
				<colgroup>
					<col className="preview" />
					<col className="name" />
					<col className="type" />
					<col className="from" />
					<col className="size" />
					<col className="when" />
					<col />
				</colgroup>
				<thead>
					<Heads />
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.path}>
							<td>
								<Preview row={row} />
							</td>
							<td className="mete-asset-name">{row.name}</td>
							<td>
								<span className="mete-asset-type">{row.mediaType}</span>
							</td>
							<td className={row.origin ? undefined : "mete-asset-none"}>
								<Origin row={row} />
							</td>
							<td className="mete-asset-size">{sizeText(row.bytes)}</td>
							<td className={row.at ? "mete-asset-when" : "mete-asset-none"}>
								{row.at ? when(row.at) : DASH}
							</td>
							<td>
								<Open row={row} onOpen={onOpen} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);

const Body = ({
	model,
	onOpen,
}: {
	readonly model: AssetsModel;
	readonly onOpen: (url: string) => void;
}) => {
	if (model.kind === "loading")
		return (
			<p className="mete-assets-state">
				{nls.localize("mete/assets/loading", "Reading the assets…")}
			</p>
		);
	if (model.kind === "no_folder")
		return <p className="mete-assets-state">{noFolderText()}</p>;
	if (model.kind === "failed")
		return (
			<p className="mete-assets-state" role="alert">
				{model.message}
			</p>
		);
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
	<section className="mete-screen mete-assets" aria-live="polite">
		<ScreenHero
			compact
			icon="file-media"
			title={nls.localize("mete/assets/title", "Assets")}
			caption={nls.localize(
				"mete/assets/caption",
				"METE: the files tools saved",
			)}
			actions={
				<button type="button" className="mete-button quiet" onClick={onRefresh}>
					<Icon name="refresh" />
					{nls.localize("mete/home/refresh", "Refresh")}
				</button>
			}
		/>
		<Body model={model} onOpen={onOpen} />
	</section>
);
