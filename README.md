# 🤖 FenBeta0

> **Autonomous AI Desktop Companion** built on **Tauri v2**, **React 19**, and **Rust**. Features multi-provider AI support (**Google Gemini** + **DeepSeek**), dynamic function calling, local SQLite long-term memory, and an extensible native OS controller.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB.svg?logo=tauri&logoColor=white)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-2024_Edition-DEA584.svg?logo=rust&logoColor=black)](https://www.rust-lang.org)
[![SQLite](https://img.shields.io/badge/Database-SQLite-003B57.svg?logo=sqlite&logoColor=white)](https://sqlite.org)

---

## 🌟 Key Features

### 1. 🎭 Interactive Desktop Mascot
- **Transparent Desktop Overlay**: Borderless, frameless, always-on-top window (`alwaysOnTop`), supporting transparency and dynamic click-through.
- **Physics & Window Interactions**: Drag-and-drop mechanics, edge gravity, falling animations, and window perching (`perch` on top of active application windows).
- **Sprite Animation Engine**:
  - Full emotional state support: `idle`, `talking`, `happy`, `thinking`, `confused`, `surprised`, `angry`, and `sad`.
  - Realistic blinking, eye tracking, and smooth mouth-flap speech articulation without jitter or animation acceleration glitches.
  - Speech bubbles with typewriter-style streaming tokens.
- **Modular Custom Avatars**: Extensible avatar system configured via JSON manifests (`AvatarManager`).

### 2. 🧠 Multi-Provider AI Brain
- **Unified Brain Facade (`UnifiedBrain`)**: Seamlessly hot-swap between AI providers at runtime across all application windows via Tauri event bus:
  - **Google Gemini**: Supports `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-1.5-flash`, and `gemini-1.5-pro`, complete with configurable reasoning thinking budgets.
  - **DeepSeek**: Direct OpenAI-compatible SSE streaming (`https://api.deepseek.com` with customizable Base URL for reverse proxies/gateways), supporting `deepseek-chat` (V3) and `deepseek-reasoner` (R1 CoT).
- **Reasoning Content Streaming (CoT)**: For `deepseek-reasoner`, live step-by-step thinking tokens (`reasoning_content`) stream into the mascot's thought pipeline.
- **Bi-directional Tool / Function Calling**:
  - Launch installed applications (`launch_app`).
  - Open web links in the default browser (`open_url`).
  - Execute commands in persistent terminal windows (`execute_shell`).
  - Window perching (`window_perch`), screen snapshot capture (`capture_screen`), and countdown timers (`set_timer`).

### 3. 🦾 Native OS Controller (`Hands` & `PlatformAdapter`)
- **`PlatformAdapter` Architecture**: Extensible cross-platform abstraction layer for OS automation without hardcoded distribution paths.
- **Dynamic Application Indexer (`AppIndexer`)**:
  - Scans system and user XDG desktop entry paths (`/usr/share/applications`, `~/.local/share/applications`, Flatpak).
  - Parses `.desktop` files: localized names (`Name`, `Name[ru]`), categories, keywords, and executable strings (cleaning `%u`, `%F` placeholders).
  - Stores entries in SQLite for sub-millisecond keyword and fuzzy lookup without compiled-in slang lists.
  - Spawns apps via system `gtk-launch` with robust binary fallback and process detachment (`setsid` / `process_group`).
- **Persistent Terminal Execution**:
  - Auto-detects installed terminal emulators (`$TERMINAL`, `kitty`, `alacritty`, `wezterm`, `ghostty`, `gnome-terminal`, `konsole`, `xfce4-terminal`, `foot`, `xterm`).
  - **Non-closing console**: Keeps the terminal session open after commands finish (`--hold` or interactive `$SHELL` wrapper), so scans like `nmap` or `ping` remain visible and interactive.
- **Secure URL Dispatch**: Protocol validation (`http://`, `https://`) dispatched through `tauri-plugin-opener` / `xdg-open`.

### 4. 💾 Long-Term Memory (LTM)
- Local embedded **SQLite** database (`companion_memory.db`).
- Persists user preferences, historical interactions, entity facts, and categorized tags.
- Background memory compaction and short-term conversation sliding window.

### 5. 🎛️ Companion Dashboard
- **Settings**:
  - AI Provider toggle (Google Gemini ⟷ DeepSeek).
  - Masked API key inputs with show/hide password toggle and direct portal links (Google AI Studio, DeepSeek Platform).
  - Model selection dropdowns and optional DeepSeek Base URL override.
  - **Test Connection**: Instant ping test measuring response latency in milliseconds.
  - **Save & Apply**: Persists settings and immediately notifies the live mascot window without app restarts.
- **Avatars**: Avatar catalog, sprite sheet inspector, and animation preview.
- **Memory Explorer**: Search, inspect, and modify SQLite long-term memory entries.
- **Husk Logs**: Monitor IPC daemon sockets, state machine transitions, and background events.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph Frontend["Frontend (React 19 + TypeScript + Vite)"]
        MW["MascotWindow (Overlay Mascot)"]
        DW["DashboardWindow (Control & Settings)"]
        UB["UnifiedBrain (Provider Router)"]
        GB["GeminiBrain (@google/genai)"]
        DSB["DeepSeekBrain (OpenAI SSE)"]
        SR["MascotSpriteRenderer (Sprites & Emotes)"]
        
        MW --> SR
        MW --> UB
        DW -->|Tauri Event: ai-settings-changed| UB
        UB --> GB
        UB --> DSB
    end

    subgraph RustCore["Backend Core (Tauri v2 + Rust)"]
        IPC["Tauri IPC Commands (src/lib.rs)"]
        PA["PlatformAdapter (Hands Module)"]
        AI["AppIndexer (XDG Desktop Scanner)"]
        MS["MemoryStore (rusqlite)"]
        
        UB -->|invoke: launch_app / execute_shell| IPC
        IPC --> PA
        IPC --> MS
        PA --> AI
    end

    subgraph OS["Operating System (Linux / Desktop)"]
        TERM["Terminal Emulator (kitty, alacritty, etc.)"]
        APPS["Target Apps (Telegram, VSCode, Browser)"]
        DB[(companion_memory.db)]
        
        PA -->|Spawn process group (persistent)| TERM
        PA -->|gtk-launch / exec| APPS
        MS --> DB
    end
```

---

## 📂 Repository Structure

```
FenBeta0/
├── public/                 # Static assets, default avatar sprites and icons
│   └── avatars/            # Avatar sprite sheets and manifest files
├── src/                    # Frontend source (React 19 + TypeScript)
│   ├── brain/              # AI Brain logic & providers
│   │   ├── index.ts        # UnifiedBrain facade & dynamic router
│   │   ├── gemini.ts       # Google Gemini SDK integration
│   │   ├── deepseek.ts     # DeepSeek API integration (SSE streaming, CoT, Tools)
│   │   ├── tools.ts        # Tool definitions (Gemini & OpenAI function schemas)
│   │   ├── sanitizer.ts    # Input/Output sanitization
│   │   └── system_prompt.ts# Dynamic system instructions & environment context
│   ├── dashboard/          # Control center & settings window (DashboardWindow)
│   ├── engine/             # Sprite renderer, physics, and avatar manager
│   ├── mascot/             # Transparent overlay mascot window (MascotWindow)
│   ├── types/              # Shared TypeScript interfaces & command types
│   ├── App.tsx             # Multi-window entry router (?window=mascot|dashboard)
│   └── main.tsx            # React application entrypoint
├── src-tauri/              # Backend core (Tauri v2 + Rust)
│   ├── src/
│   │   ├── brain/          # SQLite MemoryStore implementation
│   │   ├── hands/          # OS controller (AppIndexer, terminal runner, system profile)
│   │   ├── husk/           # Background daemon socket listener (Husk mode)
│   │   ├── ipc/            # Tauri command IPC dispatchers
│   │   ├── lib.rs          # App bootstrap, state management & handlers
│   │   └── main.rs         # Binary entry point
│   ├── Cargo.toml          # Rust dependencies (tauri, rusqlite, tokio, etc.)
│   └── tauri.conf.json     # Multi-window & overlay window configuration
├── package.json            # Node.js dependencies & scripts
├── vite.config.ts          # Vite build configuration
└── README.md               # Project documentation
```

---

## 🛠️ Prerequisites & Dependencies

- **Operating System**: Linux (tested on Arch Linux, Ubuntu, Fedora; Wayland & X11 supported)
- **Node.js**: `>= 18.0.0`
- **npm**: `>= 9.0.0`
- **Rust**: `>= 1.80.0` (with `edition = "2024"` support)

### System Libraries (Linux)

#### Debian / Ubuntu
```bash
sudo apt-get update && sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

#### Arch Linux
```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl
```

---

## 🚀 Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/FenBeta0.git
cd FenBeta0
```

### 2. Install Node Dependencies
```bash
npm install
```

### 3. Run in Development Mode
```bash
npm run tauri dev
```
This boots the local Vite dev server (`http://localhost:1420`) and compiles the native Rust backend. The transparent mascot will appear directly on your desktop.

### 4. Build for Production
```bash
npm run tauri build
```
Production binaries and package bundles (`.deb`, `.AppImage`) will be generated inside `src-tauri/target/release/bundle/`.

---

## ⚙️ AI Provider Configuration

You can configure API credentials via the graphical Dashboard or with environment variables:

### Option A: Via Dashboard (Recommended)
1. Open the companion Dashboard via the mascot's context menu or keyboard shortcut.
2. Navigate to **Settings** -> **AI Brain & API Providers**.
3. Choose your active provider (**Google Gemini** or **DeepSeek**).
4. Enter your API key:
   - [Google AI Studio](https://aistudio.google.com/app/apikey) for Gemini.
   - [DeepSeek Platform](https://platform.deepseek.com/api_keys) for DeepSeek.
5. Click **Test Connection** for an instant latency ping check.
6. Click **Save & Apply** — changes take effect immediately across all windows without restarting.

### Option B: Via `.env` File
Create a `.env` file in the project root:
```env
# Google Gemini API Key
VITE_GEMINI_API_KEY="AIzaSy..."

# DeepSeek API Key
VITE_DEEPSEEK_API_KEY="sk-..."
```

---

## 🧪 Testing & Verification

Run the TypeScript type check and frontend production build:
```bash
npm run build
```

Run Rust core unit tests (application indexer, terminal detection, system profile):
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 📄 License

FenBeta0 is distributed under the **GNU General Public License v3.0 (GPL-3.0)**. See the [LICENSE](LICENSE) file for details.
