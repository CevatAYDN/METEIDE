# Local extension fixture

`lifecycle-extension.vsix` is a ZIP of the adjacent `lifecycle-extension/`
sources, authored in this repository under Apache-2.0. It has no network calls,
dependencies or secrets. Its sole command writes `extension-activation.txt`
inside the isolated test workspace.

The committed ZIP lets the acceptance test run without a ZIP program or an
additional runtime dependency. Regenerate after source changes, for example
with .NET `System.IO.Compression.ZipFile.CreateFromDirectory`, placing the
contents (not the enclosing source directory) at the archive root.
