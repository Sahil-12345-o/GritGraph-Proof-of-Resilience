import * as vscode from "vscode";
import { SessionManager } from "./sessionManager";

export class DiagnosticTracker {

    private previousErrors = new Map<string, string>();

    constructor(private sessionManager: SessionManager) {}

    start(context: vscode.ExtensionContext): void {

        const disposable =
            vscode.languages.onDidChangeDiagnostics(event => {

                if (!this.sessionManager.isActive()) {
                    return;
                }

                for (const uri of event.uris) {

                    const diagnostics =
                        vscode.languages.getDiagnostics(uri);

                    const errors = diagnostics.filter(
                        diagnostic =>
                            diagnostic.severity ===
                            vscode.DiagnosticSeverity.Error
                    );

                    for (const error of errors) {

                        const key =
                            `${uri.fsPath}:${error.message}`;

                        // Avoid recording the exact same error repeatedly
                        if (this.previousErrors.has(key)) {
                            continue;
                        }

                        this.previousErrors.set(key, error.message);

                        this.sessionManager.addEvent({
                            timestamp: Date.now(),
                            type: "error",
                            message: error.message,
                            file: uri.fsPath
                        });

                        console.log(
                            `[GritGraph] Error detected: ${error.message}`
                        );
                    }
                }
            });

        context.subscriptions.push(disposable);
    }

    clearPreviousErrors(): void {
        this.previousErrors.clear();
    }
}