/**
 * GNU General Public License v3.0
 * Unified Multi-Provider AI Brain Layer (Google Gemini + DeepSeek)
 * Dynamically routes prompts and tool execution to the configured provider.
 */

import { GeminiBrain, BrainConfig as GeminiConfig } from "./gemini";
import { DeepSeekBrain, DeepSeekBrainConfig } from "./deepseek";
import { listen } from "@tauri-apps/api/event";
import { BrainProvider, CommandExecutor, SendPromptResult } from "./provider";
import { PermissionMode } from "../types/commands";

export * from "./provider";
export type { PermissionMode };

export type AIProvider = "gemini" | "deepseek";

export interface SystemProfile {
  os_name: string;
  os_version: string;
  desktop_env: string;
  session_type: string;
  user_name: string;
  default_shell: string;
}

export interface UnifiedBrainConfig {
  provider?: AIProvider;
  permissionMode?: PermissionMode;
  geminiConfig?: GeminiConfig;
  deepseekConfig?: DeepSeekBrainConfig;
}

export class UnifiedBrain implements BrainProvider {
  private activeProvider: AIProvider;
  private permissionMode: PermissionMode;
  private geminiBrain: GeminiBrain;
  private deepseekBrain: DeepSeekBrain;
  private systemProfile?: SystemProfile;
  private unlistenPromise?: Promise<() => void>;
  private unlistenPermissionPromise?: Promise<() => void>;

  constructor(
    config: UnifiedBrainConfig = {},
    onMemoryCompactionGlitch?: (summary: string) => void
  ) {
    this.activeProvider = this.readStoredProvider(config.provider);
    this.permissionMode = this.readStoredPermissionMode(config.permissionMode);
    this.geminiBrain = new GeminiBrain(
      { permissionMode: this.permissionMode, ...config.geminiConfig },
      onMemoryCompactionGlitch
    );
    this.deepseekBrain = new DeepSeekBrain(
      { permissionMode: this.permissionMode, ...config.deepseekConfig },
      onMemoryCompactionGlitch
    );

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

      this.unlistenPermissionPromise = listen<PermissionMode>(
        "permission-mode-changed",
        (event) => {
          if (event.payload) {
            console.log("[UnifiedBrain] Switched permission mode on-the-fly to:", event.payload);
            this.setPermissionMode(event.payload);
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

      window.addEventListener("permission-mode-changed", ((e: CustomEvent) => {
        if (e.detail) {
          this.setPermissionMode(e.detail);
        }
      }) as EventListener);
    }
  }

  private readStoredPermissionMode(defaultMode: PermissionMode = "ask"): PermissionMode {
    if (typeof window === "undefined") return defaultMode;
    const stored = localStorage.getItem("companion_permission_mode");
    if (stored === "safe" || stored === "ask" || stored === "full") {
      return stored;
    }
    return defaultMode;
  }

  public getPermissionMode(): PermissionMode {
    return this.readStoredPermissionMode(this.permissionMode);
  }

  public setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
    this.geminiBrain.setPermissionMode(mode);
    this.deepseekBrain.setPermissionMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("companion_permission_mode", mode);
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
   * Clears conversational short-term memory across both providers
   */
  public clearHistory(): void {
    this.geminiBrain.clearHistory();
    this.deepseekBrain.clearHistory();
  }

  /**
   * Synchronizes recent chat turns into both provider brains
   */
  public syncHistory(messages: Array<{ role: "user" | "companion"; text: string }>): void {
    this.geminiBrain.syncHistory(messages);
    this.deepseekBrain.syncHistory(messages);
  }

  /**
   * Sends prompt using the currently active AI provider (Gemini or DeepSeek)
   */
  public async sendPrompt(
    rawPrompt: string,
    imageBase64?: string,
    onChunk?: (accumulatedText: string) => void,
    commandExecutor?: CommandExecutor,
    onThinking?: (thoughtText: string) => void
  ): Promise<SendPromptResult> {
    const provider = this.getActiveProvider();

    if (provider === "deepseek") {
      return await this.deepseekBrain.sendPrompt(
        rawPrompt,
        imageBase64,
        onChunk,
        commandExecutor,
        onThinking
      );
    } else {
      return await this.geminiBrain.sendPrompt(
        rawPrompt,
        imageBase64,
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
    if (this.unlistenPermissionPromise) {
      this.unlistenPermissionPromise.then((unlisten) => unlisten());
    }
  }
}

export { GeminiBrain } from "./gemini";
export { DeepSeekBrain } from "./deepseek";
export { GEMINI_TOOLS, OPENAI_TOOLS } from "./tools";
