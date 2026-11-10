/**
 * GNU General Public License v3.0
 * Pre-flight Privacy & Secret Redaction Pipeline
 * Strips tokens, credentials, private paths, and env vars before LLM transmission.
 */

export interface RedactionResult {
  sanitized: string;
  redactionCount: number;
  redactedCategories: Record<string, number>;
}

interface SecretPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

const REDACTION_PATTERNS: SecretPattern[] = [
  // 1. Google Gemini API keys (AIzaSy...)
  {
    name: "Google API Key",
    regex: /AIzaSy[A-Za-z0-9_-]{33}/g,
    replacement: "[REDACTED_GEMINI_KEY]",
  },
  // 2. OpenAI / Anthropic / Groq standard keys
  {
    name: "OpenAI API Key",
    regex: /sk-[a-zA-Z0-9]{20,T3BlbkFJ[a-zA-Z0-9]{20,}/g,
    replacement: "[REDACTED_OPENAI_KEY]",
  },
  {
    name: "Anthropic API Key",
    regex: /sk-ant-api[a-zA-Z0-9_-]{30,}/g,
    replacement: "[REDACTED_ANTHROPIC_KEY]",
  },
  // 3. GitHub Tokens (Personal Access Token, Fine-grained, OAuth)
  {
    name: "GitHub Token",
    regex: /(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  {
    name: "GitHub Fine-Grained Token",
    regex: /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/g,
    replacement: "[REDACTED_GITHUB_PAT]",
  },
  // 4. AWS Access Keys & Secrets
  {
    name: "AWS Access Key",
    regex: /(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  // 5. Generic Bearer Tokens & JWTs
  {
    name: "Bearer Token",
    regex: /Bearer\s+([a-zA-Z0-9\-._~+/]+=*)/gi,
    replacement: "Bearer [REDACTED_BEARER_TOKEN]",
  },
  {
    name: "JSON Web Token",
    regex: /eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g,
    replacement: "[REDACTED_JWT]",
  },
  // 6. Generic Environment Variable Assignments containing sensitive terms
  {
    name: "Sensitive Env Variable",
    regex: /(?:export\s+)?([A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|AUTH)[A-Za-z0-9_]*\s*=\s*)(['"]?)([^'"\r\n\s]+)\2/gi,
    replacement: "$1$2[REDACTED_SECRET]$2",
  },
  // 7. Database & Connection Strings with credentials
  {
    name: "Database Credentials URI",
    regex: /(postgres|mysql|mongodb|redis|amqp|mssql):\/\/([^:\s]+):([^@\s]+)@/gi,
    replacement: "$1://$2:[REDACTED_PASSWORD]@",
  },
  // 8. SSH Private Keys
  {
    name: "Private Key Header",
    regex: /-----BEGIN\s+(?:RSA|OPENSSH|DSA|EC)?\s*PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA|OPENSSH|DSA|EC)?\s*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY_BLOCK]",
  },
  // 9. Absolute Home Directory Paths (Linux & macOS /home/user or /Users/user)
  {
    name: "Unix User Home Path",
    regex: /\/(?:home|Users)\/([a-zA-Z0-9._-]+)(\/[^\s"':;><!&*()]+)?/g,
    replacement: "~$2",
  },
  // 10. Windows User Home Directory Paths (C:\Users\username)
  {
    name: "Windows User Home Path",
    regex: /[A-Za-z]:\\Users\\[a-zA-Z0-9._-]+\\([^\s"':;><!&*()]+)?/g,
    replacement: "%USERPROFILE%\\$1",
  },
];

/**
 * Sanitizes input strings before LLM ingestion.
 * Performs deep regex inspection, masking credentials, private keys, and user home directories.
 */
export function sanitizeForLLM(input: string): string {
  return redactSecrets(input).sanitized;
}

/**
 * Performs detailed redaction and returns metadata regarding stripped secrets.
 */
export function redactSecrets(input: string): RedactionResult {
  if (!input || typeof input !== "string") {
    return { sanitized: "", redactionCount: 0, redactedCategories: {} };
  }

  let text = input;
  let totalCount = 0;
  const categories: Record<string, number> = {};

  for (const pattern of REDACTION_PATTERNS) {
    const matches = text.match(pattern.regex);
    if (matches && matches.length > 0) {
      const matchCount = matches.length;
      totalCount += matchCount;
      categories[pattern.name] = (categories[pattern.name] || 0) + matchCount;
      text = text.replace(pattern.regex, pattern.replacement);
    }
  }

  return {
    sanitized: text,
    redactionCount: totalCount,
    redactedCategories: categories,
  };
}
