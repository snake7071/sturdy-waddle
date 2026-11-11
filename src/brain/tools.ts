/**
 * GNU General Public License v3.0
 * Gemini Tool Calling Function Declarations
 */

export const GEMINI_TOOLS = [
  {
    name: "open_url",
    description:
      "Opens a web URL or link in the user's default browser (e.g. YouTube, Google, GitHub, VK, Twitch, Wikipedia). Use whenever the user asks to open a site, watch videos, or look up something on the web (e.g. 'открой ютуб', 'open youtube', 'открой гитхаб', 'найди в гугле').",
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description:
            "The full URL to open (e.g. 'https://www.youtube.com', 'https://github.com', 'https://google.com')",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "launch_app",
    description:
      "Launches an installed desktop application, browser, terminal, code editor, or utility on the user's operating system. Use whenever the user asks to open a program or run commands in a terminal/console (e.g. 'открой браузер', 'запусти терминал', 'открой телеграм', 'выполни nmap скан', 'запусти пинг', 'открой код', 'открой стим'). When running terminal commands (scans, diagnostics, scripts), set appName to 'terminal' and pass the command in args. The console window will automatically stay open and interactive after execution so the user can view results and run further commands.",
    parameters: {
      type: "OBJECT",
      properties: {
        appName: {
          type: "STRING",
          description:
            "Binary name or alias of the application (e.g. 'browser', 'terminal', 'telegram', 'firefox', 'kitty', 'code', 'discord', 'spotify', 'steam')",
        },
        args: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Optional command-line arguments or terminal command to execute in the console",
        },
      },
      required: ["appName"],
    },
  },
  {
    name: "window_perch",
    description:
      "Adjusts mascot placement to perch atop the user's currently focused window.",
    parameters: {
      type: "OBJECT",
      properties: {
        target: {
          type: "STRING",
          enum: ["active", "hyprland_focused", "taskbar"],
        },
      },
      required: ["target"],
    },
  },
  {
    name: "capture_screen",
    description:
      "Captures a single screenshot on user demand or error diagnosis.",
    parameters: {
      type: "OBJECT",
      properties: {
        reason: {
          type: "STRING",
          enum: ["explicit_user_request", "husk_build_failure", "context_inspection"],
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "set_timer",
    description: "Sets a desktop timer or reminder.",
    parameters: {
      type: "OBJECT",
      properties: {
        durationSeconds: {
          type: "INTEGER",
          description: "Seconds until trigger",
        },
        label: {
          type: "STRING",
          description: "Reminder description",
        },
      },
      required: ["durationSeconds", "label"],
    },
  },
  {
    name: "execute_shell",
    description:
      "Executes a shell command on the host (e.g. searching for files with find/grep, inspecting directories with ls, checking system state or processes). Returns command stdout/stderr. Safe read commands run automatically; destructive commands require user confirmation. Use this whenever you need to find files, search directories, inspect system details, or verify status before answering.",
    parameters: {
      type: "OBJECT",
      properties: {
        command: {
          type: "STRING",
          description: "The shell command line to run",
        },
        cwd: {
          type: "STRING",
          description: "Target working directory",
        },
        explanation: {
          type: "STRING",
          description: "Short justification shown to user for confirmation",
        },
      },
      required: ["command", "explanation"],
    },
  },
  {
    name: "save_memory",
    description:
      "Saves an important fact, user preference, formatting rule, or project note into permanent long-term memory (SQLite). Call this immediately whenever the user mentions details about themselves, their tech stack, coding preferences (e.g. 'Я пишу бекенд на Rust', 'Не используй эмодзи'), current projects, or instructions to remember.",
    parameters: {
      type: "OBJECT",
      properties: {
        category: {
          type: "STRING",
          enum: ["preference", "fact", "project", "profile"],
          description:
            "Category: 'preference' for behavior rules/formatting/emojis, 'fact' for personal info/facts/tech stack, 'project' for project notes, 'profile' for user identity.",
        },
        key: {
          type: "STRING",
          description:
            "Concise snake_case unique key (e.g. 'backend_rust', 'no_emojis', 'user_role', 'project_companion')",
        },
        content: {
          type: "STRING",
          description: "The exact fact, rule, or preference to remember forever.",
        },
        tags: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Optional list of search tags (e.g. ['rust', 'backend'])",
        },
      },
      required: ["category", "key", "content"],
    },
  },
  {
    name: "hide_companion",
    description:
      "Hides or minimizes the companion mascot from the screen into the system tray when requested by the user (e.g. 'скройся', 'спрячься', 'исчезни', 'уйди', 'hide', 'minimize'). The user can restore the companion anytime via the system tray icon or hotkey.",
    parameters: {
      type: "OBJECT",
      properties: {
        reason: {
          type: "STRING",
          description: "Optional acknowledgement note (e.g. 'скрытие по просьбе пользователя')",
        },
      },
    },
  },
] as const;

/**
 * OpenAI / DeepSeek compatible tool declarations
 */
export const OPENAI_TOOLS = [
  {
    type: "function",
    function: {
      name: "open_url",
      description:
        "Opens a web URL or link in the user's default browser (e.g. YouTube, Google, GitHub, VK, Twitch, Wikipedia). Use whenever the user asks to open a site, watch videos, or look up something on the web.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "The full URL to open (e.g. 'https://www.youtube.com', 'https://github.com', 'https://google.com')",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "launch_app",
      description:
        "Launches an installed desktop application, browser, terminal, code editor, or utility on the user's operating system. Use whenever the user asks to open a program or run commands in a terminal/console (e.g. 'открой браузер', 'запусти терминал', 'открой телеграм', 'выполни nmap скан', 'запусти пинг', 'открой код', 'открой стим'). When running terminal commands (scans, diagnostics, scripts), set appName to 'terminal' and pass the command in args. The console window will automatically stay open and interactive after execution so the user can view results and run further commands.",
      parameters: {
        type: "object",
        properties: {
          appName: {
            type: "string",
            description:
              "Binary name or alias of the application (e.g. 'browser', 'terminal', 'telegram', 'firefox', 'kitty', 'code', 'discord', 'spotify', 'steam')",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional command-line arguments or terminal command to execute in the console",
          },
        },
        required: ["appName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "window_perch",
      description:
        "Adjusts mascot placement to perch atop the user's currently focused window.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: ["active", "hyprland_focused", "taskbar"],
          },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "capture_screen",
      description:
        "Captures a single screenshot on user demand or error diagnosis.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            enum: ["explicit_user_request", "husk_build_failure", "context_inspection"],
          },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_timer",
      description: "Sets a desktop timer or reminder.",
      parameters: {
        type: "object",
        properties: {
          durationSeconds: {
            type: "integer",
            description: "Seconds until trigger",
          },
          label: {
            type: "string",
            description: "Reminder description",
          },
        },
        required: ["durationSeconds", "label"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_shell",
      description:
        "Executes a shell command on the host (e.g. searching for files with find/grep, inspecting directories with ls, checking system state or processes). Returns command stdout/stderr. Safe read commands run automatically; destructive commands require user confirmation. Use this whenever you need to find files, search directories, inspect system details, or verify status before answering.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command line to run",
          },
          cwd: {
            type: "string",
            description: "Target working directory",
          },
          explanation: {
            type: "string",
            description: "Short justification shown to user for confirmation",
          },
        },
        required: ["command", "explanation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "Saves an important fact, user preference, formatting rule, or project note into permanent long-term memory (SQLite). Call this immediately whenever the user mentions details about themselves, their tech stack, coding preferences (e.g. 'Я пишу бекенд на Rust', 'Не используй эмодзи'), current projects, or instructions to remember.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["preference", "fact", "project", "profile"],
            description:
              "Category: 'preference' for behavior rules/formatting/emojis, 'fact' for personal info/facts/tech stack, 'project' for project notes, 'profile' for user identity.",
          },
          key: {
            type: "string",
            description:
              "Concise snake_case unique key (e.g. 'backend_rust', 'no_emojis', 'user_role')",
          },
          content: {
            type: "string",
            description: "The exact fact, rule, or preference to remember forever.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of search tags",
          },
        },
        required: ["category", "key", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hide_companion",
      description:
        "Hides or minimizes the companion mascot from the screen into the system tray when requested by the user (e.g. 'скройся', 'спрячься', 'исчезни', 'уйди', 'hide', 'minimize'). The user can restore the companion anytime via the system tray icon or hotkey.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Optional acknowledgement note (e.g. 'скрытие по просьбе пользователя')",
          },
        },
      },
    },
  },
] as const;
