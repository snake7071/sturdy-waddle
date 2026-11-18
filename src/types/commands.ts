/**
 * GNU General Public License v3.0
 * Production-ready Structured Command Contract & Redaction Pipeline
 */

import { GEMINI_TOOLS } from "../brain/tools";
import { DrawOnScreenPayload } from "./annotations";

export * from "./annotations";

// ============================================================================
// System Command Contracts (Native Tool Schema for Gemini Function Calling)
// ============================================================================

export type SecurityLevel = "safe" | "destructive" | "requires_approval";

export type PermissionMode = "safe" | "ask" | "full";

export interface BaseCommand {
  id: string;
  timestamp: number;
}

export interface OpenUrlCommand extends BaseCommand {
  type: "open_url";
  securityLevel: "safe";
  payload: {
    url: string;
  };
}

export interface LaunchAppCommand extends BaseCommand {
  type: "launch_app";
  securityLevel: "safe";
  payload: {
    appName: string;
    args?: string[];
  };
}

export interface LaunchApplicationCommand extends BaseCommand {
  type: "launch_application";
  securityLevel: "safe";
  payload: {
    appName: string;
    args?: string[];
  };
}

export interface ExecuteShellCommand extends BaseCommand {
  type: "execute_shell";
  securityLevel: "destructive";
  payload: {
    command: string;
    cwd?: string;
    requiresElevated?: boolean;
    explanation: string;
  };
}

export interface FileOperationCommand extends BaseCommand {
  type: "file_operation";
  securityLevel: "safe" | "destructive";
  payload: {
    action: "read" | "write" | "delete" | "list";
    path: string;
    content?: string;
  };
}

export interface WindowPerchCommand extends BaseCommand {
  type: "window_perch";
  securityLevel: "safe";
  payload: {
    target: "active" | "hyprland_focused" | "taskbar";
    offsetY?: number;
    offsetX?: number;
  };
}

export interface CaptureScreenCommand extends BaseCommand {
  type: "capture_screen";
  securityLevel: "safe";
  payload: {
    reason: "explicit_user_request" | "husk_build_failure" | "context_inspection";
    downscaleQuality?: number; // 0.1 to 1.0
  };
}

export interface SetTimerCommand extends BaseCommand {
  type: "set_timer";
  securityLevel: "safe";
  payload: {
    durationSeconds: number;
    label: string;
  };
}

export interface MemoryCompactionCommand extends BaseCommand {
  type: "memory_compaction";
  securityLevel: "safe";
  payload: {
    retainedSummary: string;
    purgedTurnCount: number;
  };
}

export interface SaveMemoryCommand extends BaseCommand {
  type: "save_memory";
  securityLevel: "safe";
  payload: {
    category: "preference" | "fact" | "project" | "profile" | string;
    key: string;
    content: string;
    tags?: string[];
  };
}

export interface HideCompanionCommand extends BaseCommand {
  type: "hide_companion";
  securityLevel: "safe";
  payload?: {
    reason?: string;
  };
}

export interface DrawOnScreenCommand extends BaseCommand {
  type: "draw_on_screen";
  securityLevel: "safe";
  payload: DrawOnScreenPayload;
}

export interface ClearScreenAnnotationsCommand extends BaseCommand {
  type: "clear_screen_annotations";
  securityLevel: "safe";
}

export interface MouseClickCommand extends BaseCommand {
  type: "mouse_click";
  securityLevel: "destructive";
  payload: {
    x: number; // normalized 0-1000
    y: number; // normalized 0-1000
    button?: "left" | "right" | "middle";
    clickType?: "single" | "double";
  };
}

export interface MouseScrollCommand extends BaseCommand {
  type: "mouse_scroll";
  securityLevel: "destructive";
  payload: {
    x: number; // normalized 0-1000
    y: number; // normalized 0-1000
    direction?: "up" | "down";
    amount?: number;
  };
}

export interface TypeTextCommand extends BaseCommand {
  type: "type_text";
  securityLevel: "destructive";
  payload: {
    text: string;
    submit?: boolean;
  };
}

export interface PressHotkeyCommand extends BaseCommand {
  type: "press_hotkey";
  securityLevel: "destructive";
  payload: {
    keys: string[];
  };
}

export type CompanionCommand =
  | OpenUrlCommand
  | LaunchAppCommand
  | LaunchApplicationCommand
  | ExecuteShellCommand
  | FileOperationCommand
  | WindowPerchCommand
  | CaptureScreenCommand
  | SetTimerCommand
  | SaveMemoryCommand
  | HideCompanionCommand
  | MemoryCompactionCommand
  | DrawOnScreenCommand
  | ClearScreenAnnotationsCommand
  | MouseClickCommand
  | MouseScrollCommand
  | TypeTextCommand
  | PressHotkeyCommand;

// ============================================================================
// Tool Calling Schema Declaration for Google GenAI SDK
// ============================================================================

export const GEMINI_COMPANION_TOOL_DECLARATIONS = GEMINI_TOOLS;

// ============================================================================
// Command Dispatch Result & Approval
// ============================================================================

export interface CommandExecutionResult {
  commandId: string;
  success: boolean;
  output?: string;
  error?: string;
  requiresUserApproval?: boolean;
}

export function isDestructiveCommand(command: CompanionCommand): boolean {
  if (command.type === "execute_shell") {
    return true;
  }
  if (
    command.type === "mouse_click" ||
    command.type === "mouse_scroll" ||
    command.type === "type_text" ||
    command.type === "press_hotkey"
  ) {
    return true;
  }
  if (
    command.type === "file_operation" &&
    (command.payload.action === "delete" || command.payload.action === "write")
  ) {
    return true;
  }
  return false;
}
