/**
 * Unit tests — GritScoreEngine
 *
 * gritScoreEngine.ts has zero VS Code dependencies — runs with plain mocha.
 *
 * Tests verify:
 *   - Zero-activity session → all zeros (except efficiency neutral)
 *   - Perfect clean resolution (no failures) → correct dimension scores
 *   - Struggle and resolution → Persistence earns full score
 *   - Two problems, one unresolved → Recovery = 50%
 *   - Confirmed strategy change → Adaptation earns points
 *   - Strategy change absorbs a failure → Efficiency not penalised
 *   - Unjustified failures → Efficiency penalised
 *   - Overall is the correct weighted average
 *   - Adaptation saturates at 100 after 4 confirmed changes
 */

import * as assert from "assert";
import { GritScoreEngine } from "../../gritScoreEngine";
import {
    WEIGHT_RECOVERY,
    WEIGHT_PERSISTENCE,
    WEIGHT_ADAPTATION,
    WEIGHT_EFFICIENCY
} from "../../gritScoreEngine";
import { JourneyAnalysis } from "../../journeyAnalyzer";
import { Problem } from "../../problemManager";
import { StrategyChange, Attempt } from "../../journeyAnalyzer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _ts = 3_000_000;
function ts(): number { return _ts += 1000; }

function makeProblem(id: string, resolved: boolean): Problem {
    const t = ts();
    return {
        id,
        source: "code",
        firstSeenAt: t,
        lastSeenAt: t,
        events: [],
        status: resolved ? "resolved" : "open",
        resolved,
        resolvedAt: resolved ? t + 1000 : undefined,
        message: `Problem ${id}`
    };
}

function makeAttempt(
    id: string,
    outcome: Attempt["outcome"],
    problemId: string
): Attempt {
    const t = ts();
    return {
        id,
        problemId,
        startedAt: t,
        endedAt: t + 500,
        events: [],
        actions: ["code_change"],
        files: [],
        outcome,
        strategyChanged: false
    };
}

function makeStrategyChange(
    id: string,
    confidence: StrategyChange["confidence"]
): StrategyChange {
    return {
        id,
        detectedAt: ts(),
        fromActions: ["code_change"],
        toActions: ["terminal_command"],
        reason: "test",
        confidence
    };
}

function emptyAnalysis(sessionId = "s1"): JourneyAnalysis {
    return {
        sessionId,
        problems: [],
        attempts: [],
        strategyChanges: [],
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        inconclusiveAttempts: 0,
        unresolvedProblems: []
    };
}

const engine = new GritScoreEngine();

// ---------------------------------------------------------------------------
// Zero-activity session
// ---------------------------------------------------------------------------

describe("GritScoreEngine — zero-activity session", () => {

    const score = engine.compute(emptyAnalysis());

    it("overall is 8 (due to neutral efficiency)", () => assert.strictEqual(score.overall, 8));
    it("persistence is 0", () => assert.strictEqual(score.dimensions.persistence.score, 0));
    it("adaptation is 0", () => assert.strictEqual(score.dimensions.adaptation.score, 0));
    it("recovery is 0", () => assert.strictEqual(score.dimensions.recovery.score, 0));
    it("efficiency is neutral (50) when no attempts", () => assert.strictEqual(score.dimensions.efficiency.score, 50));
});

// ---------------------------------------------------------------------------
// Perfect clean resolution — one problem, one successful attempt, no failures
// ---------------------------------------------------------------------------

describe("GritScoreEngine — clean resolution (no failures)", () => {

    const p = makeProblem("p1", true);
    const a = makeAttempt("a1", "successful", "p1");

    const analysis: JourneyAnalysis = {
        ...emptyAnalysis(),
        problems: [p],
        attempts: [a],
        totalAttempts: 1,
        successfulAttempts: 1,
        failedAttempts: 0,
        unresolvedProblems: []
    };

    const score = engine.compute(analysis);

    it("recovery is 100", () => assert.strictEqual(score.dimensions.recovery.score, 100));
    it("persistence is 0 (no failed attempt before success)", () =>
        assert.strictEqual(score.dimensions.persistence.score, 0));
    it("efficiency is 100 (success rate 100%, no penalty)", () =>
        assert.strictEqual(score.dimensions.efficiency.score, 100));
    it("adaptation is 0 (no strategy changes)", () =>
        assert.strictEqual(score.dimensions.adaptation.score, 0));
});

// ---------------------------------------------------------------------------
// Struggle and resolution — 1 failed + 1 successful attempt
// ---------------------------------------------------------------------------

describe("GritScoreEngine — struggle and resolution (1 failed, 1 successful)", () => {

    const p = makeProblem("p1", true);
    const fail = makeAttempt("a1", "failed", "p1");
    const success = makeAttempt("a2", "successful", "p1");

    const analysis: JourneyAnalysis = {
        ...emptyAnalysis(),
        problems: [p],
        attempts: [fail, success],
        totalAttempts: 2,
        successfulAttempts: 1,
        failedAttempts: 1,
        unresolvedProblems: []
    };

    const score = engine.compute(analysis);

    it("persistence is 100 (1/1 problem resolved after failing)", () =>
        assert.strictEqual(score.dimensions.persistence.score, 100));

    it("recovery is 100 (1/1 problem resolved)", () =>
        assert.strictEqual(score.dimensions.recovery.score, 100));

    it("efficiency base=50, unjustified=1, penalty=10 → score=40", () =>
        assert.strictEqual(score.dimensions.efficiency.score, 40));

    it("overall = round(100×0.35 + 100×0.30 + 0×0.20 + 40×0.15) = 71", () => {
        const expected = Math.round(
            100 * WEIGHT_RECOVERY +
            100 * WEIGHT_PERSISTENCE +
            0   * WEIGHT_ADAPTATION +
            40  * WEIGHT_EFFICIENCY
        );
        assert.strictEqual(score.overall, expected);
    });
});

// ---------------------------------------------------------------------------
// Two problems, one unresolved → Recovery = 50%
// ---------------------------------------------------------------------------

describe("GritScoreEngine — two problems, one unresolved", () => {

    const pA = makeProblem("pA", true);
    const pB = makeProblem("pB", false);
    const a1 = makeAttempt("a1", "successful", "pA");

    const analysis: JourneyAnalysis = {
        ...emptyAnalysis(),
        problems: [pA, pB],
        attempts: [a1],
        totalAttempts: 1,
        successfulAttempts: 1,
        failedAttempts: 0,
        unresolvedProblems: [pB]
    };

    const score = engine.compute(analysis);

    it("recovery is 50 (1 of 2 resolved)", () =>
        assert.strictEqual(score.dimensions.recovery.score, 50));

    it("persistence is 0 (no resolved problem had a failed attempt)", () =>
        assert.strictEqual(score.dimensions.persistence.score, 0));
});

// ---------------------------------------------------------------------------
// Adaptation — confirmed strategy change earns 25 points
// ---------------------------------------------------------------------------

describe("GritScoreEngine — adaptation", () => {

    it("one observed change → adaptation = 25", () => {
        const analysis: JourneyAnalysis = {
            ...emptyAnalysis(),
            strategyChanges: [makeStrategyChange("sc1", "observed")]
        };
        const score = engine.compute(analysis);
        assert.strictEqual(score.dimensions.adaptation.score, 25);
    });

    it("two observed changes → adaptation = 50", () => {
        const analysis: JourneyAnalysis = {
            ...emptyAnalysis(),
            strategyChanges: [
                makeStrategyChange("sc1", "observed"),
                makeStrategyChange("sc2", "observed")
            ]
        };
        assert.strictEqual(engine.compute(analysis).dimensions.adaptation.score, 50);
    });

    it("four observed changes → adaptation saturates at 100", () => {
        const analysis: JourneyAnalysis = {
            ...emptyAnalysis(),
            strategyChanges: [
                makeStrategyChange("sc1", "observed"),
                makeStrategyChange("sc2", "observed"),
                makeStrategyChange("sc3", "observed"),
                makeStrategyChange("sc4", "observed")
            ]
        };
        assert.strictEqual(engine.compute(analysis).dimensions.adaptation.score, 100);
    });

    it("one candidate change → adaptation = 10", () => {
        const analysis: JourneyAnalysis = {
            ...emptyAnalysis(),
            strategyChanges: [makeStrategyChange("sc1", "candidate")]
        };
        assert.strictEqual(engine.compute(analysis).dimensions.adaptation.score, 10);
    });
});

// ---------------------------------------------------------------------------
// Efficiency — strategy change absorbs failures
// ---------------------------------------------------------------------------

describe("GritScoreEngine — efficiency with strategy change", () => {

    it("one observed change + one failure → failure is justified, no penalty", () => {
        const p = makeProblem("p1", true);
        const fail = makeAttempt("a1", "failed", "p1");
        const success = makeAttempt("a2", "successful", "p1");

        const analysis: JourneyAnalysis = {
            ...emptyAnalysis(),
            problems: [p],
            attempts: [fail, success],
            strategyChanges: [makeStrategyChange("sc1", "observed")],
            totalAttempts: 2,
            successfulAttempts: 1,
            failedAttempts: 1,
            unresolvedProblems: []
        };
        // base = round(1/2*100) = 50, justified=1, unjustified=0, penalty=0 → 50
        const score = engine.compute(analysis);
        assert.strictEqual(score.dimensions.efficiency.score, 50);
    });

    it("two failures, zero strategy changes → penalty = 20", () => {
        const p = makeProblem("p1", true);
        const f1 = makeAttempt("a1", "failed", "p1");
        const f2 = makeAttempt("a2", "failed", "p1");
        const ok = makeAttempt("a3", "successful", "p1");

        const analysis: JourneyAnalysis = {
            ...emptyAnalysis(),
            problems: [p],
            attempts: [f1, f2, ok],
            totalAttempts: 3,
            successfulAttempts: 1,
            failedAttempts: 2,
            unresolvedProblems: []
        };
        // base=round(1/3*100)=33, justified=0, unjustified=2, penalty=20 → 13
        const score = engine.compute(analysis);
        assert.strictEqual(score.dimensions.efficiency.score, 13);
    });
});

// ---------------------------------------------------------------------------
// Overall weighted average
// ---------------------------------------------------------------------------

describe("GritScoreEngine — overall formula", () => {

    it("overall is the correct weighted average of the four dimensions", () => {
        const p = makeProblem("p1", true);
        const fail = makeAttempt("a1", "failed", "p1");
        const success = makeAttempt("a2", "successful", "p1");
        const sc = makeStrategyChange("sc1", "observed");

        const analysis: JourneyAnalysis = {
            ...emptyAnalysis(),
            problems: [p],
            attempts: [fail, success],
            strategyChanges: [sc],
            totalAttempts: 2,
            successfulAttempts: 1,
            failedAttempts: 1,
            unresolvedProblems: []
        };

        const score = engine.compute(analysis);
        const { persistence, adaptation, recovery, efficiency } = score.dimensions;

        const expected = Math.round(
            recovery.score    * WEIGHT_RECOVERY    +
            persistence.score * WEIGHT_PERSISTENCE +
            adaptation.score  * WEIGHT_ADAPTATION  +
            efficiency.score  * WEIGHT_EFFICIENCY
        );
        assert.strictEqual(score.overall, expected);
    });
});
