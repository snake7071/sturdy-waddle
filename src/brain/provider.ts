/**
 * GNU General Public License v3.0
 * AI Brain Provider Interface & Multimodal Contracts
 */

import { CompanionCommand } from "../types/commands";

export type CommandExecutor = (
  command: CompanionCommand
) => Promise<{ success: boolean; output: string }>;

export interface SendPromptResult {
  responseText: string;
  toolCalls: CompanionCommand[];
}

export interface BrainProvider {
  /**
   * Dispatches a prompt with optional image attachment, streaming text chunks,
   * thinking/reasoning updates, and agentic tool execution.
   *
   * @param rawPrompt - User message text
   * @param imageBase64 - Optional Base64-encoded screenshot or image
   * @param onChunk - Callback for real-time text streaming
   * @param commandExecutor - Dispatcher callback for tool execution
   * @param onThinking - Callback for model reasoning/thinking thoughts
   */
  sendPrompt(
    rawPrompt: string,
    imageBase64?: string,
    onChunk?: (accumulatedText: string) => void,
    commandExecutor?: CommandExecutor,
    onThinking?: (thoughtText: string) => void
  ): Promise<SendPromptResult>;
}
