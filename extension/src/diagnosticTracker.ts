import * as vscode from "vscode";
import { SessionManager } from "./sessionManager";

interface TrackedError {
    message: string;
    file: string;
}

export class DiagnosticTracker {

    private previousErrors = new Map<string, TrackedError>();
    private checkTimer: NodeJS.Timeout | undefined;

    constructor(private sessionManager: SessionManager) {}

    start(context: vscode.ExtensionContext): void {

        const disposable =
            vscode.languages.onDidChangeDiagnostics(() => {

                if (!this.sessionManager.isActive()) {
                    return;
                }

                this.resetTimer();
            });

        context.subscriptions.push(disposable);
    }

    private resetTimer(): void {

        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
        }

        this.checkTimer = setTimeout(() => {
            this.checkDiagnostics();
        }, 1000);
    }

    private checkDiagnostics(): void {

        if (!this.sessionManager.isActive()) {
            return;
        }

        const currentErrors =
            new Map<string, TrackedError>();

        for (const document of vscode.workspace.textDocuments) {

            const diagnostics =
                vscode.languages.getDiagnostics(document.uri);

            for (const diagnostic of diagnostics) {

                if (
                    diagnostic.severity !==
                    vscode.DiagnosticSeverity.Error
                ) {
                    continue;
                }

                const key =
                    `${document.uri.fsPath}:` +
                    `${diagnostic.range.start.line}:` +
                    `${diagnostic.range.start.character}:` +
                    `${diagnostic.message}`;

                currentErrors.set(key, {
                    message: diagnostic.message,
                    file: document.uri.fsPath
                });
            }
        }

        /*
         * Record newly observed code problems.
         *
         * This is a PROBLEM event, not an attempt.
         */
        for (const [key, error] of currentErrors) {

            if (this.previousErrors.has(key)) {
                continue;
            }

            this.sessionManager.addEvent({
                timestamp: Date.now(),
                type: "diagnostic_error",
                message: error.message,
                file: error.file,
                source: "code"
            });

            console.log(
                `[GritGraph] Code problem detected: ${error.message}`
            );
        }

        /*
         * If the previous error state disappears completely,
         * the current problem has been resolved.
         */
        if (
            this.previousErrors.size > 0 &&
            currentErrors.size === 0
        ) {
            this.sessionManager.recordSuccess();
        }

        /*
         * Store the current state for the next comparison.
         */
        this.previousErrors = currentErrors;
    }

    clearPreviousErrors(): void {

        this.previousErrors.clear();

        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
            this.checkTimer = undefined;
        }
    }
}