import * as vscode from "vscode";
import {
    DebugEvent,
    DebugSession
} from "./types";

export class SessionManager {

    private session: DebugSession | null = null;

    start(): void {

        if (this.session) {
            vscode.window.showWarningMessage(
                "A GritGraph session is already running."
            );
            return;
        }

        this.session = {
            id: `session-${Date.now()}`,
            startedAt: Date.now(),
            events: [],
            attempts: 0,
            problems: 0,
            resolved: false
        };

        vscode.window.showInformationMessage(
            "🟢 GritGraph debugging session started!"
        );
    }

    addEvent(event: DebugEvent): void {

        if (!this.session) {
            return;
        }

        this.session.events.push(event);

        // A new failure represents a newly observed problem.
        if (
            event.type === "diagnostic_error" ||
            event.type === "terminal_error" ||
            event.type === "build_failure" ||
            event.type === "test_failure"
        ) {
            this.session.problems++;
        }
    }

    recordAttempt(): void {

        if (!this.session) {
            return;
        }

        this.session.attempts++;

        this.session.events.push({
            timestamp: Date.now(),
            type: "attempt",
            message: `Debugging attempt #${this.session.attempts}`
        });

        console.log(
            `[GritGraph] Debugging attempt #${this.session.attempts}`
        );
    }

    recordSuccess(): void {

        if (!this.session) {
            return;
        }

        if (this.session.resolved) {
            return;
        }

        this.session.resolved = true;

        this.session.events.push({
            timestamp: Date.now(),
            type: "success",
            message: "Problem resolved"
        });

        console.log(
            "[GritGraph] Problem resolved successfully!"
        );

        vscode.window.showInformationMessage(
            "✅ GritGraph: Problem resolved successfully!"
        );
    }

    isResolved(): boolean {

        return this.session?.resolved ?? false;
    }

    end(): DebugSession | null {

        if (!this.session) {
            vscode.window.showWarningMessage(
                "No active GritGraph session."
            );

            return null;
        }

        this.session.endedAt = Date.now();

        const completedSession = this.session;

        this.session = null;

        return completedSession;
    }

    isActive(): boolean {
        return this.session !== null;
    }

    getCurrentSession(): DebugSession | null {
        return this.session;
    }
}