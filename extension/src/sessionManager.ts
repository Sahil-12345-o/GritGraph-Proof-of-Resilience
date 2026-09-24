import * as vscode from "vscode";
import {
    DebugEvent,
    DebugSession
} from "./types";
import {
    Problem,
    ProblemManager
} from "./problemManager";
import {
    JourneyAnalysis,
    JourneyAnalyzer
} from "./journeyAnalyzer";

export class SessionManager {

    private session: DebugSession | null = null;

    /*
     * Composition (not inheritance):
     *
     * SessionManager owns the raw event stream, while ProblemManager
     * is solely responsible for grouping failure events into logical
     * problems, and JourneyAnalyzer is solely responsible for
     * reconstructing meaningful debugging attempts.
     *
     * SessionManager never implements either of those algorithms.
     */
    private readonly problemManager = new ProblemManager();
    private readonly journeyAnalyzer = new JourneyAnalyzer();

    start(): void {

        if (this.session) {
            vscode.window.showWarningMessage(
                "A GritGraph session is already running."
            );
            return;
        }

        // A fresh session starts with a clean problem state.
        this.problemManager.reset();

        this.session = {
            id: `session-${Date.now()}`,
            startedAt: Date.now(),
            events: [],
            attempts: 0,
            problems: 0,
            resolved: false
        };

        vscode.window.showInformationMessage(
            " GritGraph debugging session started!"
        );
    }

    addEvent(event: DebugEvent): void {

        if (!this.session) {
            return;
        }

        this.session.events.push(event);

        /*
         * Route the event through the ProblemManager so that related
         * failure events are grouped into logical problems instead of
         * being counted one-by-one.
         */
        this.problemManager.ingest(event);

        /*
         * Success events are resolution EVIDENCE. They may resolve at
         * most ONE problem, and only when it can be confidently
         * associated with that problem. A generic success never
         * resolves every open problem.
         */
        this.problemManager.resolveWithEvidence(
            event,
            this.session.events
        );

        this.session.problems =
            this.problemManager.getProblemCount();

        /*
         * The session is "resolved" only when a problem has actually
         * been resolved, never blindly.
         */
        this.session.resolved =
            this.problemManager.hasResolvedProblem();
    }

    /**
     * @deprecated
     *
     * Legacy attempt counting. Attempts are no longer derived from
     * individual events; they are reconstructed by JourneyAnalyzer
     * from logical problems and recorded evidence.
     *
     * This method is kept only for backward compatibility. It does NOT
     * influence journey analysis, and no tracker calls it anymore.
     */
    recordAttempt(): void {

        if (!this.session) {
            return;
        }

        this.session.attempts++;

        this.session.events.push({
            timestamp: Date.now(),
            type: "attempt",
            message: `Debugging attempt #${this.session.attempts}`
        });
    }

    /**
     * Records an explicit success.
     *
     * SAFETY: This never resolves every open problem. When a
     * `problemId` is supplied, only that specific problem is resolved.
     * Without one, no problem is auto-resolved; the call is recorded as
     * evidence only.
     *
     * Automatic, evidence-based resolution happens in {@link addEvent}
     * via ProblemManager.resolveWithEvidence.
     *
     * @param problemId optional id of the specific problem to resolve
     */
    recordSuccess(problemId?: string): void {

        if (!this.session) {
            return;
        }

        if (problemId) {
            this.problemManager.resolveProblem(problemId);
        }

        /*
         * The session is "resolved" only when a problem has actually
         * been resolved. Never set this blindly.
         */
        this.session.resolved =
            this.problemManager.hasResolvedProblem();

        this.session.events.push({
            timestamp: Date.now(),
            type: "success",
            message: problemId
                ? `Problem ${problemId} resolved`
                : "Success evidence recorded"
        });

        console.log(
            "[GritGraph] Success recorded" +
            (problemId ? ` for ${problemId}` : "") + "."
        );
    }

    // -----------------------------------------------------------------
    // EVIDENCE RECORDING
    //
    // These helpers simply record outcome evidence as normalised
    // events. They contain no analysis logic. JourneyAnalyzer later
    // uses this evidence to determine attempt outcomes.
    // -----------------------------------------------------------------

    /** Record the outcome of a build. */
    recordBuildResult(success: boolean): void {
        this.addEvent({
            timestamp: Date.now(),
            type: success ? "build_success" : "build_failure",
            message: success
                ? "Build succeeded"
                : "Build failed",
            source: "build"
        });
    }

    /** Record the outcome of a test run. */
    recordTestResult(success: boolean, command?: string): void {
        this.addEvent({
            timestamp: Date.now(),
            type: success ? "test_success" : "test_failure",
            message: success
                ? "Tests passed"
                : "Tests failed",
            command,
            source: "test"
        });
    }

    /** Record the outcome of a terminal command. */
    recordCommandResult(success: boolean, command?: string): void {
        this.addEvent({
            timestamp: Date.now(),
            type: success ? "command_success" : "terminal_error",
            message: success
                ? "Command succeeded"
                : "Command failed",
            command,
            source: "terminal"
        });
    }

    isResolved(): boolean {

        return this.session?.resolved ?? false;
    }

    end(): DebugSession | null {

        if (!this.session) {
            vscode.window.showWarningMessage(
                "No active GritGraph session."
            );

            return null;
        }

        this.session.endedAt = Date.now();

        /*
         * JourneyAnalyzer is the authoritative source for calculated
         * attempts. We reflect its result into the legacy `attempts`
         * field for backward compatibility, so the reported number is
         * no longer produced by naive event counting.
         */
        const analysis = this.analyzeJourney();

        if (analysis) {
            this.session.attempts = analysis.totalAttempts;
        }

        const completedSession = this.session;

        this.session = null;

        return completedSession;
    }

    isActive(): boolean {
        return this.session !== null;
    }

    getCurrentSession(): DebugSession | null {
        return this.session;
    }

    // -----------------------------------------------------------------
    // PROBLEM STATE (delegated to ProblemManager)
    // -----------------------------------------------------------------

    /** All logical problems observed so far. */
    getProblems(): Problem[] {
        return this.problemManager.getProblems();
    }

    /** Logical problems that are still open. */
    getOpenProblems(): Problem[] {
        return this.problemManager.getOpenProblems();
    }

    /** Logical problems that have been resolved. */
    getResolvedProblems(): Problem[] {
        return this.problemManager.getResolvedProblems();
    }

    /** Access the underlying ProblemManager (e.g. to resolve one). */
    getProblemManager(): ProblemManager {
        return this.problemManager;
    }

    // -----------------------------------------------------------------
    // JOURNEY ANALYSIS (delegated to JourneyAnalyzer)
    // -----------------------------------------------------------------

    /**
     * Reconstruct the debugging journey for the current session.
     *
     * Returns null when there is no active session.
     */
    analyzeJourney(): JourneyAnalysis | null {

        if (!this.session) {
            return null;
        }

        return this.journeyAnalyzer.analyze(
            this.session,
            this.problemManager.getProblems()
        );
    }
}