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
