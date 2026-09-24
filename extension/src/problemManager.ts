import {
    DebugEvent,
    DebugEventType,
    FailureSource
} from "./types";

/**
 * Lifecycle state of a logical problem.
 *
 * A problem starts as "open" and becomes "resolved" only when the
 * caller explicitly reports that it has been resolved.
 */
export type ProblemStatus = "open" | "resolved";

/**
 * A logical problem groups one or more related failure events.
 *
 * IMPORTANT:
 * A problem is NOT the same thing as a raw event. Many raw events
 * (for example several diagnostic errors and code changes) may belong
 * to a single logical problem such as "type mismatch in function call".
 */
export interface Problem {

    /** Unique identifier for this logical problem. */
    id: string;

    /** Where the problem originated from. */
    source: FailureSource;

    /** Timestamp of the first related event. */
    firstSeenAt: number;

    /** Timestamp of the most recent related event. */
    lastSeenAt: number;

    /** All raw events that have been grouped into this problem. */
    events: DebugEvent[];

    /** Current lifecycle state. */
    status: ProblemStatus;

    /** Convenience flag mirroring `status === "resolved"`. */
    resolved: boolean;

    /** When the problem was resolved, if it has been. */
    resolvedAt?: number;

    /** Representative human-readable description. */
    message: string;

    /** File associated with the problem, when known. */
    file?: string;

    /** Command associated with the problem, when known. */
    command?: string;
}

/**
 * Configuration for the ProblemManager.
 *
 * These options exist so that the grouping strategy can be tuned or
 * replaced later (for example by an AI/JourneyAnalyzer) without
 * rewriting the manager itself.
 */
export interface ProblemManagerOptions {

    /**
     * Maximum time gap (in milliseconds) between two events for them
     * to be considered temporally close.
     */
    groupingWindowMs?: number;

    /**
     * Minimum similarity score required to attach an event to an
     * existing problem instead of creating a new one.
     */
    matchThreshold?: number;

    /**
     * Event types that are considered potential problem triggers.
     */
    problemEventTypes?: DebugEventType[];
}

/**
 * Default event types that can create or extend a logical problem.
 *
 * These cover every observable failure source: code diagnostics,
 * terminal failures, build failures, and test failures.
 *
 * NOTE: `workflow_change` and `environment_change` are intentionally
 * NOT included here. They represent developer *actions* (switching a
 * tool, editing a config), not failures. They remain available as
 * developer-effort evidence in DEVELOPER_ACTION_TYPES so they can
 * still influence resolution scoring and attempt reconstruction.
 */
const DEFAULT_PROBLEM_EVENT_TYPES: DebugEventType[] = [
    "diagnostic_error",
    "terminal_error",
    "build_failure",
    "test_failure"
];

const DEFAULT_GROUPING_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MATCH_THRESHOLD = 3;

/**
 * Success event types that can act as resolution evidence.
 */
const SUCCESS_EVENT_TYPES: DebugEventType[] = [
    "command_success",
    "build_success",
    "test_success"
];

/**
 * Event types that represent the developer *doing something* about a
 * problem. Their presence between a problem's last failure and a
 * success event increases confidence that the success relates to it.
 */
const DEVELOPER_ACTION_TYPES: DebugEventType[] = [
    "code_change",
    "terminal_command",
    "workflow_change",
    "environment_change"
];

/**
 * Minimum evidence score required before a success event will resolve
 * a problem. Keeping this conservative prevents false resolutions.
 */
const RESOLUTION_THRESHOLD = 3;

/**
 * ProblemManager
 *
 * Responsibility:
 *
 *     raw failure events
 *             ↓
 *     logical problems
 *             ↓
 *     problem state
 *
 * It groups related failure events into logical problems using a
 * conservative, deterministic strategy based on:
 *
 *   - same source
 *   - same file (when available)
 *   - same command (when available)
 *   - similar / repeated error message
 *   - close temporal proximity
 *
 * It intentionally does NOT:
 *
 *   - calculate attempts (that belongs to a future JourneyAnalyzer)
 *   - calculate a Grit Score
 *   - perform AI-based semantic understanding
 *   - automatically decide that a session is resolved
 */
export class ProblemManager {

    private problems: Problem[] = [];

    private readonly groupingWindowMs: number;
    private readonly matchThreshold: number;
    private readonly problemEventTypes: Set<DebugEventType>;

    private problemCounter = 0;

    constructor(options: ProblemManagerOptions = {}) {

        this.groupingWindowMs =
            options.groupingWindowMs ?? DEFAULT_GROUPING_WINDOW_MS;

        this.matchThreshold =
            options.matchThreshold ?? DEFAULT_MATCH_THRESHOLD;

        this.problemEventTypes = new Set(
            options.problemEventTypes ?? DEFAULT_PROBLEM_EVENT_TYPES
        );
    }

    /**
     * Feed a raw event into the manager.
     *
     * If the event is a problem trigger it will either be attached to
     * an existing open problem or used to create a new one.
     *
     * @returns the affected problem, or null if the event is not a
     *          problem trigger.
     */
    ingest(event: DebugEvent): Problem | null {

        if (!this.isProblemEvent(event)) {
            return null;
        }

        const source = ProblemManager.sourceForEvent(event);

        /*
         * If the event already carries a problemId, honour it when the
         * referenced problem exists. This allows future components to
         * pre-assign events to problems.
         */
        if (event.problemId) {
            const existing = this.getProblem(event.problemId);
            if (existing) {
                this.attachEvent(existing, event);
                return existing;
            }
        }

        const match = this.findBestMatch(event, source);

        if (match) {
            this.attachEvent(match, event);
            return match;
        }

        const problem = this.createProblem(event, source);
        this.problems.push(problem);
        return problem;
    }

    /**
     * Explicitly resolve a problem.
     *
     * Resolution is only performed when the caller tells the manager
     * that the problem is resolved. The manager never infers
     * resolution on its own.
     *
     * @returns the resolved problem, or null if it does not exist.
     */
    resolveProblem(
        problemId: string,
        resolvedAt: number = Date.now()
    ): Problem | null {

        const problem = this.getProblem(problemId);

        if (!problem) {
            return null;
        }

        if (problem.resolved) {
            return problem;
        }

        problem.resolved = true;
        problem.status = "resolved";
        problem.resolvedAt = resolvedAt;

        return problem;
    }

    /**
     * Explicitly resolve every currently open problem.
     *
     * IMPORTANT: This is NOT the normal response to a success event.
     * A generic success must never resolve unrelated problems. Safe,
     * evidence-based resolution uses {@link resolveWithEvidence}, which
     * resolves at most one confidently matched problem.
     *
     * This bulk method exists only for a deliberate, caller-driven
     * "everything is resolved" action.
     */
    resolveAll(resolvedAt: number = Date.now()): Problem[] {

        const resolved: Problem[] = [];

        for (const problem of this.problems) {
            if (!problem.resolved) {
                this.resolveProblem(problem.id, resolvedAt);
                resolved.push(problem);
            }
        }

        return resolved;
    }

    /**
     * Resolve at most ONE problem using a success event as evidence.
     *
     * This is the safe counterpart to a generic "success": it never
     * resolves every open problem. It finds the single open problem the
     * success most plausibly belongs to and resolves it only when the
     * evidence is strong enough. If nothing matches confidently, the
     * evidence is preserved but no problem is resolved.
     *
     * @param successEvent  the success/outcome event
     * @param contextEvents the full session event stream, used to detect
     *                      developer effort between a failure and the
     *                      success
     * @returns the resolved problem, or null when no confident
     *          association exists
     */
    resolveWithEvidence(
        successEvent: DebugEvent,
        contextEvents: DebugEvent[] = []
    ): Problem | null {

        const successSource =
            ProblemManager.sourceForSuccessEvent(successEvent);

        // Not a success event: nothing to resolve.
        if (!successSource) {
            return null;
        }

        let best: Problem | null = null;
        let bestScore = 0;

        for (const problem of this.problems) {

            // Only open problems can be resolved.
            if (problem.resolved) {
                continue;
            }

            // A success cannot resolve a problem last seen after it.
            if (problem.lastSeenAt > successEvent.timestamp) {
                continue;
            }

            const score = this.scoreResolution(
                problem,
                successEvent,
                successSource,
                contextEvents
            );

            if (score > bestScore) {
                bestScore = score;
                best = problem;
            }
        }

        /*
         * Resolve ONLY the single best candidate, and only when the
         * evidence clears the threshold.
         */
        if (best && bestScore >= RESOLUTION_THRESHOLD) {
            return this.resolveProblem(best.id, successEvent.timestamp);
        }

        return null;
    }

    /** Whether a specific problem has been resolved. */
    isProblemResolved(problemId: string): boolean {
        return this.getProblem(problemId)?.resolved ?? false;
    }

    /**
     * Score how strongly a success event is associated with a problem.
     *
     * Weights are simple and explainable so the decision can be
     * reviewed and tuned later.
     */
    private scoreResolution(
        problem: Problem,
        successEvent: DebugEvent,
        successSource: FailureSource,
        contextEvents: DebugEvent[]
    ): number {

        let score = 0;

        // Same origin (e.g. build success <-> build problem).
        if (problem.source === successSource) {
            score += 2;
        }

        // Same command is a strong signal.
        if (
            problem.command &&
            successEvent.command &&
            problem.command === successEvent.command
        ) {
            score += 2;
        }

        // The developer acted between the failure and the success.
        if (
            this.hasDeveloperEffortBetween(
                problem,
                successEvent,
                contextEvents
            )
        ) {
            score += 3;
        }

        // Close temporal proximity is weak evidence.
        const gap = successEvent.timestamp - problem.lastSeenAt;
        if (gap >= 0 && gap <= this.groupingWindowMs) {
            score += 1;
        }

        return score;
    }

    /**
     * Whether any developer action occurred strictly between a
     * problem's last observed failure and the given success event.
     */
    private hasDeveloperEffortBetween(
        problem: Problem,
        successEvent: DebugEvent,
        contextEvents: DebugEvent[]
    ): boolean {

        for (const event of contextEvents) {

            if (event.timestamp <= problem.lastSeenAt) {
                continue;
            }

            if (event.timestamp >= successEvent.timestamp) {
                continue;
            }

            if (DEVELOPER_ACTION_TYPES.indexOf(event.type) !== -1) {
                return true;
            }
        }

        return false;
    }

    /**
     * Map a success event to its failure source, or null when the
     * event is not a success event.
     */
    private static sourceForSuccessEvent(
        event: DebugEvent
    ): FailureSource | null {

        switch (event.type) {
            case "build_success":
                return "build";
            case "test_success":
                return "test";
            case "command_success":
                return "terminal";
            default:
                return null;
        }
    }

    /** All problems, in creation order. */
    getProblems(): Problem[] {
        return this.problems;
    }

    /** Only problems that are still open. */
    getOpenProblems(): Problem[] {
        return this.problems.filter(problem => !problem.resolved);
    }

    /** Only problems that have been resolved. */
    getResolvedProblems(): Problem[] {
        return this.problems.filter(problem => problem.resolved);
    }

    /** Problems originating from a particular source. */
    getProblemsBySource(source: FailureSource): Problem[] {
        return this.problems.filter(problem => problem.source === source);
    }

    /** Look up a single problem by id. */
    getProblem(problemId: string): Problem | null {
        return (
            this.problems.find(problem => problem.id === problemId) ??
            null
        );
    }

    /** Total number of logical problems observed. */
    getProblemCount(): number {
        return this.problems.length;
    }

    /** Number of problems that have been resolved. */
    getResolvedCount(): number {
        return this.getResolvedProblems().length;
    }

    /** Whether at least one problem has been resolved. */
    hasResolvedProblem(): boolean {
        return this.problems.some(problem => problem.resolved);
    }

    /** Clear all state, e.g. when a new session starts. */
    reset(): void {
        this.problems = [];
        this.problemCounter = 0;
    }

    // -----------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------

    private isProblemEvent(event: DebugEvent): boolean {
        return this.problemEventTypes.has(event.type);
    }

    private createProblem(
        event: DebugEvent,
        source: FailureSource
    ): Problem {

        this.problemCounter++;

        return {
            id: `problem-${this.problemCounter}`,
            source,
            firstSeenAt: event.timestamp,
            lastSeenAt: event.timestamp,
            events: [event],
            status: "open",
            resolved: false,
            message: event.message,
            file: event.file,
            command: event.command
        };
    }

    private attachEvent(problem: Problem, event: DebugEvent): void {

        problem.events.push(event);
        problem.lastSeenAt = event.timestamp;

        /*
         * Keep the most recent descriptive context available. This
         * gives later phases (JourneyAnalyzer / AI) a useful summary
         * without losing the full event history.
         */
        problem.message = event.message;

        if (event.file) {
            problem.file = event.file;
        }

        if (event.command) {
            problem.command = event.command;
        }
    }

    /**
     * Find the best matching open problem for an event.
     *
     * Only open problems with the same source are considered, and a
     * minimum similarity score must be reached.
     */
    private findBestMatch(
        event: DebugEvent,
        source: FailureSource
    ): Problem | null {

        let best: Problem | null = null;
        let bestScore = 0;

        for (const problem of this.problems) {

            if (problem.resolved) {
                continue;
            }

            if (problem.source !== source) {
                continue;
            }

            const score = this.scoreMatch(problem, event);

            if (score > bestScore) {
                bestScore = score;
                best = problem;
            }
        }

        if (best && bestScore >= this.matchThreshold) {
            return best;
        }

        return null;
    }

    /**
     * Deterministic similarity score between a problem and an event.
     *
     * Higher scores mean the event is more likely to belong to the
     * problem. The weights are intentionally simple and explainable.
     */
    private scoreMatch(problem: Problem, event: DebugEvent): number {

        let score = 0;

        // Same file is strong evidence.
        if (
            problem.file &&
            event.file &&
            problem.file === event.file
        ) {
            score += 2;
        }

        // Same command is strong evidence.
        if (
            problem.command &&
            event.command &&
            problem.command === event.command
        ) {
            score += 2;
        }

        // Similar / repeated error message.
        const similarity = ProblemManager.messageSimilarity(
            problem.message,
            event.message
        );
        score += similarity * 3;

        // Close temporal proximity is weak evidence.
        const gap = Math.abs(event.timestamp - problem.lastSeenAt);
        if (gap <= this.groupingWindowMs) {
            score += 1;
        }

        return score;
    }

    /**
     * Map an event to a failure source, preferring an explicit source
     * on the event and falling back to the event type.
     */
    private static sourceForEvent(event: DebugEvent): FailureSource {

        if (event.source) {
            return event.source;
        }

        switch (event.type) {
            case "diagnostic_error":
                return "code";
            case "terminal_error":
                return "terminal";
            case "build_failure":
                return "build";
            case "test_failure":
                return "test";
            case "workflow_change":
                return "workflow";
            case "environment_change":
                return "environment";
            default:
                return "unknown";
        }
    }

    /**
     * Normalise a message so that superficial differences (case,
     * numbers, punctuation, whitespace) do not prevent grouping.
     */
    private static normalizeMessage(message: string): string {
        return message
            .toLowerCase()
            .replace(/[0-9]+/g, "#")
            .replace(/['"`]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    private static tokenSet(message: string): Set<string> {
        return new Set(
            ProblemManager.normalizeMessage(message)
                .split(/[^a-z#]+/)
                .filter(token => token.length > 0)
        );
    }

    /**
     * Jaccard similarity between two messages, in the range [0, 1].
     */
    private static messageSimilarity(a: string, b: string): number {

        const setA = ProblemManager.tokenSet(a);
        const setB = ProblemManager.tokenSet(b);

        if (setA.size === 0 || setB.size === 0) {
            return 0;
        }

        let intersection = 0;
        for (const token of setA) {
            if (setB.has(token)) {
                intersection++;
            }
        }

        const union = setA.size + setB.size - intersection;

        return union === 0 ? 0 : intersection / union;
    }
}