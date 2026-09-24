import * as vscode from "vscode";

import { SessionManager } from "./sessionManager";
import { DiagnosticTracker } from "./diagnosticTracker";
import { FileTracker } from "./fileTracker";
import { TerminalTracker } from "./terminalTracker";
import { GritScoreEngine } from "./gritScoreEngine";

export function activate(context: vscode.ExtensionContext) {

    console.log("GritGraph extension activated!");

    // ------------------------------------
    // CORE SESSION MANAGER
    // ------------------------------------

    const sessionManager =
        new SessionManager();

    // ------------------------------------
    // TRACKERS
    //
    // Trackers only record raw evidence.
    // They never decide what counts as an attempt.
    // ------------------------------------

    const diagnosticTracker =
        new DiagnosticTracker(sessionManager);

    const fileTracker =
        new FileTracker(sessionManager);

    const terminalTracker =
        new TerminalTracker(sessionManager);

    // GritScoreEngine is stateless — one instance per activation.
    const gritScoreEngine = new GritScoreEngine();

    diagnosticTracker.start(context);
    fileTracker.start(context);
    terminalTracker.start(context);

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

                /*
                 * JourneyAnalyzer is the authoritative source for the
                 * reconstructed journey. We analyse BEFORE ending the
                 * session so the problems and events are still intact.
                 */
                const analysis =
                    sessionManager.analyzeJourney();

                if (analysis) {

                    console.log(
                        "========== GRITGRAPH JOURNEY =========="
                    );

                    console.log(
                        `Problems: ${analysis.problems.length} ` +
                        `(open: ${analysis.unresolvedProblems.length})`
                    );

                    console.log(
                        `Attempts: ${analysis.totalAttempts} ` +
                        `(successful: ${analysis.successfulAttempts}, ` +
                        `failed: ${analysis.failedAttempts}, ` +
                        `inconclusive: ${analysis.inconclusiveAttempts})`
                    );

                    console.log(
                        `Strategy change signals: ` +
                        `${analysis.strategyChanges.length}`
                    );

                    console.log(
                        JSON.stringify(analysis, null, 2)
                    );

                    console.log(
                        "========================================"
                    );
                }

                /*
                 * Compute the Grit Score from the reconstructed journey.
                 * This is done before ending the session so the analysis
                 * data is still available.
                 */
                const gritScore =
                    analysis
                        ? gritScoreEngine.compute(analysis)
                        : null;

                if (gritScore) {

                    console.log(
                        "========== GRIT SCORE =========="
                    );

                    console.log(
                        `Overall: ${gritScore.overall}/100`
                    );

                    console.log(
                        `  Persistence: ${gritScore.dimensions.persistence.score} — ` +
                        gritScore.dimensions.persistence.evidence
                    );

                    console.log(
                        `  Adaptation:  ${gritScore.dimensions.adaptation.score} — ` +
                        gritScore.dimensions.adaptation.evidence
                    );

                    console.log(
                        `  Recovery:    ${gritScore.dimensions.recovery.score} — ` +
                        gritScore.dimensions.recovery.evidence
                    );

                    console.log(
                        `  Efficiency:  ${gritScore.dimensions.efficiency.score} — ` +
                        gritScore.dimensions.efficiency.evidence
                    );

                    console.log(
                        `Explanation: ${gritScore.explanation}`
                    );

                    console.log(
                        "================================"
                    );
                }

                /*
                 * End the session only after collecting all required
                 * information.
                 */
                const session =
                    sessionManager.end();

                if (!session) {
                    return;
                }

                const totalAttempts =
                    analysis?.totalAttempts ?? session.attempts;

                const successfulAttempts =
                    analysis?.successfulAttempts ?? 0;

                const failedAttempts =
                    analysis?.failedAttempts ?? 0;

                const inconclusiveAttempts =
                    analysis?.inconclusiveAttempts ?? 0;

                const strategyChangeSignals =
                    analysis?.strategyChanges.length ?? 0;

                const resolved =
                    session.resolved ||
                    (
                        (analysis?.problems.length ?? 0) > 0 &&
                        (analysis?.unresolvedProblems.length ?? 1) === 0
                    );

                vscode.window.showInformationMessage(
                    `🎯 GritGraph Session Complete | ` +
                    `Score: ${gritScore?.overall ?? 0}/100 | ` +
                    `Problems: ${session.problems} | ` +
                    `Attempts: ${totalAttempts} ` +
                    `(✅ ${successfulAttempts} / ` +
                    ` ${failedAttempts} / ` +
                    ` ${inconclusiveAttempts}) | ` +
                    `Strategy Changes: ${strategyChangeSignals} | ` +
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