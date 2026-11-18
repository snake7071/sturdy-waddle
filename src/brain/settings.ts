/**
 * GNU General Public License v3.0
 * Advanced generation settings shared by both AI providers.
 *
 * These are persisted in localStorage so they apply on the next request without a
 * restart, and are surfaced in the Dashboard under "Advanced Settings". Normal users
 * keep the defaults; the values here are only read on each request.
 */

export const ADVANCED_DEFAULTS = {
  temperature: 0.7,
  maxOutputTokens: 2048,
} as const;

export const ADVANCED_LIMITS = {
  temperature: { min: 0, max: 1.5 },
  maxOutputTokens: { min: 128, max: 8192 },
} as const;

function readNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Sampling temperature for the main chat response (clamped to the allowed range). */
export function getTemperature(): number {
  return readNumber(
    "companion_temperature",
    ADVANCED_DEFAULTS.temperature,
    ADVANCED_LIMITS.temperature.min,
    ADVANCED_LIMITS.temperature.max
  );
}

/** Maximum output tokens for the main chat response (clamped to the allowed range). */
export function getMaxOutputTokens(): number {
  return readNumber(
    "companion_max_output_tokens",
    ADVANCED_DEFAULTS.maxOutputTokens,
    ADVANCED_LIMITS.maxOutputTokens.min,
    ADVANCED_LIMITS.maxOutputTokens.max
  );
}
