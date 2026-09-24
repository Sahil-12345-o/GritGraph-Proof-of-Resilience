/**
 * Command classification.
 *
 * This module classifies a terminal command into a coarse *category*
 * so that GritGraph knows which kind of normalized evidence to emit
 * (build / test / plain terminal).
 *
 * IMPORTANT:
 * Classification NEVER determines success. Success and failure are
 * always derived from the actual execution outcome (exit code), not
 * from the command name.
 *
 * The pattern lists are exported so that future adapters can extend
 * support for more tools without changing the tracker.
 */

/**
 * Coarse category of an executed command.
 */
export type CommandCategory = "build" | "test" | "terminal";

/**
 * Patterns that suggest a *test* command.
 *
 * These are intentionally narrow and anchored to the start of a
 * command segment to avoid false positives (for example an `echo`
 * that merely mentions "test").
 */
export const TEST_COMMAND_PATTERNS: RegExp[] = [
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i,
    /^(?:npx\s+)?(?:jest|vitest|mocha|ava|tap|jasmine|karma)\b/i,
    /^pytest\b/i,
    /^python[0-9.]*\s+-m\s+(?:pytest|unittest)\b/i,
    /^py\.test\b/i,
    /^cargo\s+test\b/i,
    /^go\s+test\b/i,
    /^mvn\b.*\btest\b/i,
    /^(?:\.\/)?gradlew?\b.*\btest\b/i,
    /^dotnet\s+test\b/i,
    /^phpunit\b/i,
    /^rspec\b/i,
    /^bundle\s+exec\s+rspec\b/i,
    /^make\s+test\b/i
];

/**
 * Patterns that suggest a *build* command.
 */
export const BUILD_COMMAND_PATTERNS: RegExp[] = [
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|compile)\b/i,
    /^cargo\s+(?:build|check)\b/i,
    /^go\s+(?:build|install)\b/i,
    /^mvn\b.*\b(?:package|install|compile)\b/i,
    /^(?:\.\/)?gradlew?\b.*\b(?:build|assemble)\b/i,
    /^dotnet\s+build\b/i,
    /^msbuild\b/i,
    /^make\b/i,
    /^cmake\b/i,
    /^(?:gcc|g\+\+|clang|clang\+\+)\b/i,
    /^tsc\b/i,
    /^(?:webpack|rollup|esbuild|swc)\b/i,
    /^vite\s+build\b/i,
    /^next\s+build\b/i
];

/**
 * Split a (possibly compound) command into simpler segments.
 *
 * Compound commands such as `cd app && npm run build` are split on the
 * common shell operators so that the meaningful invocation can be
 * classified.
 */
function splitIntoSegments(command: string): string[] {
    return command
        .split(/\s*(?:&&|\|\||[;|&])\s*/)
        .map(segment => segment.trim())
        .filter(segment => segment.length > 0);
}

/**
 * Remove common wrappers and leading environment assignments from a
 * segment so the real executable can be inspected.
 */
function normalizeSegment(segment: string): string {

    let result = segment.trim();

    // Strip common command wrappers first.
    result = result.replace(
        /^(?:sudo|command|env|nohup|time|cross-env)\s+/i,
        ""
    );

    // Strip leading environment assignments: FOO=bar BAZ=qux cmd
    result = result.replace(
        /^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+)+/,
        ""
    );

    return result.trim();
}

function matchesAny(segment: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(segment));
}

/**
 * Classify a command line into a coarse category.
 *
 * Iterates over the command segments in order and returns the first
 * category that matches. Defaults to "terminal".
 */
export function classifyCommand(command: string): CommandCategory {

    if (!command) {
        return "terminal";
    }

    const segments = splitIntoSegments(command);

    for (const segment of segments) {

        const normalized = normalizeSegment(segment);

        if (!normalized) {
            continue;
        }

        if (matchesAny(normalized, TEST_COMMAND_PATTERNS)) {
            return "test";
        }

        if (matchesAny(normalized, BUILD_COMMAND_PATTERNS)) {
            return "build";
        }
    }

    return "terminal";
}