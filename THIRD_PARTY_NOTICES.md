# Third-party notices

Entries: project, license, files, changes (AGENTS.md).

## models.dev

- Project: models.dev, https://github.com/sst/models.dev
- License: MIT. Copyright (c) 2025 models.dev. The full license text follows this list.
- Files: `packages/providers/data/models.yaml`
- Changes: context windows, tool calling and image input of selected NVIDIA and OpenCode Zen models, taken from `https://models.dev/api.json` on 2026-10-21 and written as METE rows; model families shortened; free flags and privacy come from the providers' own documentation, not from models.dev.

```text
MIT License

Copyright (c) 2025 models.dev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Baloo 2

- Project: Baloo 2 by Ek Type, https://github.com/EkType/Baloo2, taken from the Google Fonts repository (`ofl/baloo2/Baloo2[wght].ttf`) on 2026-10-23.
- License: SIL Open Font License 1.1. Copyright 2019 The Baloo 2 Project Authors. The full license text is `packages/ui-theia/fonts/Baloo2-OFL.txt`, shipped beside the font.
- Files: `packages/ui-theia/fonts/Baloo2-latin.woff`
- Changes: subset to the Latin, Latin-1, Latin Extended A and B, general punctuation, currency, letterlike and arrow ranges (Turkish included) and saved as WOFF with fontTools; the variable weight axis (400 to 800) is kept. The font is not renamed and keeps no Reserved Font Name.

## JetBrains Mono

- Project: JetBrains Mono by JetBrains, https://github.com/JetBrains/JetBrainsMono, taken from Google Fonts (`jetbrainsmono`, served as the latin subset WOFF2 of the variable weight 100 to 800 file, v24) on 2026-10-25.
- License: SIL Open Font License 1.1. Copyright 2020 The JetBrains Mono Project Authors. The full license text is `packages/ui-theia/fonts/JetBrainsMono-OFL.txt`, shipped beside the font.
- Files: `packages/ui-theia/fonts/JetBrainsMono-latin.woff2`
- Changes: the latin subset file as served, unchanged; the variable weight axis is kept and METE uses weights 400 to 700 (ADR-107). The font is not renamed and keeps no Reserved Font Name.

## @vscode/windows-ca-certs

- Project: @vscode/windows-ca-certs by Microsoft (originally Stas Ukolov), https://github.com/microsoft/vscode-windows-ca-certs, version 0.3.4, installed as a dependency of the desktop's extension host (ADR-103).
- License: BSD 3-Clause. Copyright (c) 2016, Stas Ukolov; Copyright (c) Microsoft Corporation. The full license text ships in the package (`LICENSE`).
- Files: `patches/@vscode__windows-ca-certs@0.3.4.patch`, applied by pnpm at install time; `scripts/test/fixtures/windows-ca-certs-0.3.4.LICENSE`, the offline license-verification fixture.
- Changes: `binding.gyp` loses the `SpectreMitigation: Spectre` MSVC configuration attribute, so the native module builds with the plain Visual Studio C++ Build Tools that the Theia build needs (ADR-103). The manifest's ambiguous `BSD` license label is corrected to `BSD-3-Clause`, matching the unchanged upstream LICENSE at tag `v0.3.4`; no source or shipped license text changes. The test fixture preserves that LICENSE with CRLF normalized to LF.

## node-pty

- Project: node-pty by Microsoft (originally Christopher Jeffrey and Daniel Imms), https://github.com/microsoft/node-pty, version 1.2.0-beta.12, installed as a dependency of the Theia terminal.
- License: MIT. Copyright (c) 2012-2015, Christopher Jeffrey; Copyright (c) 2016, Daniel Imms; Copyright (c) 2018 - present Microsoft Corporation. The full license text ships in the package (`LICENSE`).
- Files: `patches/node-pty@1.2.0-beta.12.patch`, applied by pnpm at install time.
- Changes: `binding.gyp` loses the `SpectreMitigation: Spectre` MSVC configuration attribute for the Windows build, for the same reason as above; no source file changes.

## @theia/task

- Project: Eclipse Theia, https://github.com/eclipse-theia/theia, version 1.76.0, installed with the desktop debugger (ADR-105).
- License: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0. Copyright (C) 2017 Ericsson and others. METE's patch is provided under EPL-2.0; the unchanged `LICENSE-EPL` from tag `v1.76.0` is included in the patched package.
- Files: `patches/@theia__task@1.76.0.patch`, applied by pnpm at install time to `src/browser/task-service.ts` and `lib/browser/task-service.js`, with the upstream license and its `package.json` files-list entry.
- Changes: clear the last task's problem-matcher owners before rerunning its cached configuration, just as a normal task run does. No other owners are cleared. The source is available under EPL-2.0 from the upstream tag and this repository's patch; the upstream copyright and license notices are preserved.
