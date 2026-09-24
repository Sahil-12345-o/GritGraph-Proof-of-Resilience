/**
 * Unit tests — ProblemManager
 *
 * problemManager.ts has zero VS Code dependencies — runs with plain mocha.
 *
 * Tests cover:
 *   - ingest(): problem creation and grouping
 *   - resolveProblem(): targeted single-problem resolution
 *   - resolveAll(): bulk resolution (intentional only)
 *   - resolveWithEvidence(): evidence-scored resolution safety
 *   - B1 fix: workflow_change / environment_change NOT creating problems
 *   - reset(): state cleanup
 */

import * as assert from "assert";
import { ProblemManager } from "../../problemManager";
import { DebugEvent } from "../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _ts = 1_000_000;
function nextTs(): number { return _ts += 1000; }

function makeEvent(
    overrides: Partial<DebugEvent> & Pick<DebugEvent, "type" | "message">
): DebugEvent {
    return {
        timestamp: nextTs(),
        source: undefined,
        ...overrides
    };
}

// ---------------------------------------------------------------------------
// ingest() — problem creation
// ---------------------------------------------------------------------------

describe("ProblemManager.ingest — problem creation", () => {

    it("creates a new problem for the first diagnostic_error", () => {
        const pm = new ProblemManager();
        const e = makeEvent({ type: "diagnostic_error", message: "Type error", file: "a.ts", source: "code" });
        const p = pm.ingest(e);
        assert.ok(p, "should return a problem");
        assert.strictEqual(pm.getProblemCount(), 1);
        assert.strictEqual(p!.source, "code");
        assert.strictEqual(p!.file, "a.ts");
    });

    it("attaches a similar error on the same file to the existing problem", () => {
        const pm = new ProblemManager();
        const e1 = makeEvent({ type: "diagnostic_error", message: "Type error: string", file: "a.ts", source: "code" });
        const e2 = makeEvent({ type: "diagnostic_error", message: "Type error: number", file: "a.ts", source: "code" });
        pm.ingest(e1);
        pm.ingest(e2);
        assert.strictEqual(pm.getProblemCount(), 1, "same-file errors should group");
    });

    it("creates a separate problem for a different source", () => {
        const pm = new ProblemManager();
        const e1 = makeEvent({ type: "diagnostic_error", message: "Type error", source: "code" });
        const e2 = makeEvent({ type: "build_failure", message: "Build failed", source: "build" });
        pm.ingest(e1);
        pm.ingest(e2);
        assert.strictEqual(pm.getProblemCount(), 2, "different sources should produce separate problems");
    });

    it("creates a separate problem for a different command", () => {
        const pm = new ProblemManager();
        const e1 = makeEvent({ type: "terminal_error", message: "Command failed", command: "npm run build", source: "terminal" });
        const e2 = makeEvent({ type: "terminal_error", message: "Different error", command: "npm run lint", source: "terminal" });
        pm.ingest(e1);
        pm.ingest(e2);
        assert.strictEqual(pm.getProblemCount(), 2, "different commands should produce separate problems");
    });

    // ---- B1 fix verification ----

    it("(B1 fix) workflow_change does NOT create a problem", () => {
        const pm = new ProblemManager();
        const e = makeEvent({ type: "workflow_change", message: "Switched from npm to pnpm" });
        const result = pm.ingest(e);
        assert.strictEqual(result, null, "workflow_change should be ignored by ingest");
        assert.strictEqual(pm.getProblemCount(), 0);
    });

    it("(B1 fix) environment_change does NOT create a problem", () => {
        const pm = new ProblemManager();
        const e = makeEvent({ type: "environment_change", message: "Updated .env" });
        const result = pm.ingest(e);
        assert.strictEqual(result, null, "environment_change should be ignored by ingest");
        assert.strictEqual(pm.getProblemCount(), 0);
    });

    it("non-problem events (code_change, command_success) are ignored", () => {
        const pm = new ProblemManager();
        pm.ingest(makeEvent({ type: "code_change", message: "Modified file" }));
        pm.ingest(makeEvent({ type: "command_success", message: "Done" }));
        assert.strictEqual(pm.getProblemCount(), 0);
    });
});

// ---------------------------------------------------------------------------
// resolveProblem() — targeted resolution
// ---------------------------------------------------------------------------

describe("ProblemManager.resolveProblem", () => {

    it("marks only the targeted problem as resolved", () => {
        const pm = new ProblemManager();
        pm.ingest(makeEvent({ type: "build_failure", message: "Build error A", command: "make", source: "build" }));
        pm.ingest(makeEvent({ type: "diagnostic_error", message: "Type error B", file: "b.ts", source: "code" }));
        assert.strictEqual(pm.getProblemCount(), 2);

        const [p1, p2] = pm.getProblems();
        pm.resolveProblem(p1.id);

        assert.ok(pm.getProblems()[0].resolved, "problem 1 should be resolved");
        assert.ok(!pm.getProblems()[1].resolved, "problem 2 should remain open");
        assert.strictEqual(pm.getOpenProblems().length, 1);
        assert.strictEqual(pm.getResolvedProblems().length, 1);
        assert.ok(pm.hasResolvedProblem());
        // Suppress unused variable warning
        void p2;
    });

    it("returns null for unknown id", () => {
        const pm = new ProblemManager();
        const result = pm.resolveProblem("nonexistent-id");
        assert.strictEqual(result, null);
    });

    it("is idempotent — resolving twice is safe", () => {
        const pm = new ProblemManager();
        pm.ingest(makeEvent({ type: "build_failure", message: "Fail", source: "build" }));
        const [p] = pm.getProblems();
        pm.resolveProblem(p.id);
        pm.resolveProblem(p.id);  // second call should not throw
        assert.ok(pm.getProblems()[0].resolved);
    });
});

// ---------------------------------------------------------------------------
// resolveAll()
// ---------------------------------------------------------------------------

describe("ProblemManager.resolveAll", () => {

    it("resolves all open problems", () => {
        const pm = new ProblemManager();
        pm.ingest(makeEvent({ type: "build_failure", message: "A", source: "build" }));
        pm.ingest(makeEvent({ type: "diagnostic_error", message: "B", file: "b.ts", source: "code" }));
        const resolved = pm.resolveAll();
        assert.strictEqual(resolved.length, 2);
        assert.strictEqual(pm.getOpenProblems().length, 0);
    });

    it("does not re-resolve already-resolved problems", () => {
        const pm = new ProblemManager();
        pm.ingest(makeEvent({ type: "build_failure", message: "A", source: "build" }));
        const [p] = pm.getProblems();
        pm.resolveProblem(p.id);
        const resolved = pm.resolveAll(); // second resolve attempt
        assert.strictEqual(resolved.length, 0, "nothing new should be resolved");
    });
});

// ---------------------------------------------------------------------------
// resolveWithEvidence() — resolution safety (core B5A invariant)
// ---------------------------------------------------------------------------

describe("ProblemManager.resolveWithEvidence — safety", () => {

    it("resolves the best-matching problem and leaves the other open", () => {
        const pm = new ProblemManager();
        const t0 = nextTs();
        const t1 = nextTs();

        // Problem 1: build source, same command
        const buildFail: DebugEvent = {
            timestamp: t0,
            type: "build_failure",
            message: "Build failed",
            command: "npm run build",
            source: "build"
        };
        // Problem 2: code source, different file
        const codeFail: DebugEvent = {
            timestamp: t0 + 100,
            type: "diagnostic_error",
            message: "Type error",
            file: "x.ts",
            source: "code"
        };
        pm.ingest(buildFail);
        pm.ingest(codeFail);

        // Developer effort between failure and success
        const effort: DebugEvent = {
            timestamp: t0 + 500,
            type: "code_change",
            message: "Fixed it",
            source: "code"
        };
        // Build success — strongly associated with problem 1
        const success: DebugEvent = {
            timestamp: t1,
            type: "build_success",
            message: "Build OK",
            command: "npm run build",
            source: "build"
        };

        const context: DebugEvent[] = [buildFail, codeFail, effort, success];
        const resolved = pm.resolveWithEvidence(success, context);

        assert.ok(resolved, "should resolve at least one problem");
        assert.strictEqual(resolved!.source, "build", "should resolve the build problem");
        assert.strictEqual(pm.getOpenProblems().length, 1, "code problem must remain open");
        assert.strictEqual(pm.getOpenProblems()[0].source, "code", "open problem should be the code problem");
    });

    it("does NOT resolve when evidence is insufficient (unrelated success)", () => {
        const pm = new ProblemManager();
        const t0 = nextTs();

        const codeFail: DebugEvent = {
            timestamp: t0,
            type: "diagnostic_error",
            message: "Undefined variable",
            file: "z.ts",
            source: "code"
        };
        pm.ingest(codeFail);

        // A build_success that has NO shared source, command, or developer effort
        const unrelatedSuccess: DebugEvent = {
            timestamp: t0 + 60 * 60 * 1000, // 1 hour later, outside grouping window
            type: "build_success",
            message: "Some other build",
            source: "build"
        };

        const resolved = pm.resolveWithEvidence(unrelatedSuccess, [codeFail, unrelatedSuccess]);
        assert.strictEqual(resolved, null, "should not resolve when evidence is weak");
        assert.strictEqual(pm.getOpenProblems().length, 1, "problem must remain open");
    });

    it("non-success events do not trigger resolution", () => {
        const pm = new ProblemManager();
        pm.ingest(makeEvent({ type: "build_failure", message: "Fail", source: "build" }));
        const codeChange = makeEvent({ type: "code_change", message: "Edit" });
        const resolved = pm.resolveWithEvidence(codeChange, [codeChange]);
        assert.strictEqual(resolved, null);
        assert.strictEqual(pm.getOpenProblems().length, 1);
    });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe("ProblemManager.reset", () => {

    it("clears all problems and resets the counter", () => {
        const pm = new ProblemManager();
        pm.ingest(makeEvent({ type: "build_failure", message: "Fail", source: "build" }));
        pm.ingest(makeEvent({ type: "diagnostic_error", message: "Error", file: "a.ts", source: "code" }));
        pm.reset();
        assert.strictEqual(pm.getProblemCount(), 0);
        assert.ok(!pm.hasResolvedProblem());

        // IDs restart from 1 after reset
        pm.ingest(makeEvent({ type: "build_failure", message: "Fail again", source: "build" }));
        assert.strictEqual(pm.getProblems()[0].id, "problem-1");
    });
});
