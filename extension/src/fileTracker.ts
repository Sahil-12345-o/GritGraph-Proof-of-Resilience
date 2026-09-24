import * as vscode from "vscode";
import { SessionManager } from "./sessionManager";

export class FileTracker {

    private changeTimer: NodeJS.Timeout | undefined;
    private changedFiles = new Set<string>();

    constructor(private sessionManager: SessionManager) {}

    start(context: vscode.ExtensionContext): void {

        const disposable =
            vscode.workspace.onDidChangeTextDocument(event => {

                if (!this.sessionManager.isActive()) {
                    return;
                }

                const file = event.document.uri.fsPath;

                this.changedFiles.add(file);

                // Wait until the developer stops editing.
                this.resetTimer();
            });

        context.subscriptions.push(disposable);
    }

    private resetTimer(): void {

        if (this.changeTimer) {
            clearTimeout(this.changeTimer);
        }

        this.changeTimer = setTimeout(() => {

            if (!this.sessionManager.isActive()) {
                this.changedFiles.clear();
                return;
            }

            const files =
                Array.from(this.changedFiles);

            /*
             * Record one meaningful code-change event.
             *
             * Edits are debounced/batched above, so typing many
             * keystrokes still produces a single code_change event.
             *
             * NOTE:
             * This tracker only records *evidence* of developer
             * activity. It intentionally does NOT count attempts.
             * Attempts are reconstructed by JourneyAnalyzer from the
             * logical problems and the recorded events.
             */
            this.sessionManager.addEvent({
                timestamp: Date.now(),
                type: "code_change",
                message:
                    `Modified ${files.length} file(s)`,
                file:
                    files.length === 1
                        ? files[0]
                        : undefined,
                source: "code"
            });

            console.log(
                `[GritGraph] Meaningful code change: ` +
                `${files.length} file(s)`
            );

            this.changedFiles.clear();

        }, 1500);
    }
}