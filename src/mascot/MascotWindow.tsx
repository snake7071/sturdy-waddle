/**
 * GNU General Public License v3.0
 * Mascot Window Component (Transparent, Frameless Desktop Overlay)
 * Dark Smoked Glass SAO Aincrad HUD Aesthetic
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AvatarStateMachine, AvatarState, StateContext } from "../engine/AvatarStateMachine";
import { MascotSpriteRenderer } from "../engine/MascotSpriteRenderer";
import { UnifiedBrain } from "../brain";
import { CompanionCommand, isDestructiveCommand, PermissionMode } from "../types/commands";

export interface ChatHistoryMessage {
  id: string;
  role: "user" | "companion";
  text: string;
  timestamp: number;
}

export const MascotWindow: React.FC = () => {
  const [fsm] = useState(() => new AvatarStateMachine("idle"));
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [context, setContext] = useState<StateContext>(() => fsm.getContext());
  const [inputText, setInputText] = useState("");
  const [isInputOpen, setIsInputOpen] = useState(false);
  const [isVisionMode, setIsVisionMode] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryMessage[]>(() => {
    try {
      const saved = localStorage.getItem("companion_chat_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [mascotScale, setMascotScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("companion_mascot_scale");
      return saved ? Math.max(0.5, Math.min(3.0, parseFloat(saved))) : 1.0;
    } catch {
      return 1.0;
    }
  });
  const historyEndRef = useRef<HTMLDivElement | null>(null);
  const [hasActiveAnnotations, setHasActiveAnnotations] = useState(false);
  const hasActiveAnnotationsRef = useRef(false);
  const annotationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Control rail visibility: hidden while idle so only the mascot sprite is on screen.
  // Toggled explicitly with a right-click on the mascot; also shown while a panel is open.
  const [showControls, setShowControls] = useState(false);

  const toggleControls = useCallback(() => {
    setShowControls((prev) => !prev);
  }, []);

  const updateHasActiveAnnotations = useCallback((active: boolean) => {
    hasActiveAnnotationsRef.current = active;
    setHasActiveAnnotations(active);
  }, []);

  const handleClearAnnotations = useCallback(async () => {
    try {
      await invoke("clear_screen_annotations");
      updateHasActiveAnnotations(false);
      if (annotationTimeoutRef.current) {
        clearTimeout(annotationTimeoutRef.current);
        annotationTimeoutRef.current = null;
      }
    } catch (err) {
      console.warn("Failed to clear screen annotations:", err);
    }
  }, [updateHasActiveAnnotations]);

  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    const saved = localStorage.getItem("companion_permission_mode");
    return saved === "safe" || saved === "full" ? saved : "ask";
  });
  const [pendingApproval, setPendingApproval] = useState<{
    command: CompanionCommand;
    resolve: (res: { success: boolean; output: string }) => void;
  } | null>(null);

  const brainRef = useRef<UnifiedBrain | null>(null);

  const appendToHistory = (role: "user" | "companion", text: string) => {
    const msg: ChatHistoryMessage = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      role,
      text,
      timestamp: Date.now(),
    };
    setChatHistory((prev) => {
      const next = [...prev, msg].slice(-100);
      try {
        localStorage.setItem("companion_chat_history", JSON.stringify(next));
      } catch (err) {
        console.warn("Failed to persist chat history:", err);
      }
      return next;
    });
  };

  useEffect(() => {
    if (isHistoryOpen) {
      historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, isHistoryOpen]);

  useEffect(() => {
    brainRef.current = new UnifiedBrain(
      { permissionMode },
      (_summary) => {
        fsm.triggerMemoryCompaction();
      }
    );

    // Sync active permission mode with Rust backend on mount
    invoke("set_permission_mode", { mode: permissionMode }).catch((err) =>
      console.warn("[MascotWindow] Could not sync permission mode to backend:", err)
    );

    invoke<any>("get_system_context")
      .then((ctx) => {
        if (ctx?.profile && brainRef.current) {
          brainRef.current.setSystemProfile(ctx.profile);
        }
      })
      .catch((err) => console.warn("[MascotWindow] Could not load system context:", err));

    const unsubscribe = fsm.subscribe((state, ctx) => {
      setAvatarState(state);
      setContext({ ...ctx });
    });

    const unlistenPromise = listen<{
      state: "busy" | "error" | "needs_approval" | "done" | "idle";
      action?: string;
      message?: string;
      source?: string;
    }>("husk-event", (event) => {
      fsm.handleHuskEvent(event.payload);
    });

    const unlistenPermissionPromise = listen<PermissionMode>(
      "permission-mode-changed",
      (event) => {
        if (event.payload) {
          setPermissionMode(event.payload);
          brainRef.current?.setPermissionMode(event.payload);
        }
      }
    );

    const unlistenClearAnnotationsPromise = listen("clear-screen-annotations", () => {
      updateHasActiveAnnotations(false);
    });

    const unlistenHistoryPromise = listen("toggle-history", () => {
      setIsHistoryOpen((prev) => !prev);
    });

    const unlistenScalePromise = listen<number>("mascot-scale-changed", (event) => {
      if (typeof event.payload === "number" && !isNaN(event.payload)) {
        setMascotScale(Math.max(0.5, Math.min(3.0, event.payload)));
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F12") {
        e.preventDefault();
        invoke("open_devtools").catch((err) => console.error("Failed to open devtools:", err));
      } else if (e.key === "Escape") {
        if (hasActiveAnnotationsRef.current) {
          handleClearAnnotations();
        }
        setIsInputOpen(false);
        setIsHistoryOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unsubscribe();
      unlistenPromise.then((f) => f());
      unlistenPermissionPromise.then((f) => f());
      unlistenClearAnnotationsPromise.then((f) => f());
      unlistenHistoryPromise.then((f) => f());
      unlistenScalePromise.then((f) => f());
      window.removeEventListener("keydown", handleKeyDown);
      if (annotationTimeoutRef.current) {
        clearTimeout(annotationTimeoutRef.current);
      }
      brainRef.current?.destroy();
    };
  }, [fsm, handleClearAnnotations]);

  const handleSendPrompt = async () => {
    if (!inputText.trim()) return;
    const prompt = inputText.trim();
    let useVision = isVisionMode;
    if (!useVision) {
      // Auto-detect visual queries so the user doesn't have to manually toggle Vision Mode every single time
      const isVisualQuery =
        /(видишь|на экране|покажи|где|обведи|найди|вкладк|кнопк|окно|скрин|экран|посмотри|глянь|вторая|третья|первая|квадрат|круг|стрелк)/i.test(
          prompt
        );
      if (isVisualQuery) {
        useVision = true;
      }
    }
    setInputText("");
    setIsInputOpen(false);
    setIsVisionMode(false);

    appendToHistory("user", useVision ? `[Снимок экрана] ${prompt}` : prompt);

    if (
      /^(скройся|спрячься|исчезни|уйди|скройся в трей|закройся|hide|hide yourself|minimize)$/i.test(
        prompt
      )
    ) {
      const ack = "Хорошо, скрываюсь! Нажмите на иконку в трее, чтобы вернуть меня.";
      appendToHistory("companion", ack);
      fsm.triggerSpeech(ack, 3000);
      setTimeout(async () => {
        try {
          await invoke("hide_mascot");
        } catch {
          const appWindow = getCurrentWindow();
          await appWindow.hide();
        }
      }, 1000);
      return;
    }

    let screenBase64: string | undefined = undefined;
    if (useVision) {
      fsm.transition("working", { speechBubbleText: "Делаю снимок экрана..." });
      try {
        const rawB64 = await invoke<string>("capture_screen_snapshot");
        screenBase64 = rawB64.startsWith("data:") ? rawB64 : `data:image/jpeg;base64,${rawB64}`;
      } catch (err: any) {
        console.warn("[MascotWindow] Screen capture failed:", err);
        fsm.triggerError("Не удалось сделать снимок экрана. Отправляю только текст...", 3000);
      }
    }

    fsm.transition("working", { speechBubbleText: "Размышляю..." });

    try {
      if (!brainRef.current) throw new Error("Brain not initialized");

      let hasSwitchedToTalking = false;

      const result = await brainRef.current.sendPrompt(
        prompt,
        screenBase64,
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
          if (!hasSwitchedToTalking) {
            fsm.transition("working", { speechBubbleText: "Размышляю..." });
          }
        }
      );

      if (result.responseText) {
        appendToHistory("companion", result.responseText);
        fsm.triggerSpeech(result.responseText, 4500);
      } else {
        appendToHistory("companion", "Готово.");
        fsm.triggerSpeech("Готово.", 3000);
      }
    } catch (err: any) {
      let warning = err?.message || "AI сервер перегружен. Повторите запрос через несколько секунд.";
      warning = warning.replace(/^Error:\s*/i, "").replace(/\{.*?\}|\[.*?\]/g, "").trim();
      console.warn("[MascotWindow] Handled prompt error:", warning);
      appendToHistory("companion", warning);
      fsm.triggerError(warning, 4000);
    } finally {
      if (fsm.getState() === "working") {
        fsm.transition("idle");
      }
    }
  };

  const handleCommandDispatch = async (
    command: CompanionCommand
  ): Promise<{ success: boolean; output: string }> => {
    // 1. Safe Mode: Strictly block shell execution and destructive operations
    if (permissionMode === "safe") {
      if (command.type === "execute_shell" || isDestructiveCommand(command)) {
        fsm.triggerError("Действие заблокировано: в режиме Safe выполнение команд отключено.", 4000);
        return {
          success: false,
          output: "Error: Permission denied. Shell execution and destructive operations are strictly disabled in 'safe' permission mode.",
        };
      }
    }

    // 2. Ask Mode (Default): shell commands and destructive actions trigger needs_approval
    if (permissionMode === "ask") {
      if (command.type === "execute_shell" || isDestructiveCommand(command)) {
        return new Promise<{ success: boolean; output: string }>((resolve) => {
          setPendingApproval({ command, resolve });
          const desc =
            command.type === "execute_shell"
              ? (command.payload.explanation || command.payload.command)
              : "Действие требует подтверждения!";
          fsm.triggerNeedsApproval(`Требуется подтверждение: ${desc}`);
        });
      }
    }

    // 3. Full Mode (or harmless commands in safe/ask mode): execute immediately without confirmation!
    const taskDescription =
      command.type === "launch_app"
        ? `Запускаю ${command.payload.appName || "программу"}...`
        : command.type === "open_url"
        ? "Открываю ссылку..."
        : command.type === "save_memory"
        ? "Запоминаю факт..."
        : command.type === "draw_on_screen"
        ? "Рисую на экране..."
        : command.type === "clear_screen_annotations"
        ? "Очищаю экран..."
        : command.type === "execute_shell"
        ? "Выполняю команду..."
        : "Выполняю задачу...";
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
        try {
          const res = await invoke<string>("capture_screen_snapshot");
          return {
            success: true,
            output: `data:image/jpeg;base64,${res}`,
          };
        } catch (err: any) {
          return {
            success: false,
            output: `Ошибка снимка экрана: ${err?.message || err}`,
          };
        }
      } else if (command.type === "set_timer") {
        setTimeout(() => {
          fsm.triggerSpeech(`Напоминание: ${command.payload.label}`, 6000);
        }, command.payload.durationSeconds * 1000);
        return { success: true, output: `Timer set for ${command.payload.durationSeconds}s` };
      } else if (command.type === "save_memory") {
        const item = {
          key: command.payload.key,
          category: command.payload.category,
          content: command.payload.content,
          tags: command.payload.tags || [],
          updated_at: Math.floor(Date.now() / 1000),
        };
        await invoke("save_memory_entry", { item });
        return {
          success: true,
          output: `Memory successfully recorded in SQLite: [${command.payload.category}] ${command.payload.key}`,
        };
      } else if (command.type === "execute_shell") {
        try {
          const res: any = await invoke("execute_sandboxed_shell", {
            command: command.payload.command,
            cwd: command.payload.cwd,
          });
          const stdout = (res.stdout || "").trim();
          const stderr = (res.stderr || "").trim();
          let formattedOutput = "";
          if (stdout && stderr) {
            formattedOutput = `stdout:\n${stdout}\nstderr:\n${stderr}`;
          } else if (stdout) {
            formattedOutput = stdout;
          } else if (stderr) {
            formattedOutput = `stderr: ${stderr}`;
          } else {
            formattedOutput = res.success
              ? "(Команда выполнена успешно, вывод пуст)"
              : "(Ошибка выполнения команды)";
          }
          return {
            success: res.success,
            output: formattedOutput,
          };
        } catch (err: any) {
          return {
            success: false,
            output: `stderr: ${err?.message || err}`,
          };
        }
      } else if (command.type === "hide_companion") {
        const farewell = "Хорошо, скрываюсь! Нажмите на иконку в трее или горячую клавишу, чтобы вернуть меня.";
        appendToHistory("companion", farewell);
        fsm.triggerSpeech(farewell, 3000);
        setTimeout(async () => {
          try {
            await invoke("hide_mascot");
          } catch {
            const appWindow = getCurrentWindow();
            await appWindow.hide();
          }
        }, 1200);
        return { success: true, output: "Companion mascot hidden into tray." };
      } else if (command.type === "draw_on_screen") {
        try {
          await invoke("draw_on_screen", { payload: command.payload });
          updateHasActiveAnnotations(true);
          const duration =
            typeof command.payload.durationSeconds === "number" && command.payload.durationSeconds > 0
              ? command.payload.durationSeconds
              : 6;

          if (annotationTimeoutRef.current) {
            clearTimeout(annotationTimeoutRef.current);
          }
          annotationTimeoutRef.current = setTimeout(() => {
            updateHasActiveAnnotations(false);
          }, (duration + 1) * 1000);

          const count = command.payload.shapes?.length || 1;
          return {
            success: true,
            output: `Visual annotation (${count} shape(s)) drawn on screen for ${duration}s.`,
          };
        } catch (err: any) {
          return {
            success: false,
            output: `Failed to draw on screen: ${err?.message || err}`,
          };
        }
      } else if (command.type === "clear_screen_annotations") {
        await handleClearAnnotations();
        return {
          success: true,
          output: "Active screen annotations dismissed.",
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
        console.warn("[MascotWindow] Drag error:", err);
      } finally {
        fsm.setDragging(false);
      }
    }
  };

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
              appendToHistory("user", `[Прикреплено изображение: ${file.name}]`);
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
                async (cmd: CompanionCommand) => await handleCommandDispatch(cmd),
                () => {
                  if (!switched) {
                    fsm.transition("working", { speechBubbleText: "Анализирую изображение..." });
                  }
                }
              );
              if (res.responseText) {
                appendToHistory("companion", res.responseText);
                fsm.triggerSpeech(res.responseText, 4500);
              }
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
      className="w-full h-full relative select-none flex flex-col justify-end items-center pb-2 px-3 bg-transparent pointer-events-none antialiased"
      onMouseDown={handleMouseDown}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onContextMenu={(e) => {
        e.preventDefault();
        toggleControls();
      }}
    >
      {/* Quick Dismiss Screen Annotations Pill */}
      {hasActiveAnnotations && !context.speechBubbleText && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto animate-sao-draw">
          <button
            onClick={handleClearAnnotations}
            className="flex items-center gap-1.5 px-3 py-1 rounded-sm bg-[#141722]/95 border border-[#EBA821]/40 border-l-2 border-l-[#EBA821] text-[#EBA821] hover:bg-[#141722] text-[10px] font-mono font-bold tracking-wider shadow-xl backdrop-blur-md transition-all active:scale-95"
            title="Очистить экранные аннотации (Esc)"
          >
            <span className="w-1.5 h-1.5 rotate-45 bg-[#EBA821] animate-pulse" />
            <span>CLEAR DRAW (ESC)</span>
          </button>
        </div>
      )}

      {/* =========================================================================
          SAO Notification Plate (Speech Bubble)
          Smoked Obsidian Glass with SAO Status Gauge Top Bar
          Flex-positioned above sprite: NEVER clipped horizontally or vertically!
          ========================================================================= */}
      {context.speechBubbleText && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="no-drag select-text w-full max-w-[290px] mb-2 pointer-events-auto z-50 flex flex-col justify-end"
          style={{
            maxHeight: `calc(100% - ${Math.round(260 * mascotScale)}px)`,
          }}
        >
          {/* SAO Box Shell */}
          <div className="relative bg-[#141722]/95 border border-white/15 border-t-2 border-t-[#EBA821] rounded-sm shadow-xl p-3 text-xs text-neutral-200 flex flex-col max-h-full">
            {/* Top SAO HP-style Accent Gauge */}
            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-1.5">
                {/* SAO Diamond Cap */}
                <span
                  className={`w-2 h-2 rotate-45 shrink-0 transition-colors ${
                    avatarState === "needs_approval"
                      ? "bg-[#EBA821]"
                      : avatarState === "error"
                      ? "bg-[#D94848]"
                      : "bg-[#2E9E6B]"
                  }`}
                />
                <span className="text-[10px] font-mono font-semibold tracking-wider uppercase text-neutral-400">
                  {avatarState === "needs_approval"
                    ? "Подтверждение"
                    : avatarState === "error"
                    ? "Предупреждение"
                    : "Компаньон"}
                </span>
              </div>

              {/* Status Bar Track + Close Button */}
              <div className="flex items-center gap-2">
                <div className="w-14 h-1 bg-white/10 overflow-hidden flex rounded-full">
                  <div
                    className={`h-full transition-all duration-300 ${
                      avatarState === "needs_approval"
                        ? "w-2/3 bg-[#EBA821]"
                        : avatarState === "error"
                        ? "w-full bg-[#D94848]"
                        : "w-full bg-[#2E9E6B]"
                    }`}
                  />
                </div>

                {avatarState !== "needs_approval" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      fsm.clearSpeech();
                    }}
                    className="text-neutral-500 hover:text-neutral-200 text-xs leading-none transition-colors ml-1 p-0.5"
                    title="Закрыть сообщение"
                  >
                    ✕
                  </button>
                )}

                {hasActiveAnnotations && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearAnnotations();
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#EBA821]/20 text-[#EBA821] hover:bg-[#EBA821]/30 border border-[#EBA821]/40 transition-all active:scale-95"
                    title="Очистить рисунки на экране (Esc)"
                  >
                    <span>CLEAR DRAW</span>
                  </button>
                )}
              </div>
            </div>

            {/* Bubble Message Text (Scrolls cleanly if long, never gets clipped!) */}
            <div className="leading-relaxed font-sans overflow-y-auto pr-1 break-words text-neutral-200 flex-1 select-text text-[12px] max-h-52">
              {context.speechBubbleText}
            </div>

            {/* Needs Approval Action Buttons */}
            {avatarState === "needs_approval" && (
              <div className="flex gap-2 justify-end mt-2.5 pt-2 border-t border-white/10 shrink-0">
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
                  className="px-3 py-1 bg-white/10 hover:bg-white/15 text-neutral-300 hover:text-white font-bold rounded text-[11px] transition-colors active:scale-95 border border-white/10"
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
                      fsm.transition("working", { speechBubbleText: "Выполняю..." });
                      const res = await executeCommand(command);
                      resolve(res);
                    }
                    fsm.transition("idle", { speechBubbleText: undefined });
                  }}
                  className="px-3.5 py-1 bg-[#EBA821] hover:bg-[#d89619] text-[#12141A] font-bold rounded text-[11px] transition-colors active:scale-95 shadow-md shadow-[#EBA821]/20"
                >
                  Allow
                </button>
              </div>
            )}

            {/* Downward indicator pointing to the character */}
            <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 rotate-45 bg-[#141722] border-r border-b border-white/15" />
          </div>
        </div>
      )}

      {/* =========================================================================
          Mascot Sprite Overlay (Direct Desktop Floating Character)
          ========================================================================= */}
      <div
        className="shrink-0 relative pointer-events-auto z-10"
        data-tauri-drag-region
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleControls();
        }}
      >
        <MascotSpriteRenderer state={avatarState} scale={mascotScale} />
      </div>

      {/* =========================================================================
          SAO Side Action Rail (Vertical Medallion Stack)
          Floats cleanly on the side, slides out sleek ribbons on hover
          ========================================================================= */}
      <div
        className={`absolute right-2 bottom-6 flex flex-col gap-2.5 z-40 transition-opacity duration-200 ${
          showControls || isInputOpen || isHistoryOpen || hasActiveAnnotations
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Action 1: Chat Toggle */}
        <div className="group/rail relative flex items-center justify-end">
          <div
            className="pointer-events-none absolute right-full mr-2 opacity-0 -translate-x-1 group-hover/rail:opacity-100 group-hover/rail:translate-x-0 transition-all duration-150 whitespace-nowrap px-2.5 py-1 bg-[#141722]/95 text-[10px] font-sans tracking-wide text-neutral-200 border border-white/10 border-r-2 border-r-[#EBA821] rounded-sm shadow-lg"
          >
            Чат
          </div>

          <button
            type="button"
            onClick={() => {
              setIsInputOpen(!isInputOpen);
              if (!isInputOpen) setIsHistoryOpen(false);
            }}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-lg active:scale-90 ${
              isInputOpen
                ? "bg-[#EBA821] text-[#12141A] ring-2 ring-white/20"
                : "bg-[#151822] text-neutral-300 border border-white/10 hover:bg-[#EBA821] hover:text-[#12141A] hover:border-transparent"
            }`}
            title="Чат с компаньоном"
            aria-label="Chat"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
        </div>

        {/* Action 2: History Log */}
        <div className="group/rail relative flex items-center justify-end">
          <div
            className="pointer-events-none absolute right-full mr-2 opacity-0 -translate-x-1 group-hover/rail:opacity-100 group-hover/rail:translate-x-0 transition-all duration-150 whitespace-nowrap px-2.5 py-1 bg-[#141722]/95 text-[10px] font-sans tracking-wide text-neutral-200 border border-white/10 border-r-2 border-r-[#EBA821] rounded-sm shadow-lg"
          >
            История
          </div>

          <button
            type="button"
            onClick={() => {
              setIsHistoryOpen(!isHistoryOpen);
              if (!isHistoryOpen) setIsInputOpen(false);
            }}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-lg active:scale-90 ${
              isHistoryOpen
                ? "bg-[#EBA821] text-[#12141A] ring-2 ring-white/20"
                : "bg-[#151822] text-neutral-300 border border-white/10 hover:bg-[#EBA821] hover:text-[#12141A] hover:border-transparent"
            }`}
            title="История сообщений"
            aria-label="History"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>

        {/* Action 3: Window Perch */}
        <div className="group/rail relative flex items-center justify-end">
          <div
            className="pointer-events-none absolute right-full mr-2 opacity-0 -translate-x-1 group-hover/rail:opacity-100 group-hover/rail:translate-x-0 transition-all duration-150 whitespace-nowrap px-2.5 py-1 bg-[#141722]/95 text-[10px] font-sans tracking-wide text-neutral-200 border border-white/10 border-r-2 border-r-[#EBA821] rounded-sm shadow-lg"
          >
            Сесть на окно
          </div>

          <button
            type="button"
            onClick={async () => {
              const geom: any = await invoke("get_active_window");
              fsm.setPerched(geom.title);
            }}
            className="w-8 h-8 rounded-full bg-[#151822] text-neutral-300 border border-white/10 hover:bg-[#EBA821] hover:text-[#12141A] hover:border-transparent flex items-center justify-center transition-colors shadow-lg active:scale-90"
            title="Сесть на активное окно"
            aria-label="Window Perch"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
            </svg>
          </button>
        </div>

        {/* Action 4: Dashboard Menu */}
        <div className="group/rail relative flex items-center justify-end">
          <div
            className="pointer-events-none absolute right-full mr-2 opacity-0 -translate-x-1 group-hover/rail:opacity-100 group-hover/rail:translate-x-0 transition-all duration-150 whitespace-nowrap px-2.5 py-1 bg-[#141722]/95 text-[10px] font-sans tracking-wide text-neutral-200 border border-white/10 border-r-2 border-r-[#EBA821] rounded-sm shadow-lg"
          >
            Настройки
          </div>

          <button
            type="button"
            onClick={async () => {
              try {
                await invoke("show_dashboard");
              } catch (err) {
                console.error("Failed to show dashboard:", err);
              }
            }}
            className="w-8 h-8 rounded-full bg-[#151822] text-neutral-300 border border-white/10 hover:bg-[#EBA821] hover:text-[#12141A] hover:border-transparent flex items-center justify-center transition-colors shadow-lg active:scale-90"
            title="Главное меню настроек"
            aria-label="Dashboard"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        {/* Action 5: Minimize to Tray */}
        <div className="group/rail relative flex items-center justify-end">
          <div
            className="pointer-events-none absolute right-full mr-2 opacity-0 -translate-x-1 group-hover/rail:opacity-100 group-hover/rail:translate-x-0 transition-all duration-150 whitespace-nowrap px-2.5 py-1 bg-[#141722]/95 text-[10px] font-sans tracking-wide text-neutral-200 border border-white/10 border-r-2 border-r-[#D94848] rounded-sm shadow-lg"
          >
            Свернуть
          </div>

          <button
            type="button"
            onClick={async () => {
              try {
                await invoke("hide_mascot");
              } catch {
                const appWindow = getCurrentWindow();
                await appWindow.hide();
              }
            }}
            className="w-8 h-8 rounded-full bg-[#151822] text-neutral-300 border border-white/10 hover:bg-[#D94848] hover:text-white hover:border-transparent flex items-center justify-center transition-colors shadow-lg active:scale-90"
            title="Свернуть в трей"
            aria-label="Hide"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        </div>
      </div>

      {/* =========================================================================
          Chat History Panel (Smoked Obsidian Log)
          ========================================================================= */}
      {isHistoryOpen && (
        <div className="absolute inset-x-3 top-3 bottom-14 bg-[#141722]/95 p-3.5 rounded-sm border border-white/15 border-t-2 border-t-[#EBA821] shadow-xl flex flex-col z-50 pointer-events-auto">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-200">
              <span className="w-2 h-2 rotate-45 bg-[#EBA821]" />
              <span className="font-mono tracking-wider uppercase">ИСТОРИЯ СООБЩЕНИЙ</span>
              <span className="text-[10px] text-neutral-500 font-mono">[{chatHistory.length}]</span>
            </div>
            <div className="flex items-center gap-2">
              {chatHistory.length > 0 && (
                <button
                  onClick={() => {
                    setChatHistory([]);
                    brainRef.current?.clearHistory?.();
                    try {
                      localStorage.removeItem("companion_chat_history");
                    } catch {}
                  }}
                  className="text-[10px] text-neutral-400 hover:text-[#D94848] transition-colors"
                  title="Очистить историю диалога"
                >
                  Очистить
                </button>
              )}
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="text-neutral-500 hover:text-neutral-200 text-xs transition-colors"
                title="Скрыть историю"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Messages list with auto-scroll */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
            {chatHistory.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500 py-6 text-[11px]">
                <span className="font-medium text-neutral-400">История сообщений пуста</span>
                <span className="text-[10px] text-neutral-500 mt-1">
                  Нажмите на иконку диалога в боковом меню, чтобы отправить команду!
                </span>
              </div>
            ) : (
              chatHistory.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[92%] rounded-sm px-3 py-1.5 text-[11px] leading-relaxed select-text ${
                      msg.role === "user"
                        ? "bg-white/[0.06] text-neutral-100 border border-white/10 border-l-2 border-l-[#EBA821]"
                        : "bg-white/[0.03] text-neutral-300 border border-white/5"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                  </div>
                  <span className="text-[9px] text-neutral-500 mt-0.5 px-1 font-mono">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))
            )}
            <div ref={historyEndRef} />
          </div>
        </div>
      )}

      {/* =========================================================================
          Floating Command Bar (Sleek Dark Smoked Glass Input Strip)
          ========================================================================= */}
      {isInputOpen && (
        <div className="absolute bottom-2 left-3 right-12 bg-[#141722]/95 px-3 py-1.5 rounded-sm border border-white/15 border-l-2 border-l-[#EBA821] shadow-xl flex items-center gap-2 z-50 pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsVisionMode((prev) => !prev)}
            className={`p-1.5 rounded transition-all select-none ${
              isVisionMode
                ? "bg-[#EBA821] text-[#12141A]"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-white/5"
            }`}
            title={
              isVisionMode
                ? "Зрение включено (скриншот будет прикреплен)"
                : "Включить зрение экрана"
            }
            aria-label="Toggle Vision Mode"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>

          {hasActiveAnnotations && (
            <button
              type="button"
              onClick={handleClearAnnotations}
              className="p-1.5 rounded transition-all select-none text-[#EBA821] hover:bg-[#EBA821]/20 border border-[#EBA821]/30"
              title="Очистить экранные аннотации"
              aria-label="Clear Screen Drawings"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendPrompt()}
            placeholder={
              isVisionMode
                ? "Запрос по экрану..."
                : "Введите команду или вопрос..."
            }
            className="flex-1 bg-transparent text-xs text-neutral-100 placeholder:text-neutral-500 outline-none font-sans"
            autoFocus
          />

          <button
            onClick={handleSendPrompt}
            className="text-[#EBA821] hover:text-[#d89619] p-1 transition-colors active:scale-95"
            title="Отправить"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      )}

      {/* =========================================================================
          Approval Modal (SAO Warning HUD)
          ========================================================================= */}
      {pendingApproval && (
        <div className="absolute inset-3 bg-[#141722]/95 border border-white/15 border-l-4 border-l-[#D94848] rounded-sm p-3.5 flex flex-col justify-between z-50 shadow-xl text-xs text-neutral-200 pointer-events-auto">
          <div>
            <div className="flex items-center gap-2 text-[#D94848] font-bold mb-1">
              <span className="w-2 h-2 rotate-45 bg-[#D94848]" />
              <span className="font-mono tracking-wider uppercase">ТРЕБУЕТСЯ ПОДТВЕРЖДЕНИЕ</span>
            </div>
            <p className="text-neutral-400 text-[11px] mb-2 font-mono">
              Action: <span className="text-neutral-200">{pendingApproval.command.type}</span>
            </p>
            <p className="text-neutral-300 text-[11px] leading-relaxed">
              {pendingApproval.command.type === "execute_shell"
                ? (pendingApproval.command as any).payload.explanation || (pendingApproval.command as any).payload.command
                : "Компаньон запросил системное действие."}
            </p>
          </div>
          <div className="flex gap-2 justify-end mt-3 pt-2 border-t border-white/10">
            <button
              onClick={() => {
                const item = pendingApproval;
                setPendingApproval(null);
                item.resolve({ success: false, output: "User denied execution." });
                fsm.transition("idle");
              }}
              className="px-3 py-1 bg-white/10 hover:bg-white/15 text-neutral-300 font-bold rounded text-[11px] transition-colors border border-white/10"
            >
              Deny
            </button>
            <button
              onClick={async () => {
                const item = pendingApproval;
                setPendingApproval(null);
                fsm.transition("working", { speechBubbleText: "Выполняю..." });
                const res = await executeCommand(item.command);
                item.resolve(res);
                fsm.transition("idle");
              }}
              className="px-3.5 py-1 bg-[#EBA821] hover:bg-[#d89619] text-[#12141A] font-bold rounded text-[11px] transition-colors shadow-sm"
            >
              Allow
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
