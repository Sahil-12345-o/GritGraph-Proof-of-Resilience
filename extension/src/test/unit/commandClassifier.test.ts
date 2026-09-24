/**
 * Unit tests — CommandClassifier
 *
 * commandClassifier.ts has zero VS Code dependencies, so these tests
 * run directly with mocha / plain Node, no VS Code host required.
 */

import * as assert from "assert";
import {
    classifyCommand,
    CommandCategory
} from "../../commandClassifier";

// Helper — assert a command maps to the expected category
function expectCategory(
    cmd: string,
    expected: CommandCategory,
    label?: string
): void {
    const actual = classifyCommand(cmd);
    assert.strictEqual(
        actual,
        expected,
        `${label ?? cmd}: expected "${expected}" but got "${actual}"`
    );
}

// Build commands
describe("classifyCommand — build", () => {
    it("npm run build", () => expectCategory("npm run build", "build"));
    it("npm run compile", () => expectCategory("npm run compile", "build"));
    it("pnpm run build", () => expectCategory("pnpm run build", "build"));
    it("yarn build", () => expectCategory("yarn build", "build"));
    it("cargo build", () => expectCategory("cargo build", "build"));
    it("cargo check", () => expectCategory("cargo check", "build"));
    it("go build ./...", () => expectCategory("go build ./...", "build"));
    it("go install ./...", () => expectCategory("go install ./...", "build"));
    it("dotnet build", () => expectCategory("dotnet build", "build"));
    it("tsc", () => expectCategory("tsc", "build"));
    it("tsc --noEmit", () => expectCategory("tsc --noEmit", "build"));
    it("gcc main.c -o main", () => expectCategory("gcc main.c -o main", "build"));
    it("make", () => expectCategory("make", "build"));
    it("vite build", () => expectCategory("vite build", "build"));
    it("next build", () => expectCategory("next build", "build"));
    it("mvn package", () => expectCategory("mvn package", "build"));
});

// Test commands
describe("classifyCommand — test", () => {
    it("npm test", () => expectCategory("npm test", "test"));
    it("npm run test", () => expectCategory("npm run test", "test"));
    it("pnpm test", () => expectCategory("pnpm test", "test"));
    it("npx jest", () => expectCategory("npx jest", "test"));
    it("jest", () => expectCategory("jest", "test"));
    it("vitest", () => expectCategory("vitest", "test"));
    it("pytest", () => expectCategory("pytest", "test"));
    it("pytest -v tests/", () => expectCategory("pytest -v tests/", "test"));
    it("cargo test", () => expectCategory("cargo test", "test"));
    it("go test ./...", () => expectCategory("go test ./...", "test"));
    it("dotnet test", () => expectCategory("dotnet test", "test"));
    it("python -m pytest", () => expectCategory("python -m pytest", "test"));
    it("python3 -m unittest", () => expectCategory("python3 -m unittest", "test"));
    it("mvn test", () => expectCategory("mvn test", "test"));
});

// Terminal (fallthrough)
describe("classifyCommand — terminal", () => {
    it("git status", () => expectCategory("git status", "terminal"));
    it("ls -la", () => expectCategory("ls -la", "terminal"));
    it("echo hello", () => expectCategory("echo hello", "terminal"));
    it("node index.js", () => expectCategory("node index.js", "terminal"));
    it("pip install requests", () => expectCategory("pip install requests", "terminal"));
    it("docker ps", () => expectCategory("docker ps", "terminal"));
    it("empty string", () => expectCategory("", "terminal"));
});

// Compound commands
describe("classifyCommand — compound commands", () => {
    it("cd app && npm run build", () => expectCategory("cd app && npm run build", "build"));
    it("cd app && npm run test", () => expectCategory("cd app && npm run test", "test"));
    it("git pull && cargo build", () => expectCategory("git pull && cargo build", "build"));
    it("npm test || npm run build: test wins (first match)", () => expectCategory("npm test || npm run build", "test"));
});

// Wrappers and env prefix stripping
describe("classifyCommand — wrapper and prefix stripping", () => {
    it("sudo cargo build", () => expectCategory("sudo cargo build", "build"));
    it("sudo npm test", () => expectCategory("sudo npm test", "test"));
    it("cross-env NODE_ENV=test jest", () => expectCategory("cross-env NODE_ENV=test jest", "test"));
    it("FOO=bar go test ./...", () => expectCategory("FOO=bar go test ./...", "test"));
    it("NODE_ENV=prod npm run build", () => expectCategory("NODE_ENV=prod npm run build", "build"));
    it("time cargo build", () => expectCategory("time cargo build", "build"));
});
