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

            /*
             * A code change after a problem exists
             * represents an attempt to solve that problem.
             *
             * SessionManager will decide whether this
             * should actually count as an attempt.
             */
            const session =
                this.sessionManager.getCurrentSession();

            const hasProblem =
                session?.events.some(event =>
                    event.type === "diagnostic_error" ||
                    event.type === "terminal_error" ||
                    event.type === "build_failure" ||
                    event.type === "test_failure"
                ) ?? false;

            if (hasProblem) {
                this.sessionManager.recordAttempt();
            }

            this.changedFiles.clear();

        }, 1500);
    }
}