/**
 * GNU General Public License v3.0
 * Mascot Window Component (Transparent, Frameless Desktop Overlay)
 */

import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AvatarStateMachine, AvatarState, StateContext } from "../engine/AvatarStateMachine";
import { MascotSpriteRenderer } from "../engine/MascotSpriteRenderer";
import { UnifiedBrain } from "../brain";
import { CompanionCommand, isDestructiveCommand } from "../types/commands";

export const MascotWindow: React.FC = () => {
  const [fsm] = useState(() => new AvatarStateMachine("idle"));
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [context, setContext] = useState<StateContext>({});
  const [inputText, setInputText] = useState("");
  const [isInputOpen, setIsInputOpen] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{
    command: CompanionCommand;
    resolve: (res: { success: boolean; output: string }) => void;
  } | null>(null);

  const brainRef = useRef<UnifiedBrain | null>(null);

  useEffect(() => {
    // 1. Initialize Unified Brain (supports both Gemini & DeepSeek dynamically)
    brainRef.current = new UnifiedBrain(
      {},
      (_summary) => {
        fsm.triggerMemoryCompaction();
      }
    );

    // Fetch system context for personalized prompt
    invoke<any>("get_system_context")
      .then((ctx) => {
        if (ctx?.profile && brainRef.current) {
          brainRef.current.setSystemProfile(ctx.profile);
        }
      })
      .catch((err) => console.warn("[MascotWindow] Could not load system context:", err));

    // 2. Subscribe to FSM state updates
    const unsubscribe = fsm.subscribe((state, ctx) => {
      setAvatarState(state);
      setContext({ ...ctx });
    });

    // 3. Listen to Husk Mode local IPC socket events from Rust
    const unlistenPromise = listen<{
      state: "busy" | "error" | "needs_approval" | "done" | "idle";
      action?: string;
      message?: string;
      source?: string;
    }>("husk-event", (event) => {
      console.log("[MascotWindow] Received husk-event:", event.payload);
      fsm.handleHuskEvent(event.payload);
    });

    // 4. Global keydown listener: F12 opens DevTools
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F12") {
        e.preventDefault();
        invoke("open_devtools").catch((err) => console.error("Failed to open devtools:", err));
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unsubscribe();
      unlistenPromise.then((unlisten) => unlisten());
      window.removeEventListener("keydown", handleKeyDown);
      brainRef.current?.destroy();
    };
  }, [fsm]);

  // Window drag handler
  const handleMouseDown = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("textarea") ||
      target.closest(".no-drag")
    ) {
      return;
    }

    if (
      e.button === 0 &&
      (target.tagName === "CANVAS" ||
        target.tagName === "IMG" ||
        target.dataset.tauriDragRegion !== undefined ||
        target.closest("[data-tauri-drag-region]"))
    ) {
      fsm.setDragging(true);
      try {
        const appWindow = getCurrentWindow();
        await appWindow.startDragging();
      } catch (err) {
        console.warn("Drag error:", err);
      } finally {
        fsm.setDragging(false);
      }
    }
  };

  // Submit prompt to Gemini Brain with real-time token streaming & 3-step tool calling
  const handleSendPrompt = async () => {
    if (!inputText.trim()) return;
    const prompt = inputText.trim();
    setInputText("");
    setIsInputOpen(false);

    fsm.transition("working", { speechBubbleText: "Размышляю... 💭" });

    try {
      if (!brainRef.current) throw new Error("Brain not initialized");

      let hasSwitchedToTalking = false;

      const result = await brainRef.current.sendPrompt(
        prompt,
        undefined,
        (accumulatedText) => {
          if (!hasSwitchedToTalking) {
            hasSwitchedToTalking = true;
          }
          fsm.transition("talking", { speechBubbleText: accumulatedText });
        },
        async (command: CompanionCommand) => {
          return await handleCommandDispatch(command);
        },
        (_thoughtText) => {
          // Model is actively reasoning in Thinking Mode
          if (!hasSwitchedToTalking) {
            fsm.transition("working", { speechBubbleText: "Хмм, дай подумать... 🤔" });
          }
        }
      );

      // Handle final speech bubble display
      if (result.responseText) {
        fsm.triggerSpeech(result.responseText, 4500);
      } else {
        fsm.triggerSpeech("Готово! ✨", 3000);
      }
    } catch (err: any) {
      let warning = err?.message || "Google AI servers are overloaded. Please try again in a few seconds.";
      if (warning.includes("{") && warning.includes("}")) {
        try {
          const match = warning.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.error?.message) {
              warning = parsed.error.message;
            }
          }
        } catch {
          // ignore parse errors
        }
      }
      warning = warning.replace(/^Error:\s*/i, "").replace(/\{.*?\}|\[.*?\]/g, "").trim();
      if (!warning) warning = "Google AI servers are overloaded. Please try again in a few seconds.";

      console.warn("[MascotWindow] Handled prompt error:", warning);
      fsm.triggerError(warning, 4000);
    } finally {
      if (fsm.getState() === "working") {
        fsm.transition("idle");
      }
    }
  };

  // Command sandboxing & approval dispatcher
  const handleCommandDispatch = async (
    command: CompanionCommand
  ): Promise<{ success: boolean; output: string }> => {
    if (isDestructiveCommand(command)) {
      return new Promise<{ success: boolean; output: string }>((resolve) => {
        setPendingApproval({ command, resolve });
        fsm.triggerNeedsApproval("Действие требует подтверждения!");
      });
    }

    const taskDescription =
      command.type === "launch_app"
        ? `Запускаю ${command.payload.appName || "программу"}... 🚀`
        : command.type === "open_url"
        ? "Открываю ссылку... 🌐"
        : command.type === "execute_shell"
        ? "Выполняю команду... ⚙️"
        : "Выполняю задачу... ⚙️";
    fsm.transition("working", { speechBubbleText: taskDescription });

    return await executeCommand(command);
  };

  const executeCommand = async (
    command: CompanionCommand
  ): Promise<{ success: boolean; output: string }> => {
    try {
      if (command.type === "open_url") {
        await invoke("open_url", { url: command.payload.url });
        return { success: true, output: `Successfully opened ${command.payload.url}` };
      } else if (command.type === "launch_app" || command.type === "launch_application") {
        const targetApp =
          command.payload.appName ||
          (command.payload as any).app_name ||
          (command.payload as any).name ||
          (command.payload as any).application ||
          "";
        if (!targetApp.trim()) {
          fsm.triggerError("Не указано имя программы для запуска.", 3500);
          return { success: false, output: "Error: Missing appName parameter" };
        }
        await invoke("launch_app", {
          appName: targetApp.trim(),
          args: command.payload.args || [],
        });
        return { success: true, output: `Successfully launched ${targetApp.trim()}` };
      } else if (command.type === "window_perch") {
        const geom: any = await invoke("get_active_window");
        fsm.setPerched(geom.title);
        return { success: true, output: `Perched on window: ${geom.title}` };
      } else if (command.type === "capture_screen") {
        const res: any = await invoke("capture_screen_snapshot", {
          reason: command.payload.reason,
        });
        return {
          success: res.success,
          output: res.success ? "Screenshot captured" : res.error || "Capture failed",
        };
      } else if (command.type === "set_timer") {
        setTimeout(() => {
          fsm.triggerSpeech(`⏰ Напоминание: ${command.payload.label}`, 6000);
        }, command.payload.durationSeconds * 1000);
        return { success: true, output: `Timer set for ${command.payload.durationSeconds}s` };
      } else if (command.type === "execute_shell") {
        const res: any = await invoke("execute_sandboxed_shell", {
          command: command.payload.command,
          cwd: command.payload.cwd,
        });
        return {
          success: res.success,
          output: res.stdout || res.stderr || "Command executed",
        };
      }
      return { success: false, output: `Unknown command type: ${command.type}` };
    } catch (e: any) {
      console.error("Execution failed:", e);
      const errMsg = e?.message || String(e);
      fsm.triggerError(`Не удалось выполнить: ${errMsg}`, 3500);
      return { success: false, output: `Execution failed: ${errMsg}` };
    }
  };

  // Handle Drag-and-Drop file ingestion
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      fsm.triggerSpeech(`Ingested file: ${file.name}`, 3000);

      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = async () => {
          const b64 = reader.result as string;
          if (brainRef.current) {
            fsm.transition("working", { speechBubbleText: "Analyzing image..." });
            try {
              let switched = false;
              const res = await brainRef.current.sendPrompt(
                "Look at this dropped image and comment.",
                b64,
                (accumulatedText) => {
                  if (!switched) {
                    switched = true;
                  }
                  fsm.transition("talking", { speechBubbleText: accumulatedText });
                },
                async (cmd) => await handleCommandDispatch(cmd),
                () => {
                  if (!switched) {
                    fsm.transition("working", { speechBubbleText: "Анализирую изображение... 🤔" });
                  }
                }
              );
              if (res.responseText) fsm.triggerSpeech(res.responseText, 4500);
            } catch (err: any) {
              const cleanMsg = (err?.message || "Failed analyzing image.").replace(/^Error:\s*/i, "");
              fsm.triggerError(cleanMsg, 4000);
            } finally {
              if (fsm.getState() === "working") {
                fsm.transition("idle");
              }
            }
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  return (
    <div
      className="w-full h-full relative select-none flex flex-col items-center justify-end pb-3 bg-transparent overflow-hidden"
      onMouseDown={handleMouseDown}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onContextMenu={(e) => {
        e.preventDefault();
        invoke("open_devtools").catch((err) => console.error("Failed to open devtools:", err));
      }}
    >
      {/* Speech Bubble (Differentiated by state: normal / error / needs_approval) */}
      {context.speechBubbleText && (
        <div
          className={`absolute top-4 left-4 right-4 z-50 text-xs px-3 py-2 rounded-xl border shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200 ${
            avatarState === "needs_approval"
              ? "bg-slate-900/95 text-amber-200 border-amber-500/70 shadow-amber-500/10"
              : avatarState === "error"
              ? "bg-slate-900/95 text-red-200 border-red-500/70 shadow-red-500/10"
              : "bg-slate-900/95 text-cyan-200 border-cyan-500/40 shadow-cyan-500/10"
          }`}
        >
          <p className="leading-relaxed font-sans">{context.speechBubbleText}</p>

          {/* Actionable buttons for needs_approval state */}
          {avatarState === "needs_approval" && (
            <div className="flex gap-2 justify-end mt-2 pt-1 border-t border-amber-500/30">
              <button
                onClick={async () => {
                  try {
                    await emit("husk-response", { approved: false, action: "deny" });
                  } catch (e) {
                    console.warn("Approval emit error:", e);
                  }
                  if (pendingApproval) {
                    pendingApproval.resolve({
                      success: false,
                      output: "User rejected command execution.",
                    });
                    setPendingApproval(null);
                  }
                  fsm.transition("idle", { speechBubbleText: undefined });
                }}
                className="px-2.5 py-1 bg-red-600/80 hover:bg-red-500 text-white font-medium rounded text-[10px] transition-colors"
              >
                Deny
              </button>
              <button
                onClick={async () => {
                  try {
                    await emit("husk-response", { approved: true, action: "allow" });
                  } catch (e) {
                    console.warn("Approval emit error:", e);
                  }
                  if (pendingApproval) {
                    const { command, resolve } = pendingApproval;
                    setPendingApproval(null);
                    fsm.transition("working", { speechBubbleText: "Выполняю... ⚙️" });
                    const res = await executeCommand(command);
                    resolve(res);
                  }
                  fsm.transition("idle", { speechBubbleText: undefined });
                }}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-[10px] transition-colors"
              >
                Allow
              </button>
            </div>
          )}

          <div
            className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900/95 border-b border-r rotate-45 ${
              avatarState === "needs_approval"
                ? "border-amber-500/70"
                : avatarState === "error"
                ? "border-red-500/70"
                : "border-cyan-500/40"
            }`}
          />
        </div>
      )}

      {/* Mascot Sprite Renderer */}
      <div className="relative" data-tauri-drag-region>
        <MascotSpriteRenderer state={avatarState} />
      </div>

      {/* Floating Control Pill */}
      <div className="flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1 rounded-full border border-slate-700/60 shadow-lg text-[11px] text-slate-300">
        <button
          onClick={() => setIsInputOpen(!isInputOpen)}
          className="hover:text-cyan-400 font-mono transition-colors"
          title="Chat"
        >
          💬 Chat
        </button>
        <span className="text-slate-600">|</span>
        <button
          onClick={async () => {
            const geom: any = await invoke("get_active_window");
            fsm.setPerched(geom.title);
          }}
          className="hover:text-cyan-400 font-mono transition-colors"
          title="Perch on active window"
        >
          🪟 Perch
        </button>
        <span className="text-slate-600">|</span>
        <button
          onClick={async () => {
            try {
              await invoke("show_dashboard");
            } catch (err) {
              console.error("Failed to show dashboard:", err);
            }
          }}
          className="hover:text-cyan-400 font-mono transition-colors"
          title="Dashboard"
        >
          ⚙️
        </button>
      </div>

      {/* Input Drawer */}
      {isInputOpen && (
        <div className="absolute bottom-12 left-3 right-3 bg-slate-900/95 p-2 rounded-lg border border-cyan-500/50 shadow-2xl flex gap-1 z-50">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendPrompt()}
            placeholder="Talk to companion..."
            className="flex-1 bg-slate-800 text-xs text-white px-2 py-1 rounded outline-none border border-slate-700 focus:border-cyan-400 font-mono"
            autoFocus
          />
          <button
            onClick={handleSendPrompt}
            className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-2.5 py-1 rounded font-mono"
          >
            Send
          </button>
        </div>
      )}

      {/* Destructive Command Sandboxing Approval Modal */}
      {pendingApproval && (
        <div className="absolute inset-2 bg-slate-950/95 border border-red-500/80 rounded-xl p-3 flex flex-col justify-between z-50 shadow-2xl text-xs">
          <div>
            <div className="flex items-center gap-1.5 text-red-400 font-bold mb-1">
              <span>⚠️</span>
              <span>Approval Required</span>
            </div>
            <p className="text-slate-300 text-[11px] mb-2">
              Action: <code className="bg-slate-800 px-1 py-0.5 rounded text-red-300">{pendingApproval.command.type}</code>
            </p>
            <p className="text-slate-400 text-[10px]">
              {pendingApproval.command.type === "execute_shell"
                ? (pendingApproval.command as any).payload.explanation || (pendingApproval.command as any).payload.command
                : "The companion requested a destructive action."}
            </p>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <button
              onClick={() => {
                const item = pendingApproval;
                setPendingApproval(null);
                item.resolve({ success: false, output: "User denied execution." });
                fsm.transition("idle");
              }}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
            >
              Deny
            </button>
            <button
              onClick={async () => {
                const item = pendingApproval;
                setPendingApproval(null);
                fsm.transition("working", { speechBubbleText: "Выполняю... ⚙️" });
                const res = await executeCommand(item.command);
                item.resolve(res);
                fsm.transition("idle");
              }}
              className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded text-[10px]"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
