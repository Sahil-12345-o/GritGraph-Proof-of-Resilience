import * as vscode from "vscode";

import { SessionManager } from "./sessionManager";
import { DiagnosticTracker } from "./diagnosticTracker";
import { FileTracker } from "./fileTracker";

export function activate(context: vscode.ExtensionContext) {

    console.log("GritGraph extension activated!");

    // ------------------------------------
    // CORE SESSION MANAGER
    // ------------------------------------

    const sessionManager =
        new SessionManager();

    // ------------------------------------
    // TRACKERS
    // ------------------------------------

    const diagnosticTracker =
        new DiagnosticTracker(sessionManager);

    const fileTracker =
        new FileTracker(sessionManager);

    diagnosticTracker.start(context);
    fileTracker.start(context);

    // ------------------------------------
    // START SESSION
    // ------------------------------------

    const startCommand =
        vscode.commands.registerCommand(
            "gritgraph.startSession",
            () => {

                diagnosticTracker.clearPreviousErrors();

                sessionManager.start();
            }
        );

    // ------------------------------------
    // END SESSION
    // ------------------------------------

    const endCommand =
        vscode.commands.registerCommand(
            "gritgraph.endSession",
            () => {

                /*
                 * Calculate the important information
                 * BEFORE ending the session.
                 */
                const activeSession =
                    sessionManager.getCurrentSession();

                if (!activeSession) {
                    vscode.window.showWarningMessage(
                        "No active GritGraph session."
                    );
                    return;
                }

                const duration =
                    Math.round(
                        (Date.now() - activeSession.startedAt)
                        / 60000
                    );

                const errors =
                    activeSession.events.filter(
                        event =>
                            event.type === "diagnostic_error" ||
                            event.type === "terminal_error" ||
                            event.type === "build_failure" ||
                            event.type === "test_failure"
                    ).length;

                const codeChanges =
                    activeSession.events.filter(
                        event =>
                            event.type === "code_change"
                    ).length;

                const terminalCommands =
                    activeSession.events.filter(
                        event =>
                            event.type === "terminal_command"
                    ).length;

                const strategyChanges =
                    activeSession.events.filter(
                        event =>
                            event.type === "strategy_change"
                    ).length;

                const resolved =
                    activeSession.resolved;

                console.log(
                    "========== GRITGRAPH SESSION =========="
                );

                console.log(
                    JSON.stringify(
                        activeSession,
                        null,
                        2
                    )
                );

                console.log(
                    "========================================"
                );

                /*
                 * End the session only after collecting
                 * all required information.
                 */
                const session =
                    sessionManager.end();

                if (!session) {
                    return;
                }

                vscode.window.showInformationMessage(
                    `🎯 GritGraph Session Complete | ` +
                    `Attempts: ${session.attempts} | ` +
                    `Problems: ${session.problems} | ` +
                    `Code Changes: ${codeChanges} | ` +
                    `Terminal Commands: ${terminalCommands} | ` +
                    `Strategy Changes: ${strategyChanges} | ` +
                    `Resolved: ${resolved ? "YES ✅" : "NO ❌"} | ` +
                    `Duration: ${duration} min`
                );
            }
        );

    // ------------------------------------
    // REGISTER COMMANDS
    // ------------------------------------

    context.subscriptions.push(
        startCommand,
        endCommand
    );
}

export function deactivate() {}