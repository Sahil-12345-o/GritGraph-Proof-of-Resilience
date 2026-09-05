import * as vscode from "vscode";
import { SessionManager } from "./sessionManager";

export class FileTracker {

    constructor(private sessionManager: SessionManager) {}

    start(context: vscode.ExtensionContext): void {

        const disposable =
            vscode.workspace.onDidChangeTextDocument(event => {

                if (!this.sessionManager.isActive()) {
                    return;
                }

                const file = event.document.uri.fsPath;

                this.sessionManager.addEvent({
                    timestamp: Date.now(),
                    type: "file_change",
                    message: "Code modified",
                    file
                });

                console.log(
                    `[GritGraph] File changed: ${file}`
                );
            });

        context.subscriptions.push(disposable);
    }
}