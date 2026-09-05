export type DebugEventType =
    | "error"
    | "file_change"
    | "success";

export interface DebugEvent {
    timestamp: number;
    type: DebugEventType;
    message: string;
    file?: string;
}

export interface DebugSession {
    id: string;
    startedAt: number;
    endedAt?: number;
    events: DebugEvent[];
    attempts: number;
}