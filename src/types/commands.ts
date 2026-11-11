/**
 * GNU General Public License v3.0
 * Production-ready Structured Command Contract & Redaction Pipeline
 */

import { GEMINI_TOOLS } from "../brain/tools";

// ============================================================================
// System Command Contracts (Native Tool Schema for Gemini Function Calling)
// ============================================================================

export type SecurityLevel = "safe" | "destructive" | "requires_approval";

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
  | MemoryCompactionCommand;

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
    const cmd = (command.payload.command || "").trim();
    // Commands that modify system state, delete files, reboot or write require approval
    const destructivePatterns = [
      /\brm(\s+|$)/i,
      /\brmdir(\s+|$)/i,
      /\bmv(\s+|$)/i,
      /\btruncate(\s+|$)/i,
      /\bdd(\s+|$)/i,
      /\bkill(\s+|$)/i,
      /\bpkill(\s+|$)/i,
      /\bkillall(\s+|$)/i,
      /\bchmod(\s+|$)/i,
      /\bchown(\s+|$)/i,
      /\bsudo(\s+|$)/i,
      /\bdoas(\s+|$)/i,
      /\breboot(\s+|$)/i,
      /\bshutdown(\s+|$)/i,
      /\bpoweroff(\s+|$)/i,
      /\bmkfs(\s+|$)/i,
      /\bfdisk(\s+|$)/i,
      /\bparted(\s+|$)/i,
      /\bcurl\b.*\|.*\b(sh|bash|zsh)\b/i,
      /\bwget\b.*\|.*\b(sh|bash|zsh)\b/i,
      />{1,2}/, // Redirection writing or appending to files
      /\btee(\s+|$)/i,
      /\bsed\s+-[a-zA-Z]*i/i,
    ];
    if (destructivePatterns.some((pattern) => pattern.test(cmd))) {
      return true;
    }
    // Safe read-only inspection commands (find, ls, grep, cat, which, whereis, df, ps, etc.) run automatically
    return false;
  }
  if (
    command.type === "file_operation" &&
    (command.payload.action === "delete" || command.payload.action === "write")
  ) {
    return true;
  }
  return false;
}
