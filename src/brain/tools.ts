/**
 * GNU General Public License v3.0
 * Gemini & OpenAI Tool Calling Function Declarations
 */

import { PermissionMode } from "../types/commands";
export type { PermissionMode };

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
      "Captures a fresh live screenshot of the user's desktop. Call this IMMEDIATELY whenever the user asks what you see, what is on screen, where something is located, asks to find/show/highlight any UI element, or when you need up-to-date visual confirmation of the screen. NEVER tell the user to provide a screenshot — take it autonomously with this tool. Do NOT call this if a fresh screenshot is already attached to the current prompt.",
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
  {
    name: "draw_on_screen",
    description:
      "Draws visual vector annotations, highlights, arrows, framing boxes, or freehand doodles directly onto the user's screen in Sword Art Online (SAO) HUD aesthetic. Coordinates are normalized 0 to 1000: (0,0) is top-left, (1000,1000) is bottom-right, (500,500) is the screen center. To estimate coordinates accurately, mentally divide the screenshot into a 10x10 grid of 100-unit cells and place the target in the correct cell. Sizes (radius, width, height) use the same horizontal units as x. Use this tool whenever the user asks where something is, to point out a button or icon, highlight a window or error, draw an arrow, underline text, or draw a cute doodle on screen.",
    parameters: {
      type: "OBJECT",
      properties: {
        shapes: {
          type: "ARRAY",
          description: "List of visual annotation shapes to render on the screen overlay",
          items: {
            type: "OBJECT",
            properties: {
              type: {
                type: "STRING",
                enum: ["circle", "rect", "arrow", "freehand"],
                description:
                  "Shape primitive: 'circle' to circle an icon or point of interest; 'rect' to frame a window or input; 'arrow' to point directly to an element; 'freehand' for underlines and doodles.",
              },
              color: {
                type: "STRING",
                description:
                  "Color hex code or preset: '#EBA821' (amber gold default), '#D94848' (crimson for warnings/errors), '#2E9E6B' (emerald green for success), '#00D2FF' (cyan).",
              },
              x: {
                type: "INTEGER",
                description: "Center X for circle or top-left X for rect (0-1000)",
              },
              y: {
                type: "INTEGER",
                description: "Center Y for circle or top-left Y for rect (0-1000)",
              },
              radius: {
                type: "INTEGER",
                description: "Radius for circle in the same horizontal 0-1000 units as x (~20 for a small button/icon, ~50 for a window or large area)",
              },
              width: {
                type: "INTEGER",
                description: "Width for rect (0-1000)",
              },
              height: {
                type: "INTEGER",
                description: "Height for rect (0-1000)",
              },
              startX: {
                type: "INTEGER",
                description: "Arrow origin X (0-1000)",
              },
              startY: {
                type: "INTEGER",
                description: "Arrow origin Y (0-1000)",
              },
              endX: {
                type: "INTEGER",
                description: "Arrow pointing tip X (0-1000). The arrow points right here.",
              },
              endY: {
                type: "INTEGER",
                description: "Arrow pointing tip Y (0-1000). The arrow points right here.",
              },
              points: {
                type: "ARRAY",
                description: "Array of {x, y} coordinate points (0-1000) for freehand paths or doodles",
                items: {
                  type: "OBJECT",
                  properties: {
                    x: { type: "INTEGER" },
                    y: { type: "INTEGER" },
                  },
                  required: ["x", "y"],
                },
              },
              label: {
                type: "STRING",
                description: "Optional SAO HUD callout text label shown alongside the shape (e.g. 'Нажми сюда', 'Error Line')",
              },
            },
            required: ["type"],
          },
        },
        durationSeconds: {
          type: "INTEGER",
          description: "Duration in seconds before annotation smoothly fades out (default: 6)",
        },
        explanation: {
          type: "STRING",
          description: "Brief note explaining what you are highlighting on screen",
        },
      },
      required: ["shapes"],
    },
  },
  {
    name: "clear_screen_annotations",
    description: "Immediately dismisses and clears any active drawings or visual annotations currently visible on the user's screen.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "mouse_click",
    description:
      "Moves the mouse cursor to a normalized screen position and clicks. Use after capture_screen to click the exact button, icon, field or menu item you identified. Coordinates are 0-1000: (0,0) top-left, (1000,1000) bottom-right.",
    parameters: {
      type: "OBJECT",
      properties: {
        x: {
          type: "INTEGER",
          description: "Horizontal position (0-1000, 0=left edge, 1000=right edge)",
        },
        y: {
          type: "INTEGER",
          description: "Vertical position (0-1000, 0=top, 1000=bottom)",
        },
        button: {
          type: "STRING",
          enum: ["left", "right", "middle"],
          description: "Mouse button (default left)",
        },
        clickType: {
          type: "STRING",
          enum: ["single", "double"],
          description: "Single or double click (default single)",
        },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "mouse_scroll",
    description:
      "Moves the cursor to a normalized position (0-1000) and scrolls up or down — e.g. to scroll a list, page, browser or chat. direction: 'down' (default) or 'up'; amount: number of wheel ticks (default 3).",
    parameters: {
      type: "OBJECT",
      properties: {
        x: { type: "INTEGER", description: "Horizontal position (0-1000)" },
        y: { type: "INTEGER", description: "Vertical position (0-1000)" },
        direction: {
          type: "STRING",
          enum: ["up", "down"],
          description: "Scroll direction (default down)",
        },
        amount: {
          type: "INTEGER",
          description: "Number of wheel ticks (default 3)",
        },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "type_text",
    description:
      "Types text into the currently focused field or window. Cyrillic text is pasted reliably via the clipboard regardless of keyboard layout. Set submit=true to press Enter afterwards.",
    parameters: {
      type: "OBJECT",
      properties: {
        text: {
          type: "STRING",
          description: "Text to type",
        },
        submit: {
          type: "BOOLEAN",
          description: "Press Enter after typing (default false)",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "press_hotkey",
    description:
      "Presses a keyboard shortcut, e.g. ['Ctrl','C'], ['Alt','Tab'], ['Escape'], ['Super']. Use it to copy/paste, switch windows, or close dialogs.",
    parameters: {
      type: "OBJECT",
      properties: {
        keys: {
          type: "ARRAY",
          description: "Ordered list of keys to press together",
          items: { type: "STRING" },
        },
      },
      required: ["keys"],
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
        "Captures a fresh live screenshot of the user's desktop. Call this IMMEDIATELY whenever the user asks what you see, what is on screen, where something is located, asks to find/show/highlight any UI element, or when you need up-to-date visual confirmation of the screen. NEVER tell the user to provide a screenshot — take it autonomously with this tool. Do NOT call this if a fresh screenshot is already attached to the current prompt.",
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
  {
    type: "function",
    function: {
      name: "draw_on_screen",
      description:
        "Draws visual vector annotations, highlights, arrows, framing boxes, or freehand doodles directly onto the user's screen in Sword Art Online (SAO) HUD aesthetic. Coordinates are normalized 0 to 1000: (0,0) is top-left, (1000,1000) is bottom-right, (500,500) is the screen center. To estimate coordinates accurately, mentally divide the screenshot into a 10x10 grid of 100-unit cells and place the target in the correct cell. Sizes (radius, width, height) use the same horizontal units as x. Use this tool whenever the user asks where something is, to point out a button or icon, highlight a window or error, draw an arrow, underline text, or draw a cute doodle on screen.",
      parameters: {
        type: "object",
        properties: {
          shapes: {
            type: "array",
            description: "List of visual annotation shapes to render on the screen overlay",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["circle", "rect", "arrow", "freehand"],
                  description:
                    "Shape primitive: 'circle' to circle an icon or point of interest; 'rect' to frame a window or input; 'arrow' to point directly to an element; 'freehand' for underlines and doodles.",
                },
                color: {
                  type: "string",
                  description:
                    "Color hex code or preset: '#EBA821' (amber gold default), '#D94848' (crimson for warnings/errors), '#2E9E6B' (emerald green for success), '#00D2FF' (cyan).",
                },
                x: {
                  type: "integer",
                  description: "Center X for circle or top-left X for rect (0-1000)",
                },
                y: {
                  type: "integer",
                  description: "Center Y for circle or top-left Y for rect (0-1000)",
                },
                radius: {
                  type: "integer",
                  description: "Radius for circle in the same horizontal 0-1000 units as x (~20 for a small button/icon, ~50 for a window or large area)",
                },
                width: {
                  type: "integer",
                  description: "Width for rect (0-1000)",
                },
                height: {
                  type: "integer",
                  description: "Height for rect (0-1000)",
                },
                startX: {
                  type: "integer",
                  description: "Arrow origin X (0-1000)",
                },
                startY: {
                  type: "integer",
                  description: "Arrow origin Y (0-1000)",
                },
                endX: {
                  type: "integer",
                  description: "Arrow pointing tip X (0-1000). The arrow points right here.",
                },
                endY: {
                  type: "integer",
                  description: "Arrow pointing tip Y (0-1000). The arrow points right here.",
                },
                points: {
                  type: "array",
                  description: "Array of {x, y} coordinate points (0-1000) for freehand paths or doodles",
                  items: {
                    type: "object",
                    properties: {
                      x: { type: "integer" },
                      y: { type: "integer" },
                    },
                    required: ["x", "y"],
                  },
                },
                label: {
                  type: "string",
                  description: "Optional SAO HUD callout text label shown alongside the shape (e.g. 'Нажми сюда', 'Error Line')",
                },
              },
              required: ["type"],
            },
          },
          durationSeconds: {
            type: "integer",
            description: "Duration in seconds before annotation smoothly fades out (default: 6)",
          },
          explanation: {
            type: "string",
            description: "Brief note explaining what you are highlighting on screen",
          },
        },
        required: ["shapes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_screen_annotations",
      description: "Immediately dismisses and clears any active drawings or visual annotations currently visible on the user's screen.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_click",
      description:
        "Moves the mouse cursor to a normalized screen position and clicks. Use after capture_screen to click the exact button, icon, field or menu item you identified. Coordinates are 0-1000: (0,0) top-left, (1000,1000) bottom-right.",
      parameters: {
        type: "object",
        properties: {
          x: {
            type: "integer",
            description: "Horizontal position (0-1000, 0=left edge, 1000=right edge)",
          },
          y: {
            type: "integer",
            description: "Vertical position (0-1000, 0=top, 1000=bottom)",
          },
          button: {
            type: "string",
            enum: ["left", "right", "middle"],
            description: "Mouse button (default left)",
          },
          clickType: {
            type: "string",
            enum: ["single", "double"],
            description: "Single or double click (default single)",
          },
        },
        required: ["x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_scroll",
      description:
        "Moves the cursor to a normalized position (0-1000) and scrolls up or down — e.g. to scroll a list, page, browser or chat. direction: 'down' (default) or 'up'; amount: number of wheel ticks (default 3).",
      parameters: {
        type: "object",
        properties: {
          x: { type: "integer", description: "Horizontal position (0-1000)" },
          y: { type: "integer", description: "Vertical position (0-1000)" },
          direction: {
            type: "string",
            enum: ["up", "down"],
            description: "Scroll direction (default down)",
          },
          amount: {
            type: "integer",
            description: "Number of wheel ticks (default 3)",
          },
        },
        required: ["x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description:
        "Types text into the currently focused field or window. Cyrillic text is pasted reliably via the clipboard regardless of keyboard layout. Set submit=true to press Enter afterwards.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text to type",
          },
          submit: {
            type: "boolean",
            description: "Press Enter after typing (default false)",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "press_hotkey",
      description:
        "Presses a keyboard shortcut, e.g. ['Ctrl','C'], ['Alt','Tab'], ['Escape'], ['Super']. Use it to copy/paste, switch windows, or close dialogs.",
      parameters: {
        type: "object",
        properties: {
          keys: {
            type: "array",
            description: "Ordered list of keys to press together",
            items: { type: "string" },
          },
        },
        required: ["keys"],
      },
    },
  },
] as const;

/**
 * Filter Gemini tools according to the active PermissionMode.
 * In 'safe' mode, destructive tools like execute_shell and input emulation are strictly omitted.
 */
const INPUT_TOOL_NAMES = new Set(["mouse_click", "mouse_scroll", "type_text", "press_hotkey"]);

export function getFilteredGeminiTools(mode: PermissionMode = "ask", omitCaptureScreen: boolean = false) {
  let tools = [...GEMINI_TOOLS] as any[];
  if (omitCaptureScreen) {
    tools = tools.filter((t) => t.name !== "capture_screen");
  }
  if (mode === "safe") {
    tools = tools.filter((t) => t.name !== "execute_shell" && !INPUT_TOOL_NAMES.has(t.name));
  }
  return tools;
}

/**
 * Filter OpenAI/DeepSeek tools according to the active PermissionMode.
 * In 'safe' mode, destructive tools like execute_shell and input emulation are strictly omitted.
 */
export function getFilteredOpenAITools(mode: PermissionMode = "ask", omitCaptureScreen: boolean = false) {
  let tools = [...OPENAI_TOOLS] as any[];
  if (omitCaptureScreen) {
    tools = tools.filter((t: any) => t.function.name !== "capture_screen");
  }
  if (mode === "safe") {
    tools = tools.filter((t: any) => t.function.name !== "execute_shell" && !INPUT_TOOL_NAMES.has(t.function.name));
  }
  return tools;
}
