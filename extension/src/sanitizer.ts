/**
 * Secret sanitization for recorded terminal commands.
 *
 * PRIVACY IS CRITICAL:
 * GritGraph must never intentionally store raw secrets. This module
 * performs a *conservative best-effort* redaction of obvious sensitive
 * values before any command is recorded as an event.
 *
 * This is deliberately NOT a perfect secret detector. It is a small,
 * modular building block so it can be strengthened later without
 * touching the terminal tracker.
 *
 * It only sanitizes short command lines. GritGraph never records full
 * terminal output.
 */

/**
 * A single sanitization rule.
 *
 * `replacement` uses the standard `String.replace` `$n` group syntax.
 */
export interface SanitizationRule {
    pattern: RegExp;
    replacement: string;
}

/**
 * Default redaction rules.
 *
 * Order matters: more specific patterns run before broader ones.
 */
export const DEFAULT_SANITIZATION_RULES: SanitizationRule[] = [

    // ----- Authorization headers -----------------------------------
    // Authorization: Bearer abc123  ->  Authorization: [REDACTED]
    // Works for `key: value`, `key=value`, quoted or unquoted.
    {
        pattern:
            /\b(authorization\s*[:=]\s*)["']?(?:bearer\s+)?[^\s"']+/gi,
        replacement: "$1[REDACTED]"
    },

    // ----- Bearer tokens anywhere ----------------------------------
    {
        pattern: /\bbearer\s+[A-Za-z0-9._~+\/=-]+/gi,
        replacement: "Bearer [REDACTED]"
    },

    // ----- Sensitive KEY=VALUE / KEY: VALUE assignments ------------
    // Covers API keys, tokens, secrets, passwords, private keys and
    // well-known cloud credential environment variables.
    {
        pattern:
            /\b([A-Za-z0-9_]*(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|id[_-]?token|client[_-]?secret|refresh[_-]?token|token|secret|password|passwd|passphrase|private[_-]?key)[A-Za-z0-9_]*)(\s*[:=]\s*)["']?[^\s"']+["']?/gi,
        replacement: "$1$2[REDACTED]"
    },

    // ----- Sensitive CLI flags -------------------------------------
    // --token abc  ->  --token [REDACTED]
    {
        pattern:
            /(--(?:token|password|passwd|passphrase|secret|api-?key|apikey|client-secret|access-key|secret-key|auth-token)(?:=|\s+))["']?[^\s"']+["']?/gi,
        replacement: "$1[REDACTED]"
    },

    // ----- Credentials embedded in URLs ----------------------------
    // https://user:password@host  ->  https://user:[REDACTED]@host
    {
        pattern:
            /(\b[a-z][a-z0-9+.\-]*:\/\/[^\/\s@:]+:)[^\/\s@]+(@)/gi,
        replacement: "$1[REDACTED]$2"
    },

    // ----- Private key blocks --------------------------------------
    {
        pattern:
            /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        replacement: "[REDACTED PRIVATE KEY]"
    },

    // ----- Well-known token shapes ---------------------------------
    // GitHub, OpenAI-style, Slack, AWS access key ids.
    {
        pattern:
            /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
        replacement: "[REDACTED]"
    }
];

/**
 * Maximum length of a recorded command. Long commands are truncated so
 * that GritGraph never stores unbounded input.
 */
export const MAX_COMMAND_LENGTH = 500;

/**
 * Shorten a command to a safe, bounded length.
 */
export function truncateCommand(
    input: string,
    maxLength: number = MAX_COMMAND_LENGTH
): string {

    if (input.length <= maxLength) {
        return input;
    }

    return input.slice(0, maxLength) + " …[truncated]";
}

/**
 * Sanitize a raw command line for storage.
 *
 * @param input the raw command line
 * @param rules optional custom rules (defaults to the built-in rules)
 */
export function sanitizeCommand(
    input: string,
    rules: SanitizationRule[] = DEFAULT_SANITIZATION_RULES
): string {

    if (!input) {
        return "";
    }

    let result = input;

    for (const rule of rules) {
        result = result.replace(rule.pattern, rule.replacement);
    }

    result = result.replace(/\s+/g, " ").trim();

    return truncateCommand(result);
}