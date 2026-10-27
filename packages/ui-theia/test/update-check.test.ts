import { describe, expect, it } from "vitest";
import { checkUpdate, type Updater } from "../src/application/update-check.js";

// One update check (ADR-137) over a fake updater, so no test reaches GitHub.

const coded = (code: string, message: string) =>
	Object.assign(new Error(message), { code });

const updater = (
	found: Awaited<ReturnType<Updater["checkForUpdates"]>> | Error,
) => {
	const downloads: string[] = [];
	const fake: Updater = {
		checkForUpdates: async () => {
			if (found instanceof Error) throw found;
			return found;
		},
		downloadUpdate: async () => void downloads.push("download"),
	};
	return { fake, downloads };
};

describe("checkUpdate", () => {
	it("says an unpackaged app does not update itself", async () => {
		const { fake } = updater(null);
		expect(await checkUpdate(fake, "0.1.0")).toEqual({ kind: "source" });
	});

	it("names the current version when it is the newest", async () => {
		const { fake, downloads } = updater({
			isUpdateAvailable: false,
			updateInfo: { version: "0.1.0" },
		});
		expect(await checkUpdate(fake, "0.1.0")).toEqual({
			kind: "latest",
			current: "0.1.0",
		});
		expect(downloads).toEqual([]);
	});

	it("downloads a newer release before it offers it", async () => {
		const { fake, downloads } = updater({
			isUpdateAvailable: true,
			updateInfo: { version: "0.2.0" },
		});
		expect(await checkUpdate(fake, "0.1.0")).toEqual({
			kind: "ready",
			version: "0.2.0",
		});
		expect(downloads).toEqual(["download"]);
	});

	it.each([
		"ERR_XML_MISSED_ELEMENT",
		"ERR_UPDATER_NO_PUBLISHED_VERSIONS",
		"ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
		"ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
	])("reads %s as no release published yet", async (code) => {
		const { fake } = updater(coded(code, "No published versions on GitHub"));
		expect(await checkUpdate(fake, "0.0.0")).toEqual({
			kind: "unpublished",
			current: "0.0.0",
		});
	});

	it("says GitHub hides the releases when their feed answers 404", async () => {
		const { fake } = updater(coded("HTTP_ERROR_404", "404 \nHeaders: {}"));
		expect(await checkUpdate(fake, "0.1.0")).toEqual({ kind: "hidden" });
	});

	it("reports a failed download as a failure, not a hidden release", async () => {
		const fake: Updater = {
			checkForUpdates: async () => ({
				isUpdateAvailable: true,
				updateInfo: { version: "0.2.0" },
			}),
			downloadUpdate: async () => {
				throw coded("HTTP_ERROR_404", "404 \nHeaders: {}");
			},
		};
		expect(await checkUpdate(fake, "0.1.0")).toEqual({
			kind: "failed",
			message: "404 ",
		});
	});

	it("keeps the first line of any other failure", async () => {
		const { fake } = updater(
			coded("ENOTFOUND", "getaddrinfo ENOTFOUND github.com\n    at stack"),
		);
		expect(await checkUpdate(fake, "0.1.0")).toEqual({
			kind: "failed",
			message: "getaddrinfo ENOTFOUND github.com",
		});
	});
});
