/**
 * Unit tests — Sanitizer
 *
 * sanitizer.ts has zero VS Code dependencies — runs with plain mocha.
 */

import * as assert from "assert";
import { sanitizeCommand, truncateCommand, MAX_COMMAND_LENGTH } from "../../sanitizer";

describe("sanitizeCommand — Bearer / Authorization tokens", () => {
    it("redacts Bearer token in Authorization header", () => {
        const out = sanitizeCommand("curl -H 'Authorization: Bearer abc123xyz'");
        assert.ok(!out.includes("abc123xyz"), `Token leaked: ${out}`);
        assert.ok(out.includes("[REDACTED]"), `No redaction marker: ${out}`);
    });

    it("redacts bare bearer token", () => {
        const out = sanitizeCommand("curl -H 'Bearer sk-supersecret'");
        assert.ok(!out.includes("sk-supersecret"), `Token leaked: ${out}`);
    });
});

describe("sanitizeCommand — key=value sensitive assignments", () => {
    it("redacts API_KEY=value", () => {
        const out = sanitizeCommand("API_KEY=abc123 npm run deploy");
        assert.ok(!out.includes("abc123"), `Key leaked: ${out}`);
        assert.ok(out.includes("[REDACTED]"), `No redaction marker: ${out}`);
    });

    it("redacts password=secret", () => {
        const out = sanitizeCommand("docker login -u user --password mysecretpass");
        // -p flag handled by CLI flag rule
        assert.ok(!out.includes("mysecretpass"), `Password leaked: ${out}`);
    });

    it("redacts TOKEN=value", () => {
        const out = sanitizeCommand("TOKEN=ghp_xxx123 some-command");
        assert.ok(!out.includes("ghp_xxx123"), `Token leaked: ${out}`);
    });

    it("redacts SECRET_KEY=value", () => {
        const out = sanitizeCommand("SECRET_KEY=my-very-secret node app.js");
        assert.ok(!out.includes("my-very-secret"), `Secret leaked: ${out}`);
    });
});

describe("sanitizeCommand — CLI flags", () => {
    it("redacts --token flag value", () => {
        const out = sanitizeCommand("gh auth login --token ghp_abc123456789");
        assert.ok(!out.includes("ghp_abc123456789"), `Token leaked: ${out}`);
    });

    it("redacts --password flag value", () => {
        const out = sanitizeCommand("mysql --password=topsecret -u root");
        assert.ok(!out.includes("topsecret"), `Password leaked: ${out}`);
    });

    it("redacts --api-key flag value", () => {
        const out = sanitizeCommand("mycli --api-key s3cr3tkey");
        assert.ok(!out.includes("s3cr3tkey"), `Key leaked: ${out}`);
    });
});

describe("sanitizeCommand — URL credentials", () => {
    it("redacts password in https://user:pass@host", () => {
        const out = sanitizeCommand("git clone https://alice:hunter2@github.com/org/repo.git");
        assert.ok(!out.includes("hunter2"), `Password leaked: ${out}`);
        assert.ok(out.includes("[REDACTED]"), `No redaction marker: ${out}`);
    });
});

describe("sanitizeCommand — well-known token shapes", () => {
    it("redacts GitHub personal access token (ghp_)", () => {
        const out = sanitizeCommand("git push https://ghp_AAABBBCCCDDDEEEFFFGGG12@github.com/org/repo");
        assert.ok(!out.includes("ghp_AAABBBCCCDDDEEEFFFGGG12"), `PAT leaked: ${out}`);
    });

    it("redacts OpenAI key shape (sk-)", () => {
        const out = sanitizeCommand("openai api completions --api-key sk-ABCDEFGHIJKLMNOPQRSTUV");
        assert.ok(!out.includes("sk-ABCDEFGHIJKLMNOPQRSTUV"), `Key leaked: ${out}`);
    });
});

describe("sanitizeCommand — safe passthrough", () => {
    it("leaves a normal build command unchanged", () => {
        const out = sanitizeCommand("npm run build");
        assert.strictEqual(out, "npm run build");
    });

    it("leaves git status unchanged", () => {
        const out = sanitizeCommand("git status");
        assert.strictEqual(out, "git status");
    });

    it("leaves cargo test unchanged", () => {
        const out = sanitizeCommand("cargo test --release");
        assert.strictEqual(out, "cargo test --release");
    });

    it("returns empty string for empty input", () => {
        assert.strictEqual(sanitizeCommand(""), "");
    });
});

describe("truncateCommand", () => {
    it("leaves short commands unchanged", () => {
        const cmd = "npm run build";
        assert.strictEqual(truncateCommand(cmd), cmd);
    });

    it("truncates commands over MAX_COMMAND_LENGTH", () => {
        const long = "a".repeat(MAX_COMMAND_LENGTH + 50);
        const result = truncateCommand(long);
        assert.ok(
            result.length <= MAX_COMMAND_LENGTH + 20,
            "result should be near the limit"
        );
        assert.ok(result.endsWith("…[truncated]"), "should end with truncation marker");
    });

    it("respects a custom maxLength parameter", () => {
        const result = truncateCommand("abcdefghij", 5);
        assert.ok(result.startsWith("abcde"), "should keep first 5 chars");
        assert.ok(result.includes("…[truncated]"));
    });
});
