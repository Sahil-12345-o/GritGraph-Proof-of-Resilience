import * as vscode from "vscode";

import { SessionManager } from "./sessionManager";
import { DiagnosticTracker } from "./diagnosticTracker";
import { FileTracker } from "./fileTracker";

export function activate(context: vscode.ExtensionContext) {

    console.log("GritGraph extension activated!");

    // Create the main session manager
    const sessionManager = new SessionManager();

    // Create trackers
    const diagnosticTracker =
        new DiagnosticTracker(sessionManager);

    const fileTracker =
        new FileTracker(sessionManager);

    // Start trackers
    diagnosticTracker.start(context);
    fileTracker.start(context);

    // ------------------------------------
    // START SESSION
    // ------------------------------------

    const startCommand = vscode.commands.registerCommand(
        "gritgraph.startSession",
        () => {

            diagnosticTracker.clearPreviousErrors();

            sessionManager.start();
        }
    );

    // ------------------------------------
    // END SESSION
    // ------------------------------------

    const endCommand = vscode.commands.registerCommand(
        "gritgraph.endSession",
        () => {

            const session = sessionManager.end();

            if (!session) {
                return;
            }

            const duration =
                session.endedAt
                    ? Math.round(
                        (session.endedAt - session.startedAt)
                        / 60000
                    )
                    : 0;

            const errors =
                session.events.filter(
                    event => event.type === "error"
                ).length;

            const fileChanges =
                session.events.filter(
                    event => event.type === "file_change"
                ).length;

            console.log(
                "========== GRITGRAPH SESSION =========="
            );

            console.log(
                JSON.stringify(session, null, 2)
            );

            console.log(
                "========================================"
            );

            vscode.window.showInformationMessage(
                `🎯 Session Complete | ` +
                `Attempts: ${session.attempts} | ` +
                `Errors: ${errors} | ` +
                `Changes: ${fileChanges} | ` +
                `Duration: ${duration} min`
            );
        }
    );

    context.subscriptions.push(
        startCommand,
        endCommand
    );
}

export function deactivate() {}