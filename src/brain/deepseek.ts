/**
 * GNU General Public License v3.0
 * Direct DeepSeek API Integration (OpenAI-compatible chat completions)
 * Supports real-time streaming, DeepSeek Reasoner thinking tokens,
 * companion tool calling, and dynamic key resolution.
 */

import { sanitizeForLLM } from "./sanitizer";
import { CompanionCommand } from "../types/commands";
import { OPENAI_TOOLS } from "./tools";

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
  content?: string | null;
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
  systemProfile?: SystemProfile;
  maxShortTermHistoryTurns?: number;
}

export type CommandExecutor = (
  command: CompanionCommand
) => Promise<{ success: boolean; output: string }>;

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
    return "Неверный API ключ DeepSeek. Проверьте ключ в настройках (⚙️).";
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

export class DeepSeekBrain {
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
      throw new Error("DeepSeek API key is missing. Click the settings gear (⚙️) to add it.");
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

  private getSystemPrompt(): string {
    const user = this.config.userName || this.config.systemProfile?.user_name || "friend";
    const profile = this.config.systemProfile;

    const envHeader = profile
      ? `System Environment:
- OS: ${profile.os_name} ${profile.os_version} (${profile.session_type}, ${profile.desktop_env})
- Shell: ${profile.default_shell}
- User: ${user}
`
      : "";

    return `${envHeader}You are a cute anime companion mascot living on ${user}'s desktop.
BREVITY CONSTRAINT (STRICT): You must ALWAYS respond in 1 to 2 concise sentences maximum.
Respond in the language the user speaks (e.g. Russian if user speaks Russian).
Never write long paragraphs or markdown bullet lists in standard chat.
Your responses are displayed in a compact floating speech bubble and read aloud by TTS.
Be playful, warm, cute, observant, intelligent, and helpful.

ACTIONS & TOOLS (ROLE AS SEMANTIC BRAIN):
You control the user's desktop computer via tools.
1. SLANG, ABBREVIATIONS & SYNONYM NORMALIZATION:
   As the intelligent semantic brain, understand all colloquialisms, slang, abbreviations, and informal names in any language (e.g. Russian: "телега", "тг" -> "Telegram"; "хром", "браузер", "интернет" -> "browser"; "терминал", "консоль", "командная строка" -> "terminal"; "код", "вскод" -> "code"; "стим" -> "steam"; "дискорд" -> "discord").
   ALWAYS normalize user requests into canonical entity names when invoking launch_app:
   - appName: "Telegram" (for Telegram / телега / тг)
   - appName: "browser" (for default browser / хром / браузер)
   - appName: "terminal" (for console / terminal / консоль)
   - Or standard application names: "code", "discord", "steam", "spotify", etc.
2. TERMINAL COMMANDS & DIAGNOSTICS:
   When the user asks to execute a command, scan, or script in the terminal/console (e.g. "выполни nmap скан машины", "запусти ping", "проверь сеть", "запусти команду в терминале"):
   Call launch_app with appName: "terminal" and the command in args: ["<command>"].
   The OS controller automatically launches the system's default terminal ($TERMINAL, Windows Terminal, Terminal.app) and keeps the interactive console open after execution so the user can inspect output and run further commands.
3. OPENING LINKS & SITES:
   When the user asks to open any website, video, music, or link (e.g. "открой ютуб", "open youtube", "найди в гугле"), call open_url with the full URL (e.g. 'https://www.youtube.com', 'https://github.com', 'https://google.com').
4. Call tools whenever relevant. After receiving the tool execution result, give a cute, cheerful 1-sentence confirmation.`;
  }

  public async sendPrompt(
    rawPrompt: string,
    _imageAttachmentBase64?: string,
    onChunk?: (accumulatedText: string) => void,
    commandExecutor?: CommandExecutor,
    onThinking?: (thoughtText: string) => void
  ): Promise<{ responseText: string; toolCalls: CompanionCommand[] }> {
    const apiKey = this.getApiKey();
    const model = this.getModelName();
    const baseUrl = this.getBaseUrl();
    const isReasoner = model.includes("reasoner");

    const sanitizedPrompt = sanitizeForLLM(rawPrompt);

    // Prune history if needed
    if (this.shortTermHistory.length >= (this.config.maxShortTermHistoryTurns || 20)) {
      if (this.onMemoryCompactionGlitch) {
        this.onMemoryCompactionGlitch("Compacting context...");
      }
      this.shortTermHistory = this.shortTermHistory.slice(-8);
    }

    const systemInstruction = this.getSystemPrompt();
    const userMessage: DeepSeekMessage = { role: "user", content: sanitizedPrompt };

    const messagesToSend: DeepSeekMessage[] = [
      { role: "system", content: systemInstruction },
      ...this.shortTermHistory,
      userMessage,
    ];

    // Build fetch stream
    const executeChatStream = async (reqMessages: DeepSeekMessage[]) => {
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
      if (!isReasoner) {
        payload.tools = OPENAI_TOOLS;
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

    let accumulatedText = "";
    let accumulatedThoughts = "";
    const rawToolCallsMap: Record<
      number,
      { id: string; type: "function"; function: { name: string; arguments: string } }
    > = {};

    let response: Response;
    try {
      response = await executeChatStream(messagesToSend);
    } catch (err: any) {
      console.error("[DeepSeekBrain] Request error:", err);
      throw new Error(formatDeepSeekError(err));
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body received from DeepSeek API.");

    const decoder = new TextDecoder();
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
      console.error("[DeepSeekBrain] Stream reading error:", streamErr);
      if (!accumulatedText && Object.keys(rawToolCallsMap).length === 0) {
        throw new Error(formatDeepSeekError(streamErr));
      }
    }

    const toolCallsList = Object.values(rawToolCallsMap);

    // If no tool calls were generated, pure conversational turn
    if (toolCallsList.length === 0) {
      const finalText = accumulatedText.trim();
      this.shortTermHistory.push(userMessage);
      this.shortTermHistory.push({ role: "assistant", content: finalText });
      return { responseText: finalText, toolCalls: [] };
    }

    // Map tool calls to CompanionCommand
    const commands: CompanionCommand[] = [];
    for (const tc of toolCallsList) {
      let argsObj: any = {};
      try {
        argsObj = JSON.parse(tc.function.arguments || "{}");
      } catch {
        console.warn("[DeepSeekBrain] Malformed tool arguments:", tc.function.arguments);
      }
      const cmd = this.mapFunctionCallToCommand(tc.function.name, argsObj);
      if (cmd) {
        commands.push(cmd);
      }
    }

    if (!commandExecutor) {
      this.shortTermHistory.push(userMessage);
      this.shortTermHistory.push({
        role: "assistant",
        content: accumulatedText.trim() || null,
        tool_calls: toolCallsList,
      });
      return { responseText: accumulatedText.trim(), toolCalls: commands };
    }

    // Execute tools and build tool responses
    const assistantToolCallMessage: DeepSeekMessage = {
      role: "assistant",
      content: accumulatedText.trim() || null,
      tool_calls: toolCallsList,
    };

    const toolResponseMessages: DeepSeekMessage[] = [];
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const tc = toolCallsList[i];
      try {
        const execRes = await commandExecutor(cmd);
        toolResponseMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ success: execRes.success, output: execRes.output }),
        });
      } catch (err: any) {
        toolResponseMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ success: false, error: err?.message || String(err) }),
        });
      }
    }

    // Follow-up call so the model speaks the final friendly response
    const followUpMessages: DeepSeekMessage[] = [
      ...messagesToSend,
      assistantToolCallMessage,
      ...toolResponseMessages,
    ];

    let followUpText = "";
    try {
      const followUpResponse = await executeChatStream(followUpMessages);
      const followUpReader = followUpResponse.body?.getReader();
      if (followUpReader) {
        let fBuffer = "";
        while (true) {
          const { done, value } = await followUpReader.read();
          if (done) break;
          fBuffer += decoder.decode(value, { stream: true });
          const fLines = fBuffer.split("\n");
          fBuffer = fLines.pop() || "";

          for (const line of fLines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6));
                const content = data.choices?.[0]?.delta?.content;
                if (content) {
                  followUpText += content;
                  if (onChunk) {
                    onChunk(followUpText);
                  }
                }
              } catch {}
            }
          }
        }
      }
    } catch (fErr) {
      console.warn("[DeepSeekBrain] Follow-up stream error:", fErr);
    }

    const finalResponse =
      followUpText.trim() ||
      accumulatedText.trim() ||
      (commands.some((c) => c.type === "open_url")
        ? "Открыла ссылку! ✨"
        : "Готово! 🚀");

    // Commit to conversation history
    this.shortTermHistory.push(userMessage);
    this.shortTermHistory.push(assistantToolCallMessage);
    this.shortTermHistory.push(...toolResponseMessages);
    this.shortTermHistory.push({ role: "assistant", content: finalResponse });

    return { responseText: finalResponse, toolCalls: commands };
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
      default:
        return null;
    }
  }
}
