// CommonJS is the native VS Code extension entry format, not a METE module.
const vscode = require("vscode");

exports.activate = (context) => {
	context.subscriptions.push(
		vscode.commands.registerCommand("meteFixture.ping", async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) return;
			await vscode.workspace.fs.writeFile(
				vscode.Uri.joinPath(folder.uri, "extension-activation.txt"),
				Buffer.from("METE lifecycle fixture activated\n"),
			);
		}),
	);
};
