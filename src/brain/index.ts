/**
 * GNU General Public License v3.0
 * Unified Multi-Provider AI Brain Layer (Google Gemini + DeepSeek)
 * Dynamically routes prompts and tool execution to the configured provider.
 */

import { GeminiBrain, BrainConfig as GeminiConfig } from "./gemini";
import { DeepSeekBrain, DeepSeekBrainConfig } from "./deepseek";
import { CompanionCommand } from "../types/commands";
import { listen } from "@tauri-apps/api/event";

export type AIProvider = "gemini" | "deepseek";

export interface SystemProfile {
  os_name: string;
  os_version: string;
  desktop_env: string;
  session_type: string;
  user_name: string;
  default_shell: string;
}

export type CommandExecutor = (
  command: CompanionCommand
) => Promise<{ success: boolean; output: string }>;

export interface UnifiedBrainConfig {
  provider?: AIProvider;
  geminiConfig?: GeminiConfig;
  deepseekConfig?: DeepSeekBrainConfig;
}

export class UnifiedBrain {
  private activeProvider: AIProvider;
  private geminiBrain: GeminiBrain;
  private deepseekBrain: DeepSeekBrain;
  private systemProfile?: SystemProfile;
  private unlistenPromise?: Promise<() => void>;

  constructor(
    config: UnifiedBrainConfig = {},
    onMemoryCompactionGlitch?: (summary: string) => void
  ) {
    this.activeProvider = this.readStoredProvider(config.provider);
    this.geminiBrain = new GeminiBrain(config.geminiConfig, onMemoryCompactionGlitch);
    this.deepseekBrain = new DeepSeekBrain(config.deepseekConfig, onMemoryCompactionGlitch);

    // Listen for live provider/settings updates emitted from Dashboard or other windows
    if (typeof window !== "undefined") {
      this.unlistenPromise = listen<{ provider?: AIProvider }>(
        "ai-settings-changed",
        (event) => {
          if (event.payload?.provider) {
            console.log("[UnifiedBrain] Switched AI provider on-the-fly to:", event.payload.provider);
            this.activeProvider = event.payload.provider;
          } else {
            this.activeProvider = this.readStoredProvider();
          }
        }
      );

      // Local CustomEvent listener for same-window updates
      window.addEventListener("ai-settings-changed", ((e: CustomEvent) => {
        if (e.detail?.provider) {
          this.activeProvider = e.detail.provider;
        } else {
          this.activeProvider = this.readStoredProvider();
        }
      }) as EventListener);
    }
  }

  private readStoredProvider(defaultProvider: AIProvider = "gemini"): AIProvider {
    if (typeof window === "undefined") return defaultProvider;
    const stored = localStorage.getItem("ai_provider");
    if (stored === "deepseek" || stored === "gemini") {
      return stored;
    }
    return defaultProvider;
  }

  public getActiveProvider(): AIProvider {
    // Dynamic read ensures immediate reactivity even without event delivery
    return this.readStoredProvider(this.activeProvider);
  }

  public setActiveProvider(provider: AIProvider): void {
    this.activeProvider = provider;
    if (typeof window !== "undefined") {
      localStorage.setItem("ai_provider", provider);
    }
  }

  public setSystemProfile(profile: SystemProfile): void {
    this.systemProfile = profile;
    this.geminiBrain.setSystemProfile(profile);
    this.deepseekBrain.setSystemProfile(profile);
  }

  public getSystemProfile(): SystemProfile | undefined {
    return this.systemProfile;
  }

  /**
   * Sends prompt using the currently active AI provider (Gemini or DeepSeek)
   */
  public async sendPrompt(
    rawPrompt: string,
    imageAttachmentBase64?: string,
    onChunk?: (accumulatedText: string) => void,
    commandExecutor?: CommandExecutor,
    onThinking?: (thoughtText: string) => void
  ): Promise<{ responseText: string; toolCalls: CompanionCommand[] }> {
    const provider = this.getActiveProvider();

    if (provider === "deepseek") {
      return await this.deepseekBrain.sendPrompt(
        rawPrompt,
        imageAttachmentBase64,
        onChunk,
        commandExecutor,
        onThinking
      );
    } else {
      return await this.geminiBrain.sendPrompt(
        rawPrompt,
        imageAttachmentBase64,
        onChunk,
        commandExecutor,
        onThinking
      );
    }
  }

  /**
   * Tests connection to the selected provider with a lightweight ping
   */
  public static async testConnection(
    provider: AIProvider,
    apiKey: string,
    modelName?: string,
    baseUrl?: string
  ): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    if (provider === "deepseek") {
      return await DeepSeekBrain.testConnection(apiKey, modelName, baseUrl);
    } else {
      return await GeminiBrain.testConnection(apiKey, modelName);
    }
  }

  public destroy(): void {
    if (this.unlistenPromise) {
      this.unlistenPromise.then((unlisten) => unlisten());
    }
  }
}

export { GeminiBrain } from "./gemini";
export { DeepSeekBrain } from "./deepseek";
export { GEMINI_TOOLS, OPENAI_TOOLS } from "./tools";
