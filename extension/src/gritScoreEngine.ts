import { JourneyAnalysis } from "./journeyAnalyzer";

export interface GritScoreDimension {
    score: number;
    evidence: string;
}

export interface GritScore {
    overall: number;
    dimensions: {
        persistence: GritScoreDimension;
        adaptation:  GritScoreDimension;
        recovery:    GritScoreDimension;
        efficiency:  GritScoreDimension;
    };
    sessionId: string;
    computedAt: number;
    explanation: string;
}

export const WEIGHT_RECOVERY    = 0.35;
export const WEIGHT_PERSISTENCE = 0.30;
export const WEIGHT_ADAPTATION  = 0.20;
export const WEIGHT_EFFICIENCY  = 0.15;

/**
 * GritScoreEngine
 *
 * Computes a four-dimension Grit Score from a JourneyAnalysis.
 *
 * Design principles:
 *   - Deterministic: same input produces the same output.
 *   - Explainable: every score has an evidence string.
 *   - Language/framework agnostic: only uses normalised journey data.
 *   - Gaming-resistant: more errors do NOT raise the score.
 *   - Independent: no dependency on VS Code or the event trackers.
 *
 * Dimension weights:
 *   Recovery    35%  - resolved problems
 *   Persistence 30%  - kept trying despite failures on the way to success
 *   Adaptation  20%  - changed approach when stuck
 *   Efficiency  15%  - resolved without blind repetition
 */
export class GritScoreEngine {

    /**
     * Compute the Grit Score from a reconstructed debugging journey.
     * This method is pure: same JourneyAnalysis always yields the same GritScore.
     */
    compute(analysis: JourneyAnalysis): GritScore {

        const persistence = this.scorePersistence(analysis);
        const adaptation  = this.scoreAdaptation(analysis);
        const recovery    = this.scoreRecovery(analysis);
        const efficiency  = this.scoreEfficiency(analysis);

        const overall = Math.round(
            recovery.score    * WEIGHT_RECOVERY    +
            persistence.score * WEIGHT_PERSISTENCE +
            adaptation.score  * WEIGHT_ADAPTATION  +
            efficiency.score  * WEIGHT_EFFICIENCY
        );

        return {
            overall,
            dimensions: { persistence, adaptation, recovery, efficiency },
            sessionId:  analysis.sessionId,
            computedAt: Date.now(),
            explanation: this.buildExplanation(
                overall, analysis, persistence, adaptation, recovery, efficiency
            )
        };
    }

    // ---------------------------------------------------------------
    // Persistence (0-100)
    // ---------------------------------------------------------------

    /**
     * "Kept trying despite failures on the way to success."
     *
     * Score = (problems resolved after >= 1 failed attempt) /
     *         (total logical problems observed) x 100
     *
     * Gaming resistance: adding unresolved problems does NOT raise
     * this score. Only successfully resolved struggle earns points.
     */
    private scorePersistence(
        analysis: JourneyAnalysis
    ): GritScoreDimension {

        const totalProblems = analysis.problems.length;

        if (totalProblems === 0) {
            return {
                score: 0,
                evidence: "No logical problems were observed."
            };
        }

        /*
         * A problem "required perseverance" when it was resolved AND
         * had at least one failed attempt recorded against it.
         */
        const resolvedAfterFailing = analysis.problems.filter(p => {
            if (!p.resolved) { return false; }
            return analysis.attempts.some(
                a => a.problemId === p.id && a.outcome === "failed"
            );
        }).length;

        const score = Math.round(
            (resolvedAfterFailing / totalProblems) * 100
        );

        let evidence: string;
        if (resolvedAfterFailing === 0) {
            evidence = analysis.successfulAttempts > 0
                ? "Problems resolved without recorded failed attempts - clean execution."
                : "No problems resolved after struggle.";
        } else {
            evidence =
                String(resolvedAfterFailing) + " of " + String(totalProblems) +
                " problem(s) required perseverance to resolve.";
        }

        return { score, evidence };
    }

    // ---------------------------------------------------------------
    // Adaptation (0-100)
    // ---------------------------------------------------------------

    /**
     * "Changed approach when something was not working."
     *
     * Score = min(observedShifts x 25 + candidateShifts x 10, 100)
     *
     * "Observed" means the action category changed between attempts
     * (strong evidence). "Candidate" means only the files changed.
     * Saturates at 100 after 4 confirmed direction changes.
     *
     * Gaming resistance: strategy changes are only detected by
     * JourneyAnalyzer from genuinely different action categories.
     */
    private scoreAdaptation(
        analysis: JourneyAnalysis
    ): GritScoreDimension {

        const observed = analysis.strategyChanges
            .filter(sc => sc.confidence === "observed").length;

        const candidate = analysis.strategyChanges
            .filter(sc => sc.confidence === "candidate").length;

        const score = Math.min(observed * 25 + candidate * 10, 100);

        let evidence: string;
        if (observed === 0 && candidate === 0) {
            evidence = "No approach changes detected.";
        } else {
            evidence =
                String(observed) + " confirmed approach change(s)" +
                (candidate > 0
                    ? ", " + String(candidate) + " candidate signal(s)"
                    : "") +
                " detected.";
        }

        return { score, evidence };
    }

    // ---------------------------------------------------------------
    // Recovery (0-100)
    // ---------------------------------------------------------------

    /**
     * "Successfully resolved problems."
     *
     * Score = (resolved problems / total problems) x 100
     *
     * Gaming resistance: unresolved problems hurt this score.
     */
    private scoreRecovery(
        analysis: JourneyAnalysis
    ): GritScoreDimension {

        const totalProblems    = analysis.problems.length;
        const resolvedProblems = totalProblems -
            analysis.unresolvedProblems.length;

        if (totalProblems === 0) {
            return {
                score: 0,
                evidence: "No logical problems were observed."
            };
        }

        const score = Math.round(
            (resolvedProblems / totalProblems) * 100
        );

        const evidence =
            "Resolved " + String(resolvedProblems) + " of " +
            String(totalProblems) + " logical problem(s).";

        return { score, evidence };
    }

    // ---------------------------------------------------------------
    // Efficiency (0-100)
    // ---------------------------------------------------------------

    /**
     * "Resolved without blind repetition."
     *
     * baseScore        = (successful / total) x 100
     * justifiedFails   = min(observedStrategyChanges, failedAttempts)
     * unjustifiedFails = max(0, failed - justifiedFails)
     * penalty          = min(unjustifiedFails x 10, 40)
     * score            = max(0, baseScore - penalty)
     *
     * Each confirmed strategy change "justifies" one failed attempt.
     * Failures beyond that reduce the score. Max penalty: 40 pts.
     * If no attempts are recorded, returns neutral (50).
     *
     * Gaming resistance: more unexplained failures -> lower efficiency.
     */
    private scoreEfficiency(
        analysis: JourneyAnalysis
    ): GritScoreDimension {

        const total      = analysis.totalAttempts;
        const successful = analysis.successfulAttempts;
        const failed     = analysis.failedAttempts;

        if (total === 0) {
            return {
                score: 50,
                evidence: "No attempts recorded - score is neutral."
            };
        }

        const observedChanges = analysis.strategyChanges
            .filter(sc => sc.confidence === "observed").length;

        const baseScore        = Math.round((successful / total) * 100);
        const justifiedFails   = Math.min(observedChanges, failed);
        const unjustifiedFails = Math.max(0, failed - justifiedFails);
        const penalty          = Math.min(unjustifiedFails * 10, 40);
        const score            = Math.max(0, baseScore - penalty);

        let evidence: string;
        if (unjustifiedFails > 0) {
            evidence =
                String(successful) + " successful, " + String(failed) +
                " failed attempt(s) (" + String(unjustifiedFails) +
                " without an approach change).";
        } else {
            evidence =
                String(successful) + " successful, " +
                String(failed) + " failed attempt(s).";
        }

        return { score, evidence };
    }

    // ---------------------------------------------------------------
    // Top-level explanation
    // ---------------------------------------------------------------

    private buildExplanation(
        overall: number,
        analysis: JourneyAnalysis,
        persistence: GritScoreDimension,
        adaptation:  GritScoreDimension,
        recovery:    GritScoreDimension,
        efficiency:  GritScoreDimension
    ): string {

        let level: string;
        if (overall >= 80)      { level = "Outstanding resilience"; }
        else if (overall >= 60) { level = "Strong resilience"; }
        else if (overall >= 40) { level = "Moderate resilience"; }
        else if (overall >= 20) { level = "Some resilience signals"; }
        else                    { level = "Limited resilience signals"; }

        const parts: string[] = [
            level + " (" + String(overall) + "/100).",
            recovery.evidence,
            persistence.evidence
        ];

        if (analysis.strategyChanges.length > 0) {
            parts.push(adaptation.evidence);
        }

        parts.push(efficiency.evidence);

        return parts.join(" ");
    }
}
