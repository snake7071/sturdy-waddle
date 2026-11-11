/**
 * GNU General Public License v3.0
 * Direct Client-to-API Gemini Integration via official @google/genai SDK
 * Real-time streaming with Thinking Mode (Chain-of-Thought reasoning) and strict 3-step Tool Calling.
 */

import { GoogleGenAI } from "@google/genai";
import { sanitizeForLLM } from "./sanitizer";
import { CompanionCommand } from "../types/commands";
import { GEMINI_TOOLS } from "./tools";
import { BrainProvider, CommandExecutor, SendPromptResult } from "./provider";

export interface SystemProfile {
  os_name: string;
  os_version: string;
  desktop_env: string;
  session_type: string;
  user_name: string;
  default_shell: string;
}

export interface BrainPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: {
    id?: string;
    name: string;
    args: Record<string, any>;
  };
  functionResponse?: {
    id?: string;
    name: string;
    response: Record<string, any>;
  };
}

export interface BrainTurn {
  role: "user" | "model";
  parts: BrainPart[];
}

export interface BrainConfig {
  modelName?: string;
  userName?: string;
  persona?: string;
  systemProfile?: SystemProfile;
  thinkingBudget?: number;
  maxShortTermHistoryTurns?: number;
  compactionThresholdTokens?: number;
}

export type { CommandExecutor };

/**
 * Extracts a human-friendly message from Gemini API errors, preventing raw JSON dumps.
 */
function formatGeminiError(err: any): string {
  if (!err) return "Google AI servers are overloaded. Please try again in a few seconds.";

  const rawMessage = typeof err === "string" ? err : err.message || String(err);
  let errorCode: number | undefined = err.status || err.code;
  let statusText: string | undefined = err.statusText;
  let parsedMsg = rawMessage;

  // Attempt to parse embedded JSON payload
  const jsonMatch = rawMessage.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error) {
        errorCode = parsed.error.code || errorCode;
        statusText = parsed.error.status || statusText;
        parsedMsg = parsed.error.message || parsedMsg;
      }
    } catch {
      // ignore JSON parse failure
    }
  }

  const combined = `${errorCode ?? ""} ${statusText ?? ""} ${parsedMsg} ${rawMessage}`.toLowerCase();

  if (
    combined.includes("503") ||
    combined.includes("overloaded") ||
    combined.includes("high demand") ||
    combined.includes("unavailable")
  ) {
    return "Google AI servers are overloaded. Please try again in a few seconds.";
  }

  if (
    combined.includes("429") ||
    combined.includes("resource_exhausted") ||
    combined.includes("quota")
  ) {
    return "Достигнут суточный лимит запросов Gemini API. Попробуйте модель gemini-3.5-flash или gemini-3.1-flash-lite.";
  }

  if (
    combined.includes("401") ||
    combined.includes("403") ||
    combined.includes("unauthenticated") ||
    combined.includes("permission_denied") ||
    combined.includes("api key not valid")
  ) {
    return "Invalid or unauthorized API key.";
  }

  if (combined.includes("abort") || combined.includes("cancelled")) {
    return "Request was cancelled.";
  }

  // Strip JSON brackets and trim
  const clean = parsedMsg.replace(/\{.*?\}|\[.*?\]/g, "").replace(/\s+/g, " ").trim();
  return clean || "Google AI servers are overloaded. Please try again in a few seconds.";
}

export class GeminiBrain implements BrainProvider {
  private shortTermHistory: BrainTurn[] = [];
  private config: BrainConfig;
  private onMemoryCompactionGlitch?: (summary: string) => void;

  constructor(
    config: BrainConfig = {},
    onMemoryCompactionGlitch?: (summary: string) => void
  ) {
    this.config = {
      modelName: "gemini-3.5-flash",
      thinkingBudget: 1024,
      maxShortTermHistoryTurns: 25,
      compactionThresholdTokens: 4000,
      ...config,
    };
    this.onMemoryCompactionGlitch = onMemoryCompactionGlitch;
  }

  public setSystemProfile(profile: SystemProfile): void {
    this.config.systemProfile = profile;
    if (profile.user_name && !this.config.userName) {
      this.config.userName = profile.user_name;
    }
  }

  /**
   * Tests connection to Gemini API with a lightweight ping
   */
  public static async testConnection(
    apiKey: string,
    modelName?: string
  ): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    const trimmed = (apiKey || "").trim();
    if (!trimmed) {
      return { success: false, message: "API ключ Google Gemini не указан." };
    }
    const model = (modelName || "gemini-3.5-flash").trim();
    const startTime = Date.now();
    try {
      const client = new GoogleGenAI({ apiKey: trimmed });
      await client.models.generateContent({
        model,
        contents: "ping",
        config: { maxOutputTokens: 2 },
      });
      const latencyMs = Date.now() - startTime;
      return {
        success: true,
        message: `Подключение к Gemini успешно! Задержка: ${latencyMs}ms (${model})`,
        latencyMs,
      };
    } catch (err: any) {
      const formatted = formatGeminiError(err);
      return { success: false, message: formatted };
    }
  }

  /**
   * Dynamic getter that resolves the Gemini client on demand.
   * Priority: localStorage.getItem("gemini_api_key") -> import.meta.env.VITE_GEMINI_API_KEY
   */
  public getGeminiClient(): GoogleGenAI {
    const localKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") : null;
    const envKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
    const apiKey = (localKey && localKey.trim()) || (envKey && envKey.trim()) || "";

    if (!apiKey) {
      throw new Error("Gemini API key is missing. Click the settings gear to add it.");
    }

    return new GoogleGenAI({ apiKey });
  }

  /**
   * System Prompt enforcing strictly 1-2 sentence brevity for compact desktop UX and TTS,
   * with lightweight system fingerprint meta header and dynamic SQLite memory context.
   */
  private getSystemPrompt(memoryContext?: string): string {
    const user = this.config.userName || this.config.systemProfile?.user_name || "friend";
    const profile = this.config.systemProfile;

    const envHeader = profile
      ? `System Environment:
- OS: ${profile.os_name} ${profile.os_version} (${profile.session_type}, ${profile.desktop_env})
- Shell: ${profile.default_shell}
- User: ${user}
`
      : "";

    const memorySection =
      memoryContext && memoryContext.trim().length > 0
        ? `\n---
${memoryContext.trim()}
---
STRICT MEMORY RULES:
- Strictly obey and enforce all user preferences and rules specified in memory (e.g. if user asks not to use emojis, NEVER use emojis).
- Naturally incorporate remembered facts and project details when relevant.
`
        : "";

    // Determine companion personality / persona
    let persona: string | null = null;
    if (typeof window !== "undefined") {
      persona = localStorage.getItem("companion_persona");
    }
    if (persona === null && this.config.persona !== undefined) {
      persona = this.config.persona;
    }

    let characterSection = "";
    if (persona !== null) {
      const trimmed = persona.trim();
      if (trimmed.length > 0) {
        characterSection = `CHARACTER & PERSONALITY:\n${trimmed}\n`;
      } else {
        characterSection = `INITIAL PERSONALITY:\nYou have no preset character or persona. Your personality, manner, and behavior must be shaped entirely and solely by the user's remembered preferences, facts, and guidelines in memory.\n`;
      }
    } else {
      characterSection = `You are a cute anime companion mascot living on ${user}'s desktop.\nBe playful, warm, cute, observant, intelligent, and helpful.\n`;
    }

    return `${envHeader}${characterSection}BREVITY CONSTRAINT (STRICT): You must ALWAYS respond in 1 to 2 concise sentences maximum.
Respond in the language the user speaks (e.g. Russian if user speaks Russian).
Never write long paragraphs or markdown bullet lists in standard chat.
Your responses are displayed in a compact floating speech bubble and read aloud by TTS.${memorySection}

VISION & SCREEN AWARENESS:
When an image/screenshot is attached to the user prompt (Vision Mode), you have direct visual perception of their screen.
- Carefully examine the visual content of the screenshot to answer questions about what is visible, open windows, text, code, or desktop layout.
- You have true multimodal vision — describe what you see directly! Never claim you cannot see the image or that you only see file size when an image is provided.
- Do not invoke 'capture_screen' if a screenshot is already attached to the prompt.

ACTIONS & TOOLS (ROLE AS SEMANTIC BRAIN):
You control the user's desktop computer via tools.
1. LONG-TERM MEMORY (save_memory):
   Whenever the user mentions facts about themselves, their tools, skills, preferences, rules, or projects (e.g. "Я пишу бекенд на Rust", "Не используй эмодзи", "Не ставь восклицательные знаки", "Меня зовут ...", "Мой проект называется ..."):
   IMMEDIATELY invoke \`save_memory\` with:
   - category: "preference" (for formatting, rules, emoji preferences), "fact" (for skills, tools, facts), "project" (for project notes), or "profile" (for identity)
   - key: concise snake_case identifier (e.g. "backend_rust", "no_emojis", "user_role")
   - content: concise statement of the fact/preference/rule to remember forever
   - tags: optional array of keywords (e.g. ["rust", "backend"])
2. SLANG, ABBREVIATIONS & SYNONYM NORMALIZATION:
   As the intelligent semantic brain, understand all colloquialisms, slang, abbreviations, and informal names in any language (e.g. Russian: "телега", "тг" -> "Telegram"; "хром", "браузер", "интернет" -> "browser"; "терминал", "консоль", "командная строка" -> "terminal"; "код", "вскод" -> "code"; "стим" -> "steam"; "дискорд" -> "discord").
   ALWAYS normalize user requests into canonical entity names when invoking launch_app:
   - appName: "Telegram" (for Telegram / телега / тг)
   - appName: "browser" (for default browser / хром / браузер)
   - appName: "terminal" (for console / terminal / консоль)
   - Or standard application names: "code", "discord", "steam", "spotify", etc.
3. TERMINAL COMMANDS & DIAGNOSTICS:
   When the user asks to execute a command, scan, or script in the terminal/console (e.g. "выполни nmap скан машины", "запусти ping", "проверь сеть", "запусти команду в терминале"):
   Call launch_app with appName: "terminal" and the command in args: ["<command>"].
   The OS controller automatically launches the system's default terminal ($TERMINAL, Windows Terminal, Terminal.app) and keeps the interactive console open after execution so the user can inspect output and run further commands.
4. OPENING LINKS & SITES:
   When the user asks to open any website, video, music, or link (e.g. "открой ютуб", "open youtube", "найди в гугле"), call open_url with the full URL (e.g. 'https://www.youtube.com', 'https://github.com', 'https://google.com').
5. HIDING COMPANION (hide_companion):
   When the user asks you to hide, minimize, or disappear from the screen (e.g. "скройся", "спрячься", "исчезни", "уйди", "скройся в трей", "закройся", "hide", "minimize"), acknowledge warmly and call \`hide_companion\`. The user can unhide you anytime via the system tray icon or hotkey.
6. MULTI-STEP INVESTIGATION & OUTPUT EVALUATION (REACT LOOP):
   Whenever you execute tools (e.g. searching for files with execute_shell, inspecting directories, running commands or diagnostics):
   - You will receive the actual stdout, stderr, and success status of the command.
   - CAREFULLY EVALUATE THE TOOL OUTPUT:
     * If a command succeeded and returned what was requested, summarize and speak the answer in 1-2 sentences.
     * If a command failed, returned an error, or returned empty output (for example, searching for a file in ~ produced no results): DO NOT GIVE UP IMMEDIATELY! Think about why, and call another tool to try alternative directories (e.g. ~/Downloads, ~/Documents), case-insensitive patterns (e.g. \`find ~ -iname "*pattern*"\`), or different commands.
     * You can invoke multiple consecutive tool calls across turns until you reach the goal.
     * However, if after trying multiple sensible attempts nothing is found or possible, politely explain in 1-2 sentences that you couldn't find or complete it.`;
  }

  /**
   * Sanitizes conversation history for Google Gemini:
   * 1. Preserves only clean conversational turns (user -> model text).
   * 2. Eliminates ephemeral functionCall and functionResponse turns from long-term history.
   * 3. Enforces valid role alternation (user -> model -> user -> model).
   */
  private sanitizeHistory(history: BrainTurn[]): BrainTurn[] {
    const clean: BrainTurn[] = [];

    for (const turn of history) {
      const textParts = turn.parts
        .filter((p) => p.text && p.text.trim().length > 0)
        .map((p) => ({ text: p.text }));

      if (textParts.length === 0) continue;

      if (turn.role === "user") {
        if (clean.length > 0 && clean[clean.length - 1].role === "user") {
          clean[clean.length - 1].parts.push(...textParts);
        } else {
          clean.push({ role: "user", parts: textParts });
        }
      } else if (turn.role === "model") {
        if (clean.length > 0 && clean[clean.length - 1].role === "model") {
          clean[clean.length - 1].parts.push(...textParts);
        } else {
          clean.push({ role: "model", parts: textParts });
        }
      }
    }

    // Must start with user
    while (clean.length > 0 && clean[0].role !== "user") {
      clean.shift();
    }

    // Must end with model (since incoming prompt adds the next user turn)
    while (clean.length > 0 && clean[clean.length - 1].role !== "model") {
      clean.pop();
    }

    return clean;
  }

  /**
   * Sends user prompt with real-time streaming, Thinking Mode (Chain-of-Thought),
   * post-stream tool execution, and official Gemini functionResponse completion.
   */
  public async sendPrompt(
    rawPrompt: string,
    imageBase64?: string,
    onChunk?: (accumulatedText: string) => void,
    commandExecutor?: CommandExecutor,
    onThinking?: (thoughtText: string) => void
  ): Promise<SendPromptResult> {
    // 1. Resolve client dynamically on-demand
    const ai = this.getGeminiClient();

    // 2. Pre-flight Privacy Redaction Filter
    const sanitizedPrompt = sanitizeForLLM(rawPrompt);

    // 2.1 Fetch relevant long-term memory & user profile rules from SQLite via Rust IPC
    let memoryContext = "";
    try {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        memoryContext = await invoke<string>("get_relevant_memory_context", {
          query: sanitizedPrompt,
        });
      }
    } catch (e) {
      console.warn("[GeminiBrain] Could not query SQLite memory context:", e);
    }

    // Ensure historical turns are strictly sanitized before compaction check
    this.shortTermHistory = this.sanitizeHistory(this.shortTermHistory);

    // 3. Sliding window check & Compaction Trigger (15-25 turns)
    const maxTurns = this.config.maxShortTermHistoryTurns || 20;
    if (this.shortTermHistory.length >= maxTurns) {
      await this.compactMemory(ai);
    }

    // 4. Build current turn
    const currentParts: BrainPart[] = [{ text: sanitizedPrompt }];
    if (imageBase64) {
      const mimeType = imageBase64.startsWith("data:image/png")
        ? "image/png"
        : "image/jpeg";
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      currentParts.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      });
    }

    const userTurn: BrainTurn = {
      role: "user",
      parts: currentParts,
    };

    const contents: any[] = [...this.shortTermHistory, userTurn];
    const systemInstruction = this.getSystemPrompt(memoryContext);

    // Auto-migrate any deprecated model names (gemini-2.0 or 2.5) to active gemini-3.5-flash
    let storedModel = typeof window !== "undefined" ? localStorage.getItem("gemini_model_name") : null;
    if (storedModel && (storedModel.includes("2.0") || storedModel.includes("2.5"))) {
      storedModel = "gemini-3.5-flash";
      try {
        localStorage.setItem("gemini_model_name", "gemini-3.5-flash");
      } catch {}
    }

    let storedBudget = typeof window !== "undefined" ? localStorage.getItem("gemini_thinking_budget") : null;

    const primaryModel = (storedModel && storedModel.trim()) || this.config.modelName || "gemini-3.5-flash";
    const fallbackModel = "gemini-3.1-flash-lite";

    const thinkingBudget = storedBudget !== null ? parseInt(storedBudget, 10) : (this.config.thinkingBudget ?? 1024);

    const buildStreamConfig = (model: string, allowTools: boolean = true) => {
      const isLite = model.includes("flash-lite");
      const cfg: any = {
        systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 2048,
      };

      if (allowTools) {
        const activeTools = imageBase64
          ? GEMINI_TOOLS.filter((t) => t.name !== "capture_screen")
          : GEMINI_TOOLS;
        cfg.tools = [{ functionDeclarations: activeTools as any }];
      }

      if (thinkingBudget > 0 && !isLite) {
        cfg.thinkingConfig = {
          thinkingBudget,
          includeThoughts: true,
        };
      }
      return cfg;
    };

    const fetchStreamWithFallback = async (requestContents: any[], allowTools: boolean = true) => {
      const fetchFromModel = async (model: string) => {
        return await ai.models.generateContentStream({
          model,
          contents: requestContents,
          config: buildStreamConfig(model, allowTools),
        });
      };

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Primary model connection timeout")), 6000)
        );
        return await Promise.race([fetchFromModel(primaryModel), timeoutPromise]);
      } catch (err: any) {
        console.warn(`[GeminiBrain] Primary model (${primaryModel}) error:`, err?.message, `Falling back to ${fallbackModel}`);
        return await fetchFromModel(fallbackModel);
      }
    };

    // Multi-turn Agentic ReAct Loop: allows model to evaluate tool outputs and try alternative attempts
    const MAX_TOOL_ITERATIONS = 5;
    let iteration = 0;
    const allExecutedCommands: CompanionCommand[] = [];
    const currentConversation: any[] = [...contents];
    let finalAccumulatedText = "";

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      let iterationText = "";
      const rawFunctionCalls: Array<{ id?: string; name: string; args: Record<string, any> }> = [];
      const seenCallKeys = new Set<string>();
      const modelCandidateParts: any[] = [];

      let responseStream: any = null;
      try {
        responseStream = await fetchStreamWithFallback(currentConversation, true);
      } catch (err: any) {
        console.error(`[GeminiBrain] Failed to start stream on iteration ${iteration}:`, err);
        if (iteration === 1) {
          throw new Error(formatGeminiError(err));
        }
        break;
      }

      try {
        for await (const chunk of responseStream) {
          let chunkText = "";

          if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
            for (const part of chunk.candidates[0].content.parts) {
              if (part.functionCall || (part.text && !part.thought)) {
                modelCandidateParts.push(part);
              }
              if (part.thought) {
                if (onThinking && part.text) {
                  onThinking(part.text);
                }
              } else if (part.text) {
                chunkText += part.text;
              }
            }
          } else if (chunk.text) {
            chunkText = chunk.text;
          }

          if (chunkText) {
            iterationText += chunkText;
            if (onChunk) {
              onChunk(iterationText);
            }
          }

          // Buffer function calls strictly without executing during stream chunks
          const functionCalls = chunk.functionCalls;
          if (functionCalls && Array.isArray(functionCalls)) {
            for (const fc of functionCalls) {
              if (fc.name) {
                const callKey = `${fc.id || ""}:${fc.name}:${JSON.stringify(fc.args || {})}`;
                if (!seenCallKeys.has(callKey)) {
                  seenCallKeys.add(callKey);
                  rawFunctionCalls.push({
                    id: fc.id,
                    name: fc.name,
                    args: fc.args || {},
                  });
                }
              }
            }
          }
        }
      } catch (streamErr: any) {
        console.error(`[GeminiBrain] Streaming error on iteration ${iteration}:`, streamErr);
        if (iteration === 1 && !iterationText && rawFunctionCalls.length === 0) {
          throw new Error(formatGeminiError(streamErr));
        }
        if (!finalAccumulatedText && !iterationText) {
          throw new Error(formatGeminiError(streamErr));
        }
        break;
      }

      if (iterationText.trim()) {
        finalAccumulatedText = iterationText.trim();
      }

      // If no function calls were emitted, the model has completed its thought process and spoken its answer
      if (rawFunctionCalls.length === 0) {
        break;
      }

      // Map raw function calls to structured CompanionCommands
      const iterationCommands: CompanionCommand[] = [];
      for (const fc of rawFunctionCalls) {
        const cmd = this.mapFunctionCallToCommand(fc.name, fc.args);
        if (cmd) {
          iterationCommands.push(cmd);
          allExecutedCommands.push(cmd);
        }
      }

      if (!commandExecutor) {
        break;
      }

      // Execute tools post-stream and gather results
      const toolResponses: BrainPart[] = [];
      for (let i = 0; i < iterationCommands.length; i++) {
        const cmd = iterationCommands[i];
        const fc = rawFunctionCalls[i];
        try {
          const execResult = await commandExecutor(cmd);
          let responseOutput = execResult.output;
          let attachedImageBase64: string | null = null;

          if (
            cmd.type === "capture_screen" &&
            execResult.success &&
            responseOutput.includes("base64,")
          ) {
            attachedImageBase64 = responseOutput.replace(/^data:image\/\w+;base64,/, "");
            responseOutput = "Снимок экрана успешно получен и прикреплен.";
          }

          toolResponses.push({
            functionResponse: {
              id: fc.id,
              name: fc.name,
              response: {
                output: responseOutput,
                success: execResult.success,
              },
            },
          });

          if (attachedImageBase64) {
            toolResponses.push({
              inlineData: {
                mimeType: "image/jpeg",
                data: attachedImageBase64,
              },
            });
          }
        } catch (err: any) {
          toolResponses.push({
            functionResponse: {
              id: fc.id,
              name: fc.name,
              response: {
                error: err?.message || String(err),
                success: false,
              },
            },
          });
        }
      }

      // Construct turns to feed back into model context, preserving thoughtSignature on functionCall parts
      const modelCallTurn: BrainTurn = {
        role: "model",
        parts:
          modelCandidateParts.length > 0
            ? modelCandidateParts
            : [
                ...(iterationText ? [{ text: iterationText }] : []),
                ...rawFunctionCalls.map((fc) => ({
                  functionCall: { id: fc.id, name: fc.name, args: fc.args },
                })),
              ],
      };

      const toolResponseTurn: BrainTurn = {
        role: "user",
        parts: toolResponses,
      };

      currentConversation.push(modelCallTurn);
      currentConversation.push(toolResponseTurn);

      // If we reached the maximum number of iterations, execute one final non-tool pass to summarize the findings
      if (iteration >= MAX_TOOL_ITERATIONS) {
        try {
          const finalStream = await fetchStreamWithFallback(currentConversation, false);
          let summaryText = "";
          for await (const chunk of finalStream) {
            let chunkText = "";
            if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
              for (const part of chunk.candidates[0].content.parts) {
                if (part.text && !part.thought) {
                  chunkText += part.text;
                }
              }
            } else if (chunk.text) {
              chunkText = chunk.text;
            }
            if (chunkText) {
              summaryText += chunkText;
              if (onChunk) onChunk(summaryText);
            }
          }
          if (summaryText.trim()) {
            finalAccumulatedText = summaryText.trim();
          }
        } catch (finalErr) {
          console.warn("[GeminiBrain] Error in final summary stream:", finalErr);
        }
        break;
      }
    }

    const cleanedFinalResponse =
      finalAccumulatedText.trim() ||
      (allExecutedCommands.some((c) => c.type === "open_url")
        ? "Открыла ссылку! ✨"
        : "Готово! 🚀");

    const finalModelTurn: BrainTurn = {
      role: "model",
      parts: [{ text: cleanedFinalResponse }],
    };

    // Save only clean conversational text turns into persistent history
    this.shortTermHistory.push(userTurn);
    this.shortTermHistory.push(finalModelTurn);
    this.shortTermHistory = this.sanitizeHistory(this.shortTermHistory);

    return { responseText: cleanedFinalResponse, toolCalls: allExecutedCommands };
  }

  /**
   * Compaction with Glitch Reaction:
   * When history reaches threshold (15-25 turns), triggers background LLM summarization,
   * stores key takeaway in SQLite long-term memory, and animates mascot glitch with «Уплотняю память... 🧠».
   */
  private async compactMemory(ai?: GoogleGenAI): Promise<void> {
    if (this.shortTermHistory.length === 0) return;

    try {
      if (this.onMemoryCompactionGlitch) {
        this.onMemoryCompactionGlitch("Уплотняю память... 🧠");
      }

      // If we have at least 8 turns, summarize older turns
      if (this.shortTermHistory.length > 6 && ai) {
        const turnsToSummarize = this.shortTermHistory.slice(0, -6);
        const retainedTurns = this.sanitizeHistory(this.shortTermHistory.slice(-6));

        // Convert turns to transcript for summarization prompt
        const transcript = turnsToSummarize
          .map((turn) => {
            const role = turn.role === "user" ? "User" : "Mascot";
            const textParts = turn.parts
              .filter((p) => p.text)
              .map((p) => p.text)
              .join(" ");
            return `${role}: ${textParts}`;
          })
          .filter((line) => line.length > 5)
          .join("\n");

        if (transcript.length > 20) {
          try {
            const summaryResp = await ai.models.generateContent({
              model: "gemini-3.1-flash-lite",
              contents: `Ты модуль уплотнения памяти персонального ассистента. Сделай предельно краткую выжимку (2-4 предложения) следующего диалога: ключевые темы, предпочтения пользователя и решенные задачи для сохранения в постоянную память.\n\nДиалог:\n${transcript}`,
              config: {
                maxOutputTokens: 256,
                temperature: 0.3,
              },
            });

            const summaryText = summaryResp.text?.trim();
            if (summaryText) {
              console.info("[GeminiBrain] Compaction generated summary:", summaryText);

              // Persist compacted summary into SQLite long-term memory
              if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
                const { invoke } = await import("@tauri-apps/api/core");
                invoke("save_memory_entry", {
                  item: {
                    key: `dialog_summary_${Date.now()}`,
                    category: "summary",
                    content: summaryText,
                    tags: ["summary", "compaction"],
                    updated_at: Math.floor(Date.now() / 1000),
                  },
                }).catch((err) =>
                  console.warn("[GeminiBrain] Failed saving summary to SQLite:", err)
                );
              }

              // Prepend condensed context into shortTermHistory at index 0
              this.shortTermHistory = this.sanitizeHistory([
                {
                  role: "user",
                  parts: [{ text: `[Контекст предыдущего диалога: ${summaryText}]` }],
                },
                {
                  role: "model",
                  parts: [{ text: "Понятно, сохранила контекст в памяти! Продолжаем. 🧠" }],
                },
                ...retainedTurns,
              ]);
              return;
            }
          } catch (sumErr) {
            console.warn(
              "[GeminiBrain] Background summarization failed, falling back to window trim:",
              sumErr
            );
          }
        }
      }

      // Fallback: Keep last 6 turns
      this.shortTermHistory = this.sanitizeHistory(this.shortTermHistory.slice(-6));

      console.info(`[GeminiBrain] Context pruned. Active turns: ${this.shortTermHistory.length}`);
    } catch (e) {
      console.warn("[GeminiBrain] Compaction error:", e);
    }
  }

  private mapFunctionCallToCommand(name: string, args: any): CompanionCommand | null {
    const id = `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = Date.now();
    const safeArgs = args || {};

    switch (name) {
      case "open_url":
        return {
          id,
          timestamp,
          type: "open_url",
          securityLevel: "safe",
          payload: { url: safeArgs.url || "" },
        };
      case "launch_app":
      case "launch_application": {
        const appName =
          safeArgs.appName ||
          safeArgs.app_name ||
          safeArgs.name ||
          safeArgs.application ||
          safeArgs.app ||
          safeArgs.program ||
          safeArgs.target ||
          safeArgs.cmd ||
          safeArgs.binary ||
          "";
        return {
          id,
          timestamp,
          type: "launch_app",
          securityLevel: "safe",
          payload: {
            appName,
            args: Array.isArray(safeArgs.args) ? safeArgs.args : [],
          },
        };
      }
      case "execute_shell":
        return {
          id,
          timestamp,
          type: "execute_shell",
          securityLevel: "destructive",
          payload: {
            command: safeArgs.command || "",
            cwd: safeArgs.cwd,
            explanation: safeArgs.explanation || "",
          },
        };
      case "file_operation":
        return {
          id,
          timestamp,
          type: "file_operation",
          securityLevel:
            safeArgs.action === "delete" || safeArgs.action === "write"
              ? "destructive"
              : "safe",
          payload: {
            action: safeArgs.action || "read",
            path: safeArgs.path || "",
            content: safeArgs.content,
          },
        };
      case "window_perch":
        return {
          id,
          timestamp,
          type: "window_perch",
          securityLevel: "safe",
          payload: { target: safeArgs.target || "active" },
        };
      case "capture_screen":
        return {
          id,
          timestamp,
          type: "capture_screen",
          securityLevel: "safe",
          payload: { reason: safeArgs.reason || "explicit_user_request" },
        };
      case "set_timer":
        return {
          id,
          timestamp,
          type: "set_timer",
          securityLevel: "safe",
          payload: {
            durationSeconds: safeArgs.durationSeconds || 60,
            label: safeArgs.label || "Timer",
          },
        };
      case "save_memory": {
        const cat = safeArgs.category || "fact";
        const key = safeArgs.key || `fact_${Date.now()}`;
        const content = safeArgs.content || "";
        const tags = Array.isArray(safeArgs.tags) ? safeArgs.tags : [];
        return {
          id,
          timestamp,
          type: "save_memory",
          securityLevel: "safe",
          payload: {
            category: cat,
            key,
            content,
            tags,
          },
        };
      }
      default:
        return null;
    }
  }
}
