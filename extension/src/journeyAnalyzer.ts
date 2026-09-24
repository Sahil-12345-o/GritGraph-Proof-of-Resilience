import {
    DebugEvent,
    DebugEventType,
    DebugSession
} from "./types";
import {
    Problem,
    ProblemManager
} from "./problemManager";

/**
 * Outcome of a single debugging attempt.
 *
 * - "failed"       the developer acted, but the problem came back
 * - "successful"   the developer acted and strong evidence shows it worked
 * - "inconclusive" the developer acted, but evidence is insufficient
 */
export type AttemptOutcome =
    | "failed"
    | "successful"
    | "inconclusive";

/**
 * Normalised category of activity performed during an attempt.
 *
 * This is deliberately language/framework agnostic: it is derived only
 * from the normalised event types.
 */
export type AttemptCategory =
    | "code_change"
    | "terminal_command"
    | "build"
    | "test"
    | "workflow"
    | "environment";

/**
 * A meaningful effort by the developer to solve an existing logical
 * problem, together with the outcome evidence available at the time.
 */
export interface Attempt {

    /** Unique identifier of the attempt. */
    id: string;

    /** The logical problem this attempt was aimed at, if known. */
    problemId?: string;

    /** When the developer's effort began (problem observed). */
    startedAt: number;

    /** When the outcome evidence was last observed. */
    endedAt: number;

    /** Relevant events: the developer's effort and its outcome evidence. */
    events: DebugEvent[];

    /** Normalised categories of activity performed. */
    actions: AttemptCategory[];

    /** Files touched during the attempt, when known. */
    files: string[];

    /** How the attempt turned out. */
    outcome: AttemptOutcome;

    /** Whether this attempt followed a detected change of strategy. */
    strategyChanged: boolean;
}

/**
 * A *signal* that the developer changed approach between two attempts.
 *
 * This is intentionally represented as a signal (with a confidence
 * level) rather than a hard claim: we only ever observe evidence.
 */
export interface StrategyChange {

    /** Unique identifier of the signal. */
    id: string;

    /** The problem whose attempt sequence changed direction. */
    problemId?: string;

    /** When the change of direction was observed. */
    detectedAt: number;

    /** The attempt that preceded the change, if any. */
    fromAttemptId?: string;

    /** The attempt that introduced the change, if any. */
    toAttemptId?: string;

    /** Activity categories before the change. */
    fromActions: AttemptCategory[];

    /** Activity categories after the change. */
    toActions: AttemptCategory[];

    /** Human-readable explanation of the observed signal. */
    reason: string;

    /**
     * "observed"  - strong evidence (activity type changed)
     * "candidate" - weaker evidence (e.g. only the file changed)
     */
    confidence: "observed" | "candidate";
}

/**
 * The reconstructed debugging journey for a session.
 */
export interface JourneyAnalysis {

    /** Session this analysis belongs to. */
    sessionId: string;

    /** The logical problems that were considered. */
    problems: Problem[];

    /** All reconstructed attempts, ordered chronologically. */
    attempts: Attempt[];

    /** All observed strategy-change signals. */
    strategyChanges: StrategyChange[];

    /** Total number of reconstructed attempts. */
    totalAttempts: number;

    /** Attempts that ended successfully. */
    successfulAttempts: number;

    /** Attempts that failed (the problem came back). */
    failedAttempts: number;

    /** Attempts whose outcome could not be determined. */
    inconclusiveAttempts: number;

    /** Problems that were never resolved. */
    unresolvedProblems: Problem[];
}

/*
 * Developer-effort event types.
 *
 * These represent the developer *doing something* about a problem.
 */
const ACTION_EVENT_TYPES: DebugEventType[] = [
    "code_change",
    "terminal_command",
    "workflow_change",
    "environment_change"
];

/*
 * Strong success evidence.
 *
 * Only these outcomes are treated as proving an attempt worked.
 * "there are currently zero diagnostics" is intentionally NOT used.
 */
const SUCCESS_EVENT_TYPES: DebugEventType[] = [
    "command_success",
    "build_success",
    "test_success"
];

function isActionEvent(type: DebugEventType): boolean {
    return ACTION_EVENT_TYPES.indexOf(type) !== -1;
}

function isSuccessEvent(type: DebugEventType): boolean {
    return SUCCESS_EVENT_TYPES.indexOf(type) !== -1;
}

/**
 * Map a raw event to a normalised activity category.
 */
function categoryForEvent(
    event: DebugEvent
): AttemptCategory | null {

    switch (event.type) {
        case "code_change":
            return "code_change";
        case "terminal_command":
        case "terminal_error":
            return "terminal_command";
        case "build_failure":
        case "build_success":
            return "build";
        case "test_failure":
        case "test_success":
            return "test";
        case "workflow_change":
            return "workflow";
        case "environment_change":
            return "environment";
        default:
            return null;
    }
}

/**
 * Return the unique categories present in a list of events.
 */
function categoriesForEvents(
    events: DebugEvent[]
): AttemptCategory[] {

    const seen = new Set<AttemptCategory>();

    for (const event of events) {
        const category = categoryForEvent(event);
        if (category) {
            seen.add(category);
        }
    }

    return Array.from(seen).sort();
}

/**
 * Return the unique files present in a list of events.
 */
function filesForEvents(events: DebugEvent[]): string[] {

    const seen = new Set<string>();

    for (const event of events) {
        if (event.file) {
            seen.add(event.file);
        }
    }

    return Array.from(seen).sort();
}

/**
 * Compare two collections of strings for set equality.
 */
function sameSet(a: string[], b: string[]): boolean {

    if (a.length !== b.length) {
        return false;
    }

    const bSet = new Set(b);

    for (const value of a) {
        if (!bSet.has(value)) {
            return false;
        }
    }

    return true;
}

/**
 * JourneyAnalyzer
 *
 * Responsibility:
 *
 *     logical problems + raw events
 *                 ↓
 *     reconstructed debugging attempts
 *                 ↓
 *     observed strategy-change signals
 *
 * It is the authoritative source for *calculated* attempts. Raw event
 * collection (the trackers) never decides what counts as an attempt.
 *
 * It intentionally does NOT:
 *
 *   - calculate a Grit Score
 *   - perform AI-based interpretation
 *   - infer resolution from "zero diagnostics"
 *   - treat every event as an attempt
 */
export class JourneyAnalyzer {

    private attemptCounter = 0;
    private strategyChangeCounter = 0;

    /**
     * Reconstruct the journey from a finished (or in-progress) session
     * and the logical problems produced by the ProblemManager.
     */
    analyze(
        session: DebugSession,
        problems: Problem[]
    ): JourneyAnalysis {

        this.attemptCounter = 0;
        this.strategyChangeCounter = 0;

        const attempts: Attempt[] = [];
        const strategyChanges: StrategyChange[] = [];

        for (const problem of problems) {

            const result = this.analyzeProblem(session, problem);

            for (const attempt of result.attempts) {
                attempts.push(attempt);
            }

            for (const change of result.strategyChanges) {
                strategyChanges.push(change);
            }
        }

        /*
         * Attempts are reconstructed per problem; present them in
         * chronological order across the whole session.
         */
        attempts.sort((a, b) => a.startedAt - b.startedAt);

        return {
            sessionId: session.id,
            problems,
            attempts,
            strategyChanges,
            totalAttempts: attempts.length,
            successfulAttempts:
                attempts.filter(a => a.outcome === "successful").length,
            failedAttempts:
                attempts.filter(a => a.outcome === "failed").length,
            inconclusiveAttempts:
                attempts.filter(a => a.outcome === "inconclusive").length,
            unresolvedProblems:
                problems.filter(problem => !problem.resolved)
        };
    }

    /**
     * Convenience overload that pulls problems directly from a
     * ProblemManager.
     */
    analyzeSession(
        session: DebugSession,
        problemManager: ProblemManager
    ): JourneyAnalysis {
        return this.analyze(session, problemManager.getProblems());
    }

    // -----------------------------------------------------------------
    // Per-problem reconstruction
    // -----------------------------------------------------------------

    private analyzeProblem(
        session: DebugSession,
        problem: Problem
    ): {
        attempts: Attempt[];
        strategyChanges: StrategyChange[];
    } {

        const attempts: Attempt[] = [];
        const strategyChanges: StrategyChange[] = [];

        /*
         * The problem's failure events, in chronological order. These
         * mark the moments where the problem was observed.
         */
        const failures = problem.events
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp);

        if (failures.length === 0) {
            return { attempts, strategyChanges };
        }

        /*
         * Every problem event is also present in the session's event
         * stream (ProblemManager stores the same references).
         */
        const failureSet = new Set<DebugEvent>(problem.events);

        for (let i = 0; i < failures.length; i++) {

            const windowStart = failures[i].timestamp;
            const nextFailure = failures[i + 1];

            const evaluation = this.evaluateWindow(
                session,
                problem,
                failures[i],
                nextFailure,
                failureSet
            );

            if (!evaluation) {
                continue;
            }

            this.attemptCounter++;

            attempts.push({
                id: `attempt-${this.attemptCounter}`,
                problemId: problem.id,
                startedAt: windowStart,
                endedAt: evaluation.endedAt,
                events: evaluation.events,
                actions: evaluation.actions,
                files: evaluation.files,
                outcome: evaluation.outcome,
                strategyChanged: false
            });
        }

        this.detectStrategyChanges(
            problem,
            attempts,
            strategyChanges
        );

        return { attempts, strategyChanges };
    }

    /**
     * Inspect the window between one failure and the next (or the end
     * of the problem) and, if the developer acted, build an attempt.
     *
     * Returns null when the window contains no meaningful developer
     * effort, so that merely observing a problem is never mistaken for
     * an attempt.
     */
    private evaluateWindow(
        session: DebugSession,
        problem: Problem,
        failure: DebugEvent,
        nextFailure: DebugEvent | undefined,
        failureSet: Set<DebugEvent>
    ): {
        events: DebugEvent[];
        actions: AttemptCategory[];
        files: string[];
        outcome: AttemptOutcome;
        endedAt: number;
    } | null {

        const windowStart = failure.timestamp;

        const upperBound = nextFailure
            ? nextFailure.timestamp
            : this.problemEnd(problem, session);

        const inclusiveUpper = nextFailure === undefined;

        const relevant = session.events.filter(event => {

            if (failureSet.has(event)) {
                return false;
            }

            if (event.timestamp <= windowStart) {
                return false;
            }

            if (inclusiveUpper) {
                return event.timestamp <= upperBound;
            }

            return event.timestamp < upperBound;
        });

        const actionEvents = relevant.filter(
            event => isActionEvent(event.type)
        );

        const successEvents = relevant.filter(
            event => isSuccessEvent(event.type)
        );

        /*
         * Without effort or outcome evidence, this is not an attempt.
         */
        if (actionEvents.length === 0 && successEvents.length === 0) {
            return null;
        }

        const evidence = actionEvents.concat(successEvents);

        evidence.sort((a, b) => a.timestamp - b.timestamp);

        const endedAt = evidence[evidence.length - 1].timestamp;

        const outcome = this.determineOutcome(
            problem,
            nextFailure,
            successEvents
        );

        return {
            events: evidence,
            actions: categoriesForEvents(evidence),
            files: filesForEvents(evidence),
            outcome,
            endedAt
        };
    }

    /**
     * Determine the end boundary of a problem's final window.
     */
    private problemEnd(
        problem: Problem,
        session: DebugSession
    ): number {

        if (problem.resolved && problem.resolvedAt !== undefined) {
            return problem.resolvedAt;
        }

        if (session.endedAt !== undefined) {
            return session.endedAt;
        }

        return Number.POSITIVE_INFINITY;
    }

    /**
     * Decide the outcome of an attempt from the available evidence.
     *
     * - A recurring failure of the same problem ⇒ failed.
     * - No recurrence + strong success evidence (or explicit problem
     *   resolution) ⇒ successful.
     * - Otherwise ⇒ inconclusive.
     */
    private determineOutcome(
        problem: Problem,
        nextFailure: DebugEvent | undefined,
        successEvents: DebugEvent[]
    ): AttemptOutcome {

        if (nextFailure) {
            return "failed";
        }

        if (successEvents.length > 0 || problem.resolved) {
            return "successful";
        }

        return "inconclusive";
    }

    /**
     * Compare consecutive attempts of a problem and emit strategy
     * change signals when the approach appears to shift.
     */
    private detectStrategyChanges(
        problem: Problem,
        attempts: Attempt[],
        strategyChanges: StrategyChange[]
    ): void {

        for (let i = 1; i < attempts.length; i++) {

            const previous = attempts[i - 1];
            const current = attempts[i];

            const categoriesChanged = !sameSet(
                previous.actions,
                current.actions
            );

            const filesChanged =
                previous.files.length > 0 &&
                current.files.length > 0 &&
                !sameSet(previous.files, current.files);

            if (!categoriesChanged && !filesChanged) {
                continue;
            }

            /*
             * A change of activity type is strong evidence; a change
             * of file alone is only a candidate.
             */
            const confidence: "observed" | "candidate" =
                categoriesChanged ? "observed" : "candidate";

            const reason = categoriesChanged
                ? `Approach changed from ${this.describe(previous.actions)} ` +
                  `to ${this.describe(current.actions)}.`
                : `Focus moved from ${this.describe(previous.files)} ` +
                  `to ${this.describe(current.files)}.`;

            this.strategyChangeCounter++;

            strategyChanges.push({
                id: `strategy-${this.strategyChangeCounter}`,
                problemId: problem.id,
                detectedAt: current.startedAt,
                fromAttemptId: previous.id,
                toAttemptId: current.id,
                fromActions: previous.actions,
                toActions: current.actions,
                reason,
                confidence
            });

            current.strategyChanged = true;
        }
    }

    private describe(values: string[]): string {
        return values.length > 0
            ? `[${values.join(", ")}]`
            : "[unknown]";
    }
}