import * as vscode from "vscode";
import { SessionManager } from "./sessionManager";
import {
    CommandCategory,
    classifyCommand
} from "./commandClassifier";
import { sanitizeCommand } from "./sanitizer";

/**
 * Book-keeping for a shell execution that has started but not ended.
 */
interface PendingExecution {
    command: string;
    startedAt: number;
}

/**
 * TerminalTracker
 *
 * Captures normalized execution evidence from the integrated terminal:
 *
 *     terminal_command
 *     command_success / terminal_error
 *     build_success  / build_failure
 *     test_success   / test_failure
 *
 * HOW THIS WORKS (and its limits):
 *
 * VS Code's classic terminal API does not expose executed commands or
 * exit codes. It DOES expose them through *shell integration*
 * (`onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`).
 * Shell integration is implemented by the shell itself and works across
 * PowerShell, CMD, Bash, Zsh, Git Bash and WSL, so this is the most
 * reliable cross-shell mechanism available.
 *
 * LIMITATIONS (documented honestly):
 *
 *   - Shell integration must be active for the terminal. When it is
 *     not, no execution events fire and raw commands cannot be observed
 *     through this API. We do NOT fabricate commands in that case.
 *   - `exitCode` may be `undefined` (subshell, user cancelled with
 *     Ctrl+C, shell misbehaving). In that case we record the command
 *     but deliberately DO NOT emit an outcome, because the outcome is
 *     unknown. We never guess success/failure.
 *   - Only the sanitized command line is stored, never raw output.
 */
export class TerminalTracker {

    private readonly pending =
        new Map<vscode.TerminalShellExecution, PendingExecution>();

    private readonly informedTerminals = new WeakSet<vscode.Terminal>();

    constructor(
        private sessionManager: SessionManager
    ) {}

    start(context: vscode.ExtensionContext): void {

        const shellIntegrationUnavailable =
            vscode.window.onDidOpenTerminal(terminal => {
                this.checkShellIntegration(terminal);
            });

        const executionStarted =
            vscode.window.onDidStartTerminalShellExecution(event => {
                this.handleExecutionStart(event);
            });

        const executionEnded =
            vscode.window.onDidEndTerminalShellExecution(event => {
                this.handleExecutionEnd(event);
            });

        const terminalClosed =
            vscode.window.onDidCloseTerminal(() => {
                // Pending executions belong to closed terminals.
                // Drop any entries that are no longer reachable.
                this.pruneOrphanedExecutions();
            });

        context.subscriptions.push(
            shellIntegrationUnavailable,
            executionStarted,
            executionEnded,
            terminalClosed
        );

        // Existing terminals may already have shell integration.
        for (const terminal of vscode.window.terminals) {
            this.checkShellIntegration(terminal);
        }
    }

    /**
     * Warn (once per terminal) when shell integration is unavailable,
     * so the developer understands why commands may not be captured.
     */
    private checkShellIntegration(terminal: vscode.Terminal): void {

        if (terminal.shellIntegration) {
            return;
        }

        if (this.informedTerminals.has(terminal)) {
            return;
        }

        this.informedTerminals.add(terminal);

        console.log(
            `[GritGraph] Shell integration is not active for terminal ` +
            `"${terminal.name}". Terminal command tracking is disabled ` +
            `for it until shell integration becomes available.`
        );
    }

    private handleExecutionStart(
        event: vscode.TerminalShellExecutionStartEvent
    ): void {

        if (!this.sessionManager.isActive()) {
            return;
        }

        const rawCommand = event.execution.commandLine.value;

        if (!rawCommand) {
            return;
        }

        const command = sanitizeCommand(rawCommand);

        this.pending.set(event.execution, {
            command,
            startedAt: Date.now()
        });

        /*
         * Record the raw action immediately so long-running commands
         * are still captured even if they never report an end.
         */
        this.sessionManager.addEvent({
            timestamp: Date.now(),
            type: "terminal_command",
            message: `Ran: ${command}`,
            command,
            source: "terminal"
        });
    }

    private handleExecutionEnd(
        event: vscode.TerminalShellExecutionEndEvent
    ): void {

        const execution = event.execution;

        const pending = this.pending.get(execution);

        this.pending.delete(execution);

        if (!this.sessionManager.isActive()) {
            return;
        }

        /*
         * Prefer the end-event command line, which may be more
         * accurate than the start-event value.
         */
        const rawCommand =
            execution.commandLine.value ||
            pending?.command ||
            "";

        if (!rawCommand) {
            return;
        }

        const command = sanitizeCommand(rawCommand);

        const exitCode = event.exitCode;

        /*
         * Without a reliable exit code we keep the raw action we
         * already recorded and emit no outcome. Guessing here would
         * create misleading evidence.
         */
        if (exitCode === undefined) {
            console.log(
                `[GritGraph] Command outcome unknown (no exit code): ` +
                `${command}`
            );
            return;
        }

        const category = classifyCommand(command);
        const success = exitCode === 0;

        this.emitOutcome(category, success, command, exitCode);
    }

    private emitOutcome(
        category: CommandCategory,
        success: boolean,
        command: string,
        exitCode: number
    ): void {

        const timestamp = Date.now();

        const message = success
            ? `Command exited with code 0`
            : `Command exited with code ${exitCode}`;

        switch (category) {

            case "build":
                this.sessionManager.addEvent({
                    timestamp,
                    type: success
                        ? "build_success"
                        : "build_failure",
                    message,
                    command,
                    exitCode,
                    source: "build"
                });
                break;

            case "test":
                this.sessionManager.addEvent({
                    timestamp,
                    type: success
                        ? "test_success"
                        : "test_failure",
                    message,
                    command,
                    exitCode,
                    source: "test"
                });
                break;

            default:
                this.sessionManager.addEvent({
                    timestamp,
                    type: success
                        ? "command_success"
                        : "terminal_error",
                    message,
                    command,
                    exitCode,
                    source: "terminal"
                });
                break;
        }

        console.log(
            `[GritGraph] Terminal outcome (${category}): ` +
            `${success ? "success" : "failure"} ` +
            `(${command}) [exit ${exitCode}]`
        );
    }

    /**
     * Drop book-keeping entries whose executions can no longer be
     * resolved (e.g. the terminal was closed mid-command).
     */
    private pruneOrphanedExecutions(): void {
        this.pending.clear();
    }
}