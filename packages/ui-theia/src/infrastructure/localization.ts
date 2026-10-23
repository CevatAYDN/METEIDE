import type {
	LocalizationContribution,
	LocalizationRegistry,
} from "@theia/core/lib/node/i18n/localization-contribution";
import { injectable } from "@theia/core/shared/inversify";

// The Turkish strings of the METE panels (docs/13: English and Turkish, every UI string in a resource
// file). English is the default and lives in the code; i18n/nls.json is its extract and
// test/i18n.test.ts keeps both files in step with the code. Theia's own shell has its Turkish file.

/** Registers the Turkish resource file with Theia's localization registry. */
@injectable()
export class MeteLocalizationContribution implements LocalizationContribution {
	async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
		// Theia lists a language in "Configure Display Language" only when a language pack provides it,
		// and its own Turkish file is not one; METE's Turkish is the pack, so Türkçe can be chosen and
		// Theia's Turkish shell texts join it. A static path, so the backend bundle carries the file.
		registry.registerLocalizationFromRequire(
			{
				languageId: "tr",
				languageName: "Turkish",
				localizedLanguageName: "Türkçe",
				languagePack: true,
			},
			require("../../i18n/nls.tr.json"),
		);
	}
}
