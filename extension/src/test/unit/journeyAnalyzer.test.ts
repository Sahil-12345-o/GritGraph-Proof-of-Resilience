/**
 * Unit tests — JourneyAnalyzer
 *
 * journeyAnalyzer.ts has zero VS Code dependencies — runs with plain mocha.
 *
 * IMPORTANT: evaluateWindow() uses reference equality (Set<DebugEvent>)
 * to exclude problem events from the "relevant" window events. Tests must
 * therefore share object references between the Problem.events array and
 * the DebugSession.events array.
 *
 * Tests cover:
 *   - Spec Example A: diagnostic → code → diagnostic → code → build_success
 *   - Spec Example B: terminal_error → command → command_success
 *   - Spec Example C: test_failure → code → test_failure → code → test_success
 *   - Spec Example D: two independent problems stay separate
 *   - No-action window: observation only → no attempt created
 *   - Strategy change: detected when action category changes across attempts
 *   - No strategy change: same category across attempts
 */

import * as assert from "assert";
import { JourneyAnalyzer } from "../../journeyAnalyzer";
import { Problem } from "../../problemManager";
import { DebugEvent, DebugSession } from "../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _base = 2_000_000;
function T(offsetSeconds: number): number { return _base + offsetSeconds * 1000; }

function session(events: DebugEvent[], resolved = false): DebugSession {
    return {
        id: "test-session",
        startedAt: events[0]?.timestamp ?? T(0),
        endedAt: events[events.length - 1]?.timestamp ?? T(0),
        events,
        attempts: 0,
        problems: 1,
        resolved
    };
}

function problem(
    id: string,
    failureEvents: DebugEvent[],
    opts: Partial<Problem> = {}
): Problem {
    return {
        id,
        source: "code",
        firstSeenAt: failureEvents[0]?.timestamp ?? T(0),
        lastSeenAt: failureEvents[failureEvents.length - 1]?.timestamp ?? T(0),
        events: failureEvents,
        status: "open",
        resolved: false,
        message: failureEvents[0]?.message ?? "",
        ...opts
    };
}

// ---------------------------------------------------------------------------
// Spec Example A
// diagnostic_error → code_change → diagnostic_error → code_change → build_success
// Expected: 2 attempts — attempt-1 failed, attempt-2 successful
// ---------------------------------------------------------------------------

describe("JourneyAnalyzer — Example A (diagnostic → code → diagnostic → code → build_success)", () => {

    // Shared references (required for Set<DebugEvent> filtering)
    const err1:    DebugEvent = { timestamp: T(0),  type: "diagnostic_error", message: "Type error", file: "a.ts", source: "code" };
    const edit1:   DebugEvent = { timestamp: T(5),  type: "code_change",       message: "Edit",       file: "a.ts", source: "code" };
    const err2:    DebugEvent = { timestamp: T(10), type: "diagnostic_error", message: "Type error", file: "a.ts", source: "code" };
    const edit2:   DebugEvent = { timestamp: T(15), type: "code_change",       message: "Edit",       file: "a.ts", source: "code" };
    const success: DebugEvent = { timestamp: T(20), type: "build_success",     message: "Build OK",              source: "code" };

    const p = problem("p1", [err1, err2], {
        source: "code",
        resolved: true,
        resolvedAt: T(20),
        status: "resolved"
    });

    const s = session([err1, edit1, err2, edit2, success], true);

    let analysis: ReturnType<JourneyAnalyzer["analyze"]>;

    before(() => {
        analysis = new JourneyAnalyzer().analyze(s, [p]);
    });

    it("produces exactly 2 attempts", () => {
        assert.strictEqual(analysis.totalAttempts, 2);
    });

    it("attempt-1 outcome is failed", () => {
        assert.strictEqual(analysis.failedAttempts, 1);
        assert.strictEqual(analysis.attempts[0].outcome, "failed");
    });

    it("attempt-2 outcome is successful", () => {
        assert.strictEqual(analysis.successfulAttempts, 1);
        assert.strictEqual(analysis.attempts[1].outcome, "successful");
    });

    it("zero unresolved problems", () => {
        assert.strictEqual(analysis.unresolvedProblems.length, 0);
    });
});

// ---------------------------------------------------------------------------
// Spec Example B
// terminal_error → terminal_command → command_success
// Expected: 1 successful attempt
// ---------------------------------------------------------------------------

describe("JourneyAnalyzer — Example B (terminal_error → command → command_success)", () => {

    const fail: DebugEvent    = { timestamp: T(0),  type: "terminal_error",   message: "Failed",      command: "npm ci", source: "terminal" };
    const cmd: DebugEvent     = { timestamp: T(3),  type: "terminal_command",  message: "Ran: npm ci", command: "npm ci", source: "terminal" };
    const success: DebugEvent = { timestamp: T(6),  type: "command_success",   message: "Done",        command: "npm ci", source: "terminal" };

    const p = problem("p1", [fail], {
        source: "terminal",
        resolved: true,
        resolvedAt: T(6),
        status: "resolved"
    });

    const s = session([fail, cmd, success], true);

    let analysis: ReturnType<JourneyAnalyzer["analyze"]>;

    before(() => {
        analysis = new JourneyAnalyzer().analyze(s, [p]);
    });

    it("produces exactly 1 attempt", () => {
        assert.strictEqual(analysis.totalAttempts, 1);
    });

    it("the single attempt is successful", () => {
        assert.strictEqual(analysis.successfulAttempts, 1);
        assert.strictEqual(analysis.attempts[0].outcome, "successful");
    });

    it("zero failed attempts", () => {
        assert.strictEqual(analysis.failedAttempts, 0);
    });
});

// ---------------------------------------------------------------------------
// Spec Example C
// test_failure → code_change → test_failure → code_change → test_success
// with different files on the second attempt → strategy candidate
// ---------------------------------------------------------------------------

describe("JourneyAnalyzer — Example C (test_fail → code → test_fail → code → test_success)", () => {

    const fail1:   DebugEvent = { timestamp: T(0),  type: "test_failure",  message: "Test failed", source: "test" };
    const edit1:   DebugEvent = { timestamp: T(5),  type: "code_change",   message: "Edit",        file: "a.ts", source: "code" };
    const fail2:   DebugEvent = { timestamp: T(10), type: "test_failure",  message: "Test failed", source: "test" };
    const edit2:   DebugEvent = { timestamp: T(15), type: "code_change",   message: "Edit",        file: "b.ts", source: "code" }; // different file
    const success: DebugEvent = { timestamp: T(20), type: "test_success",  message: "Tests passed", source: "test" };

    const p = problem("p1", [fail1, fail2], {
        source: "test",
        resolved: true,
        resolvedAt: T(20),
        status: "resolved"
    });

    const s = session([fail1, edit1, fail2, edit2, success], true);

    let analysis: ReturnType<JourneyAnalyzer["analyze"]>;

    before(() => {
        analysis = new JourneyAnalyzer().analyze(s, [p]);
    });

    it("produces 2 attempts", () => {
        assert.strictEqual(analysis.totalAttempts, 2);
    });

    it("attempt-1 failed, attempt-2 successful", () => {
        assert.strictEqual(analysis.attempts[0].outcome, "failed");
        assert.strictEqual(analysis.attempts[1].outcome, "successful");
    });

    it("detects at least one strategy-change signal (different files)", () => {
        assert.ok(analysis.strategyChanges.length >= 1, "expected a strategy change signal");
    });
});

// ---------------------------------------------------------------------------
// Spec Example D
// Two independent problems — must remain separate
// ---------------------------------------------------------------------------

describe("JourneyAnalyzer — Example D (two independent problems)", () => {

    // Problem A: diagnostic → code → build_success  → RESOLVED
    const errA:     DebugEvent = { timestamp: T(0),  type: "diagnostic_error", message: "Err A", file: "a.ts", source: "code" };
    const editA:    DebugEvent = { timestamp: T(5),  type: "code_change",       message: "Fix A", file: "a.ts", source: "code" };
    const buildOk:  DebugEvent = { timestamp: T(10), type: "build_success",     message: "OK",                  source: "code" };

    // Problem B: test_failure → code → test_failure  → UNRESOLVED
    const testFail1: DebugEvent = { timestamp: T(15), type: "test_failure",    message: "Fail B", source: "test" };
    const editB:     DebugEvent = { timestamp: T(20), type: "code_change",      message: "Try B",  file: "b.ts", source: "code" };
    const testFail2: DebugEvent = { timestamp: T(25), type: "test_failure",    message: "Fail B", source: "test" };

    const pA = problem("pA", [errA], {
        source: "code",
        resolved: true,
        resolvedAt: T(10),
        status: "resolved"
    });

    const pB = problem("pB", [testFail1, testFail2], {
        source: "test",
        resolved: false,
        status: "open"
    });

    const s = session([errA, editA, buildOk, testFail1, editB, testFail2]);

    let analysis: ReturnType<JourneyAnalyzer["analyze"]>;

    before(() => {
        analysis = new JourneyAnalyzer().analyze(s, [pA, pB]);
    });

    it("finds 2 problems total", () => {
        assert.strictEqual(analysis.problems.length, 2);
    });

    it("problem A is resolved, problem B is unresolved", () => {
        assert.strictEqual(analysis.unresolvedProblems.length, 1);
        assert.strictEqual(analysis.unresolvedProblems[0].id, "pB");
    });

    it("produces at least 1 successful attempt (for problem A)", () => {
        assert.ok(analysis.successfulAttempts >= 1);
    });
});

// ---------------------------------------------------------------------------
// No-action window — observation only produces zero attempts
// ---------------------------------------------------------------------------

describe("JourneyAnalyzer — no-action window", () => {

    it("an observed failure with no subsequent action produces 0 attempts", () => {
        const fail: DebugEvent = { timestamp: T(0), type: "diagnostic_error", message: "Fail", source: "code" };
        const p = problem("p1", [fail], { source: "code" });
        const s = session([fail]);
        const analysis = new JourneyAnalyzer().analyze(s, [p]);
        assert.strictEqual(analysis.totalAttempts, 0);
    });

    it("no problems → no attempts", () => {
        const s: DebugSession = {
            id: "empty", startedAt: T(0), endedAt: T(10),
            events: [], attempts: 0, problems: 0, resolved: false
        };
        const analysis = new JourneyAnalyzer().analyze(s, []);
        assert.strictEqual(analysis.totalAttempts, 0);
        assert.strictEqual(analysis.unresolvedProblems.length, 0);
    });
});

// ---------------------------------------------------------------------------
// Strategy change detection
// ---------------------------------------------------------------------------

describe("JourneyAnalyzer — strategy change detection", () => {

    it("detects 'observed' strategy change when action category changes", () => {
        // Attempt 1: code_change; Attempt 2: terminal_command
        const fail1: DebugEvent = { timestamp: T(0),  type: "build_failure",    message: "Fail", source: "code" };
        const edit:  DebugEvent = { timestamp: T(5),  type: "code_change",       message: "Edit", source: "code" };
        const fail2: DebugEvent = { timestamp: T(10), type: "build_failure",    message: "Fail", source: "code" };
        const cmd:   DebugEvent = { timestamp: T(15), type: "terminal_command",  message: "Ran",  source: "terminal" };
        const ok:    DebugEvent = { timestamp: T(20), type: "build_success",     message: "OK",   source: "code" };

        const p = problem("p1", [fail1, fail2], {
            source: "code",
            resolved: true,
            resolvedAt: T(20),
            status: "resolved"
        });
        const s = session([fail1, edit, fail2, cmd, ok], true);
        const analysis = new JourneyAnalyzer().analyze(s, [p]);

        const observed = analysis.strategyChanges.filter(sc => sc.confidence === "observed");
        assert.ok(observed.length >= 1, "should detect at least one observed strategy change");
        assert.ok(analysis.attempts[1].strategyChanged, "second attempt should be flagged");
    });

    it("no strategy change when action categories are identical", () => {
        const fail1: DebugEvent = { timestamp: T(0),  type: "diagnostic_error", message: "Fail", source: "code" };
        const edit1: DebugEvent = { timestamp: T(5),  type: "code_change",    message: "Edit", file: "a.ts", source: "code" };
        const fail2: DebugEvent = { timestamp: T(10), type: "diagnostic_error", message: "Fail", source: "code" };
        const edit2: DebugEvent = { timestamp: T(15), type: "code_change",    message: "Edit", file: "a.ts", source: "code" };
        const ok:    DebugEvent = { timestamp: T(20), type: "success",  message: "OK",   source: "code" };

        const p = problem("p1", [fail1, fail2], {
            source: "code",
            resolved: true,
            resolvedAt: T(20),
            status: "resolved"
        });
        const s = session([fail1, edit1, fail2, edit2, ok], true);
        const analysis = new JourneyAnalyzer().analyze(s, [p]);

        const observed = analysis.strategyChanges.filter(sc => sc.confidence === "observed");
        assert.strictEqual(observed.length, 0, "no observed strategy change expected");
    });
});
