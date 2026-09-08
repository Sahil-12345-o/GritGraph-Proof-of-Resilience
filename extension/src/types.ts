export type DebugEventType =
    // Code-related events
    | "code_change"
    | "diagnostic_error"

    // Terminal / execution events
    | "terminal_command"
    | "terminal_error"
    | "command_success"

    // Build / testing events
    | "build_failure"
    | "build_success"
    | "test_failure"
    | "test_success"

    // Environment / workflow events
    | "workflow_change"
    | "environment_change"

    // Journey events
    | "attempt"
    | "strategy_change"
    | "success";


export type FailureSource =
    | "code"
    | "terminal"
    | "build"
    | "test"
    | "workflow"
    | "environment"
    | "unknown";


export interface DebugEvent {

    // When the event happened
    timestamp: number;

    // What happened
    type: DebugEventType;

    // Human-readable description
    message: string;

    // Where it happened, if known
    file?: string;

    // Terminal command, if applicable
    command?: string;

    // What kind of problem caused the event
    source?: FailureSource;

    // Optional identifier allowing us to
    // connect related events later
    problemId?: string;
}


export interface DebugSession {

    id: string;

    startedAt: number;

    endedAt?: number;

    // Complete chronological history
    events: DebugEvent[];

    // Number of meaningful debugging attempts
    attempts: number;

    // Number of distinct problems observed
    problems: number;

    // Whether at least one problem was successfully resolved
    resolved: boolean;
}