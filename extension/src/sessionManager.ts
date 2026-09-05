import * as vscode from "vscode";
import { DebugEvent, DebugSession } from "./types";

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
            attempts: 0
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

        if (event.type === "error") {
            this.session.attempts++;
        }
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
