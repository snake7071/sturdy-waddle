/**
 * GNU General Public License v3.0
 * Direct DeepSeek API Integration (OpenAI-compatible chat completions)
 * Supports real-time streaming, DeepSeek Reasoner thinking tokens,
 * companion tool calling, and dynamic key resolution.
 */

import { sanitizeForLLM } from "./sanitizer";
import { CompanionCommand } from "../types/commands";
import { OPENAI_TOOLS } from "./tools";
import { BrainProvider, CommandExecutor, SendPromptResult } from "./provider";

export interface SystemProfile {
  os_name: string;
  os_version: string;
  desktop_env: string;
  session_type: string;
  user_name: string;
  default_shell: string;
}

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | any[] | null;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface DeepSeekBrainConfig {
  modelName?: string;
  baseUrl?: string;
  userName?: string;
  persona?: string;
  systemProfile?: SystemProfile;
  maxShortTermHistoryTurns?: number;
}

export type { CommandExecutor };

export function formatDeepSeekError(err: any): string {
  if (!err) return "DeepSeek AI servers are busy. Please try again in a few seconds.";
  const rawMessage = typeof err === "string" ? err : err.message || String(err);
  let parsedMsg = rawMessage;

  const jsonMatch = rawMessage.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error?.message) {
        parsedMsg = parsed.error.message;
      }
    } catch {}
  }

  const lower = parsedMsg.toLowerCase();
  if (
    lower.includes("401") ||
    lower.includes("invalid api key") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized")
  ) {
    return "Неверный API ключ DeepSeek. Проверьте ключ в настройках.";
  }
  if (
    lower.includes("402") ||
    lower.includes("insufficient balance") ||
    lower.includes("payment required")
  ) {
    return "Недостаточно средств на балансе аккаунта DeepSeek. Пополните баланс на platform.deepseek.com.";
  }
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  ) {
    return "Превышен лимит запросов к DeepSeek API. Попробуйте через несколько секунд.";
  }
  if (
    lower.includes("503") ||
    lower.includes("overloaded") ||
    lower.includes("server error") ||
    lower.includes("unavailable")
  ) {
    return "Серверы DeepSeek временно перегружены. Попробуйте снова через минуту.";
  }

  const clean = parsedMsg.replace(/\{.*?\}|\[.*?\]/g, "").replace(/\s+/g, " ").trim();
  return clean || "DeepSeek servers are busy. Please try again.";
}

export class DeepSeekBrain implements BrainProvider {
  private shortTermHistory: DeepSeekMessage[] = [];
  private config: DeepSeekBrainConfig;
  private onMemoryCompactionGlitch?: (summary: string) => void;

  constructor(
    config: DeepSeekBrainConfig = {},
    onMemoryCompactionGlitch?: (summary: string) => void
  ) {
    this.config = {
      modelName: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      maxShortTermHistoryTurns: 20,
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

  public getApiKey(): string {
    const localKey = typeof window !== "undefined" ? localStorage.getItem("deepseek_api_key") : null;
    const envKey = (import.meta as any).env?.VITE_DEEPSEEK_API_KEY;
    const apiKey = (localKey && localKey.trim()) || (envKey && envKey.trim()) || "";

    if (!apiKey) {
      throw new Error("DeepSeek API key is missing. Open settings to add it.");
    }

    return apiKey;
  }

  public getModelName(): string {
    const saved = typeof window !== "undefined" ? localStorage.getItem("deepseek_model_name") : null;
    return (saved && saved.trim()) || this.config.modelName || "deepseek-chat";
  }

  public getBaseUrl(): string {
    const saved = typeof window !== "undefined" ? localStorage.getItem("deepseek_base_url") : null;
    const base = (saved && saved.trim()) || this.config.baseUrl || "https://api.deepseek.com";
    return base.replace(/\/+$/, "");
  }

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
NO EMOJIS CONSTRAINT (STRICT): NEVER use emojis, emoticons, or icons in your responses under any circumstances. Always write clean, plain text without any emojis.
Your responses are displayed in a compact floating speech bubble and read aloud by TTS.${memorySection}

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
     * However, if after trying multiple sensible attempts nothing is found or possible, politely explain in 1-2 sentences that you couldn't find or complete it.
7. VISION & SCREEN AWARENESS:
   When an image/screenshot is attached to the user's prompt (Vision Mode), you have direct visual sight of the user's screen.
   - Carefully examine the visual content of the screenshot to answer questions about what is visible, open windows, text, code, or desktop layout.
   - You have true multimodal vision — describe what you see directly! Never claim you cannot see the image or that you only see file size when an image is provided.
   - Do NOT invoke 'capture_screen' if a screenshot is already attached to the prompt.`;
  }

  /**
   * Sanitizes conversation history for OpenAI/DeepSeek chat completions API:
   * 1. Preserves only clean conversational turns (user -> assistant text).
   * 2. Eliminates ephemeral tool_calls and tool response messages from long-term history.
   * 3. Enforces valid role alternation (user -> assistant -> user -> assistant).
   * 4. Guarantees no orphaned messages or tool role violations can reach the API.
   */
  private sanitizeHistory(messages: DeepSeekMessage[]): DeepSeekMessage[] {
    const clean: DeepSeekMessage[] = [];

    for (const m of messages) {
      if (m.role === "system") continue;
      // Strip old tool responses from persistent history
      if (m.role === "tool") continue;

      if (m.role === "user") {
        const text = typeof m.content === "string"
          ? m.content.trim()
          : Array.isArray(m.content)
          ? m.content.map((c: any) => (typeof c === "string" ? c : c.text || "")).join(" ").trim()
          : "";
        if (text) {
          if (clean.length > 0 && clean[clean.length - 1].role === "user") {
            clean[clean.length - 1].content += `\n${text}`;
          } else {
            clean.push({ role: "user", content: text });
          }
        }
      } else if (m.role === "assistant") {
        const text = typeof m.content === "string" ? m.content.trim() : "";
        if (text) {
          if (clean.length > 0 && clean[clean.length - 1].role === "assistant") {
            clean[clean.length - 1].content += `\n${text}`;
          } else {
            // Strip tool_calls property so OpenAI/DeepSeek API doesn't require tool responses
            clean.push({ role: "assistant", content: text });
          }
        }
      }
    }

    // Must start with user
    while (clean.length > 0 && clean[0].role !== "user") {
      clean.shift();
    }

    // Must end with assistant (since incoming prompt adds the next user message)
    while (clean.length > 0 && clean[clean.length - 1].role !== "assistant") {
      clean.pop();
    }

    return clean;
  }

  public async sendPrompt(
    rawPrompt: string,
    imageBase64?: string,
    onChunk?: (accumulatedText: string) => void,
    commandExecutor?: CommandExecutor,
    onThinking?: (thoughtText: string) => void
  ): Promise<SendPromptResult> {
    const apiKey = this.getApiKey();
    const model = this.getModelName();
    const baseUrl = this.getBaseUrl();
    const isReasoner = model.includes("reasoner");

    const sanitizedPrompt = sanitizeForLLM(rawPrompt);

    // 1. Fetch relevant persistent memory & user preferences from SQLite via Rust IPC
    let memoryContext = "";
    try {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        memoryContext = await invoke<string>("get_relevant_memory_context", {
          query: sanitizedPrompt,
        });
      }
    } catch (e) {
      console.warn("[DeepSeekBrain] Could not query SQLite memory context:", e);
    }

    // Ensure historical messages are strictly valid before checking compaction
    this.shortTermHistory = this.sanitizeHistory(this.shortTermHistory);

    // 2. Sliding window check & Compaction Trigger (15-25 turns)
    const maxTurns = this.config.maxShortTermHistoryTurns || 20;
    if (this.shortTermHistory.length >= maxTurns) {
      if (this.onMemoryCompactionGlitch) {
        this.onMemoryCompactionGlitch("Уплотняю память...");
      }

      // If we have accumulated turns, perform background summarization
      if (this.shortTermHistory.length > 6) {
        const turnsToSummarize = this.shortTermHistory.slice(0, -6);
        const retainedTurns = this.sanitizeHistory(this.shortTermHistory.slice(-6));

        const transcript = turnsToSummarize
          .map((m) => `${m.role === "user" ? "User" : "Mascot"}: ${m.content || ""}`)
          .filter((line) => line.length > 5)
          .join("\n");

        if (transcript.length > 20) {
          try {
            const sumResp = await fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                  {
                    role: "user",
                    content: `Ты модуль уплотнения памяти персонального ассистента. Сделай предельно краткую выжимку (2-4 предложения) следующего диалога: ключевые темы, предпочтения пользователя и решенные задачи для сохранения в постоянную память.\n\nДиалог:\n${transcript}`,
                  },
                ],
                max_tokens: 256,
                temperature: 0.3,
              }),
            });

            if (sumResp.ok) {
              const sumJson = await sumResp.json();
              const summaryText = sumJson.choices?.[0]?.message?.content?.trim();
              if (summaryText) {
                console.info("[DeepSeekBrain] Compaction generated summary:", summaryText);

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
                    console.warn("[DeepSeekBrain] Failed saving summary to SQLite:", err)
                  );
                }

                this.shortTermHistory = this.sanitizeHistory([
                  {
                    role: "user",
                    content: `[Контекст предыдущего диалога: ${summaryText}]`,
                  },
                  {
                    role: "assistant",
                    content: "Понятно, сохранила контекст в памяти! Продолжаем.",
                  },
                  ...retainedTurns,
                ]);
              } else {
                this.shortTermHistory = retainedTurns;
              }
            } else {
              this.shortTermHistory = retainedTurns;
            }
          } catch (e) {
            console.warn("[DeepSeekBrain] Background summarization failed:", e);
            this.shortTermHistory = retainedTurns;
          }
        } else {
          this.shortTermHistory = retainedTurns;
        }
      } else {
        this.shortTermHistory = this.sanitizeHistory(this.shortTermHistory.slice(-6));
      }
    }

    const systemInstruction = this.getSystemPrompt(memoryContext);
    let userContent: any = sanitizedPrompt;
    if (imageBase64) {
      const formattedUrl = imageBase64.startsWith("data:")
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;
      userContent = [
        { type: "text", text: sanitizedPrompt },
        { type: "image_url", image_url: { url: formattedUrl } },
      ];
    }
    const userMessage: DeepSeekMessage = { role: "user", content: userContent };

    const messagesToSend: DeepSeekMessage[] = [
      { role: "system", content: systemInstruction },
      ...this.shortTermHistory,
      userMessage,
    ];

    // Build fetch stream
    const executeChatStream = async (reqMessages: DeepSeekMessage[], allowTools: boolean = true) => {
      const payload: any = {
        model,
        messages: reqMessages.map((m) => {
          const item: any = { role: m.role, content: m.content ?? "" };
          if (m.tool_calls) item.tool_calls = m.tool_calls;
          if (m.tool_call_id) item.tool_call_id = m.tool_call_id;
          return item;
        }),
        stream: true,
      };

      // Tools supported primarily on deepseek-chat
      if (!isReasoner && allowTools) {
        payload.tools = imageBase64
          ? OPENAI_TOOLS.filter((t: any) => t.function.name !== "capture_screen")
          : OPENAI_TOOLS;
        payload.temperature = 0.7;
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let errBody = "";
        try {
          errBody = await response.text();
        } catch {}
        throw new Error(formatDeepSeekError(`HTTP ${response.status}: ${errBody}`));
      }

      return response;
    };

    // Multi-turn Agentic ReAct Loop: allows model to evaluate tool outputs and try alternative attempts
    const MAX_TOOL_ITERATIONS = 5;
    let iteration = 0;
    const allExecutedCommands: CompanionCommand[] = [];
    const currentReqMessages: DeepSeekMessage[] = [...messagesToSend];
    let finalResponseText = "";
    const decoder = new TextDecoder();

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      let accumulatedText = "";
      let accumulatedThoughts = "";
      const rawToolCallsMap: Record<
        number,
        { id: string; type: "function"; function: { name: string; arguments: string } }
      > = {};

      let response: Response;
      try {
        response = await executeChatStream(currentReqMessages, true);
      } catch (err: any) {
        console.error(`[DeepSeekBrain] Request error on iteration ${iteration}:`, err);
        if (iteration === 1) {
          throw new Error(formatDeepSeekError(err));
        }
        break;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body received from DeepSeek API.");

      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (trimmed === "data: [DONE]") break;
            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                const choice = data.choices?.[0];
                if (!choice) continue;

                const delta = choice.delta;
                if (delta) {
                  // Reasoning content for DeepSeek-R1
                  if (delta.reasoning_content) {
                    accumulatedThoughts += delta.reasoning_content;
                    if (onThinking) {
                      onThinking(accumulatedThoughts);
                    }
                  }

                  // Regular visible content
                  if (delta.content) {
                    accumulatedText += delta.content;
                    if (onChunk) {
                      onChunk(accumulatedText);
                    }
                  }

                  // Tool calls in stream
                  if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                      const idx = tc.index ?? 0;
                      if (!rawToolCallsMap[idx]) {
                        rawToolCallsMap[idx] = {
                          id: tc.id || `call_${Date.now()}_${idx}`,
                          type: "function",
                          function: {
                            name: tc.function?.name || "",
                            arguments: tc.function?.arguments || "",
                          },
                        };
                      } else {
                        if (tc.id) rawToolCallsMap[idx].id = tc.id;
                        if (tc.function?.name) rawToolCallsMap[idx].function.name += tc.function.name;
                        if (tc.function?.arguments)
                          rawToolCallsMap[idx].function.arguments += tc.function.arguments;
                      }
                    }
                  }
                }
              } catch {
                // ignore partial chunk json errors
              }
            }
          }
        }
      } catch (streamErr: any) {
        console.error(`[DeepSeekBrain] Stream reading error on iteration ${iteration}:`, streamErr);
        if (iteration === 1 && !accumulatedText && Object.keys(rawToolCallsMap).length === 0) {
          throw new Error(formatDeepSeekError(streamErr));
        }
      }

      if (accumulatedText.trim()) {
        finalResponseText = accumulatedText.trim();
      }

      const toolCallsList = Object.values(rawToolCallsMap);

      // If no tool calls were generated, pure conversational turn
      if (toolCallsList.length === 0) {
        break;
      }

      // Map tool calls to CompanionCommand
      const iterationCommands: CompanionCommand[] = [];
      for (const tc of toolCallsList) {
        let argsObj: any = {};
        try {
          argsObj = JSON.parse(tc.function.arguments || "{}");
        } catch {
          console.warn("[DeepSeekBrain] Malformed tool arguments:", tc.function.arguments);
        }
        const cmd = this.mapFunctionCallToCommand(tc.function.name, argsObj);
        if (cmd) {
          iterationCommands.push(cmd);
          allExecutedCommands.push(cmd);
        }
      }

      if (!commandExecutor) {
        break;
      }

      // Execute tools and build tool responses
      const assistantToolCallMessage: DeepSeekMessage = {
        role: "assistant",
        content: accumulatedText.trim() || null,
        tool_calls: toolCallsList,
      };

      const toolResponseMessages: DeepSeekMessage[] = [];
      let capturedScreenshotBase64: string | null = null;
      for (let i = 0; i < iterationCommands.length; i++) {
        const cmd = iterationCommands[i];
        const tc = toolCallsList[i];
        try {
          const execRes = await commandExecutor(cmd);
          let outputText = execRes.output;
          if (cmd.type === "capture_screen" && execRes.success && outputText.includes("base64,")) {
            capturedScreenshotBase64 = outputText;
            outputText = "Снимок экрана успешно сделан и прикреплен.";
          }
          toolResponseMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ success: execRes.success, output: outputText }),
          });
        } catch (err: any) {
          toolResponseMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ success: false, error: err?.message || String(err) }),
          });
        }
      }

      currentReqMessages.push(assistantToolCallMessage);
      currentReqMessages.push(...toolResponseMessages);

      if (capturedScreenshotBase64) {
        currentReqMessages.push({
          role: "user",
          content: [
            { type: "text", text: "Вот снимок экрана, который был только что захвачен. Изучи его и ответь на мой вопрос." },
            { type: "image_url", image_url: { url: capturedScreenshotBase64 } },
          ],
        });
      }

      // If reached maximum iterations, execute one final non-tool pass to summarize the findings
      if (iteration >= MAX_TOOL_ITERATIONS) {
        try {
          const finalResp = await executeChatStream(currentReqMessages, false);
          const fReader = finalResp.body?.getReader();
          if (fReader) {
            let fBuf = "";
            let summaryText = "";
            while (true) {
              const { done, value } = await fReader.read();
              if (done) break;
              fBuf += decoder.decode(value, { stream: true });
              const fLines = fBuf.split("\n");
              fBuf = fLines.pop() || "";
              for (const line of fLines) {
                const tr = line.trim();
                if (!tr || tr === "data: [DONE]" || !tr.startsWith("data: ")) continue;
                try {
                  const d = JSON.parse(tr.slice(6));
                  const cnt = d.choices?.[0]?.delta?.content;
                  if (cnt) {
                    summaryText += cnt;
                    if (onChunk) onChunk(summaryText);
                  }
                } catch {}
              }
            }
            if (summaryText.trim()) {
              finalResponseText = summaryText.trim();
            }
          }
        } catch (e) {
          console.warn("[DeepSeekBrain] Error in final summary stream:", e);
        }
        break;
      }
    }

    const finalResponse =
      finalResponseText.trim() ||
      (allExecutedCommands.some((c) => c.type === "open_url")
        ? "Ссылка открыта."
        : "Готово.");

    // Commit only clean conversational messages to persistent history
    this.shortTermHistory.push(userMessage);
    this.shortTermHistory.push({ role: "assistant", content: finalResponse });
    this.shortTermHistory = this.sanitizeHistory(this.shortTermHistory);

    return { responseText: finalResponse, toolCalls: allExecutedCommands };
  }

  /**
   * Tests connection to DeepSeek API with a fast lightweight ping
   */
  public static async testConnection(
    apiKey: string,
    modelName?: string,
    baseUrl?: string
  ): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    const trimmedKey = (apiKey || "").trim();
    if (!trimmedKey) {
      return { success: false, message: "API ключ DeepSeek не указан." };
    }
    const model = (modelName || "deepseek-chat").trim();
    const base = ((baseUrl || "https://api.deepseek.com").trim()).replace(/\/+$/, "");

    const startTime = Date.now();
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${trimmedKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 2,
        }),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        let errText = "";
        try {
          errText = await response.text();
        } catch {}
        return {
          success: false,
          message: formatDeepSeekError(`HTTP ${response.status}: ${errText}`),
        };
      }

      return {
        success: true,
        message: `Подключение к DeepSeek успешно! Задержка: ${latencyMs}ms (${model})`,
        latencyMs,
      };
    } catch (err: any) {
      return {
        success: false,
        message: formatDeepSeekError(err),
      };
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
