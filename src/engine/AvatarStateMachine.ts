/**
 * GNU General Public License v3.0
 * Avatar State Machine (Finite State Machine with Event Transitions & Perching Engine)
 */

export type AvatarState =
  | "idle"
  | "talking"
  | "working"
  | "error"
  | "needs_approval"
  | "glitch"
  | "perched"
  | "dragging";

export interface StateContext {
  speechBubbleText?: string;
  perchedTarget?: string; // window title or "taskbar"
  isDragging?: boolean;
  huskTask?: string;
  huskSource?: string;
  glitchRemark?: string;
  lastStateBeforeInterruption?: AvatarState;
}

export type StateListener = (state: AvatarState, context: StateContext) => void;

export class AvatarStateMachine {
  private currentState: AvatarState;
  private context: StateContext = {};
  private listeners: StateListener[] = [];
  private speechTimeout: any = null;
  private errorTimeout: any = null;
  private glitchTimeout: any = null;

  constructor(initialState: AvatarState = "idle") {
    this.currentState = initialState;
  }

  public getState(): AvatarState {
    return this.currentState;
  }

  public getContext(): StateContext {
    return { ...this.context };
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.push(listener);
    listener(this.currentState, this.context);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentState, this.context);
    }
  }

  private getRestingState(): AvatarState {
    return this.context.perchedTarget ? "perched" : "idle";
  }

  private clearAllTimeouts(): void {
    if (this.speechTimeout) {
      clearTimeout(this.speechTimeout);
      this.speechTimeout = null;
    }
    if (this.errorTimeout) {
      clearTimeout(this.errorTimeout);
      this.errorTimeout = null;
    }
    if (this.glitchTimeout) {
      clearTimeout(this.glitchTimeout);
      this.glitchTimeout = null;
    }
  }

  /**
   * Main transition trigger
   */
  public transition(newState: AvatarState, contextPatch?: Partial<StateContext>): void {
    if (this.currentState !== newState) {
      if (this.currentState !== "glitch" && this.currentState !== "needs_approval") {
        this.context.lastStateBeforeInterruption = this.currentState;
      }
      this.currentState = newState;
    }

    if (contextPatch) {
      this.context = { ...this.context, ...contextPatch };
    }

    this.notify();
  }

  /**
   * Sets initial speech bubble text (e.g. restored from previous session)
   */
  public setInitialSpeech(text: string): void {
    this.context.speechBubbleText = text;
    this.notify();
  }

  /**
   * Explicitly clears the speech bubble text
   */
  public clearSpeech(): void {
    this.context.speechBubbleText = undefined;
    this.notify();
  }

  /**
   * Explicit speech bubble display with auto-revert to idle (or perched)
   * Keeps speechBubbleText persistent until replaced or explicitly dismissed.
   */
  public triggerSpeech(text: string, durationMs: number = 4000): void {
    this.clearAllTimeouts();

    this.transition("talking", {
      speechBubbleText: text,
    });

    // Revert avatar sprite from "talking" back to resting state (idle/perched) after duration,
    // but keep speechBubbleText persistent so the user can read the message without rushing!
    this.speechTimeout = setTimeout(() => {
      this.transition(this.getRestingState());
    }, durationMs);
  }

  /**
   * Window perching transition
   */
  public setPerched(targetTitle: string): void {
    this.clearAllTimeouts();
    this.transition("perched", {
      perchedTarget: targetTitle,
      speechBubbleText: `Сижу на окне: ${targetTitle}`,
    });

    this.speechTimeout = setTimeout(() => {
      this.transition("perched");
    }, 2500);
  }

  /**
   * Drag state management
   */
  public setDragging(isDragging: boolean): void {
    this.context.isDragging = isDragging;
    if (isDragging) {
      this.clearAllTimeouts();
      this.transition("idle");
    }
    this.notify();
  }

  /**
   * Differentiated Error handling: transient notification with auto-dismiss
   */
  public triggerError(message: string, durationMs: number = 4000): void {
    this.clearAllTimeouts();

    this.transition("error", {
      speechBubbleText: message,
    });

    this.errorTimeout = setTimeout(() => {
      if (this.currentState === "error") {
        this.context.speechBubbleText = undefined;
        this.transition(this.getRestingState());
      }
    }, durationMs);
  }

  /**
   * Triggers persistent approval state. Does NOT auto-dismiss.
   */
  public triggerNeedsApproval(message: string): void {
    this.clearAllTimeouts();

    this.transition("needs_approval", {
      speechBubbleText: message,
    });
  }

  /**
   * Compaction with Glitch Reaction:
   * When conversation history approaches token thresholds, triggers background
   * summarization and visually expresses memory compaction with a glitch animation
   * and playful remark ("Уплотняю память... 🧠").
   */
  public triggerMemoryCompaction(retainedTokensCount?: number): void {
    this.clearAllTimeouts();

    const remark = "Уплотняю память... 🧠";
    console.info(`[AvatarStateMachine] Memory compaction glitch triggered. Tokens retained: ${retainedTokensCount ?? "summarized"}`);

    this.transition("glitch", {
      glitchRemark: remark,
      speechBubbleText: remark,
    });

    this.glitchTimeout = setTimeout(() => {
      this.context.glitchRemark = undefined;
      this.context.speechBubbleText = undefined;
      this.transition(this.getRestingState());
    }, 2000);
  }

  /**
   * Husk Mode: Developer/Terminal status events.
   * Differentiates distinct "error" (auto-dismissing 4s) vs "needs_approval" (persistent).
   */
  public handleHuskEvent(event: {
    state: "busy" | "error" | "needs_approval" | "done" | "idle";
    action?: string;
    message?: string;
  }): void {
    switch (event.state) {
      case "busy":
        this.transition("working", {
          huskTask: event.message || event.action || "Compiling code...",
          speechBubbleText: event.message || "Working...",
        });
        break;

      case "error":
        this.triggerError(event.message || "Husk reported a failure!", 4000);
        break;

      case "needs_approval":
        this.triggerNeedsApproval(event.message || `Approval needed: ${event.action || "execute"}`);
        break;

      case "done":
        this.transition("idle", {
          speechBubbleText: event.message || "Task finished!",
          huskTask: undefined,
        });
        break;

      case "idle":
      default:
        this.transition("idle", {
          speechBubbleText: undefined,
          huskTask: undefined,
        });
        break;
    }
  }
}
