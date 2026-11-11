/**
 * GNU General Public License v3.0
 * Dashboard Window Component (Settings, Avatars, Long-Term Memory Explorer & Husk Logs)
 */

import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { AvatarManager, DEFAULT_AVATAR_ID } from "../engine/AvatarManager";
import { AvatarManifest } from "../types/avatar";
import { UnifiedBrain, AIProvider } from "../brain";

interface MemoryItem {
  id?: number;
  key: string;
  category: string;
  content: string;
  tags: string[];
  updated_at: number;
}

interface HuskLog {
  timestamp: string;
  state: string;
  action?: string;
  message?: string;
  source?: string;
}

export const DashboardWindow: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"settings" | "avatars" | "memory" | "husk">("settings");

  // Multi-Provider AI State
  const [provider, setProvider] = useState<AIProvider>(() => {
    const saved = localStorage.getItem("ai_provider");
    return saved === "deepseek" ? "deepseek" : "gemini";
  });

  // Google Gemini State
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [geminiModelName, setGeminiModelName] = useState(() => {
    let saved = localStorage.getItem("gemini_model_name");
    if (!saved || saved.includes("2.0") || saved.includes("2.5")) {
      saved = "gemini-3.5-flash";
      try {
        localStorage.setItem("gemini_model_name", "gemini-3.5-flash");
      } catch {}
    }
    return saved;
  });
  const [geminiThinkingBudget, setGeminiThinkingBudget] = useState<number>(() => {
    const saved = localStorage.getItem("gemini_thinking_budget");
    return saved !== null ? parseInt(saved, 10) : 1024;
  });
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  // DeepSeek State
  const [deepseekApiKey, setDeepseekApiKey] = useState(() => localStorage.getItem("deepseek_api_key") || "");
  const [deepseekModelName, setDeepseekModelName] = useState(() => localStorage.getItem("deepseek_model_name") || "deepseek-chat");
  const [deepseekBaseUrl, setDeepseekBaseUrl] = useState(() => localStorage.getItem("deepseek_base_url") || "https://api.deepseek.com");
  const [showDeepseekKey, setShowDeepseekKey] = useState(false);

  // Connection Test & Save State
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null);
  const [userName, setUserName] = useState(() => localStorage.getItem("companion_user_name") || "Developer");
  const [savedStatus, setSavedStatus] = useState("");

  // Initial Persona / Personality State
  const DEFAULT_PERSONA =
    "Ты милый аниме-маскот компаньон, живущий на рабочем столе пользователя. Ты игривая, теплая, милая, наблюдательная, умная и отзывчивая.";
  const [persona, setPersona] = useState(() => {
    const saved = localStorage.getItem("companion_persona");
    return saved !== null ? saved : DEFAULT_PERSONA;
  });

  // Global Hotkeys State
  const DEFAULT_SHORTCUTS: Record<string, string> = {
    toggle_mascot: "Ctrl+Shift+H",
    open_settings: "Ctrl+Shift+S",
    toggle_history: "Ctrl+Shift+L",
    quit_app: "Ctrl+Shift+Q",
  };
  const [shortcuts, setShortcuts] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem("companion_shortcuts");
      if (saved) {
        return { ...DEFAULT_SHORTCUTS, ...JSON.parse(saved) };
      }
    } catch {}
    return { ...DEFAULT_SHORTCUTS };
  });
  const [recordingAction, setRecordingAction] = useState<string | null>(null);

  // Memory Editor State
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isAddMemoryOpen, setIsAddMemoryOpen] = useState(false);
  const [newMemoryCategory, setNewMemoryCategory] = useState<string>("fact");
  const [newMemoryKey, setNewMemoryKey] = useState("");
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [newMemoryTags, setNewMemoryTags] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [memoryStatus, setMemoryStatus] = useState("");
  const [huskLogs, setHuskLogs] = useState<HuskLog[]>([]);

  // System Context & App Indexer State
  const [systemContext, setSystemContext] = useState<{
    profile: {
      os_name: string;
      os_version: string;
      desktop_env: string;
      session_type: string;
      user_name: string;
      default_shell: string;
    };
    total_apps: number;
    last_updated: string | null;
  } | null>(null);
  const [isSyncingIndex, setIsSyncingIndex] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");

  // Avatar Management State
  const [installedAvatars, setInstalledAvatars] = useState<AvatarManifest[]>(() =>
    AvatarManager.getInstalledAvatars()
  );
  const [activeAvatarId, setActiveAvatarId] = useState<string>(() =>
    AvatarManager.getActiveAvatarId()
  );
  const [avatarStatus, setAvatarStatus] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Avatar Upload State
  const [uploadMode, setUploadMode] = useState<"single" | "multi">("multi");
  const [customAvatarName, setCustomAvatarName] = useState<string>("");
  const [singleImageUrl, setSingleImageUrl] = useState<string>("");
  const [multiSprites, setMultiSprites] = useState<{
    idle: string;
    talking: string;
    working: string;
    error: string;
  }>({
    idle: "",
    talking: "",
    working: "",
    error: "",
  });

  const singleFileInputRef = useRef<HTMLInputElement | null>(null);
  const multiBatchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // 0. Fetch initial System Profile and App Index Context
    invoke<any>("get_system_context")
      .then((ctx) => {
        setSystemContext(ctx);
        if (ctx?.profile?.user_name && !localStorage.getItem("companion_user_name")) {
          setUserName(ctx.profile.user_name);
        }
      })
      .catch((err) => console.warn("Failed to load system context:", err));

    // 0.1 Fetch initial SQLite Long-Term Memories
    invoke<MemoryItem[]>("get_all_memories")
      .then((items) => setMemories(items))
      .catch((err) => console.warn("Failed to load initial memories:", err));

    // 1. Initial hydration from IndexedDB for large custom avatars
    AvatarManager.syncFromIndexedDB().then((list) => {
      setInstalledAvatars([...list]);
      setActiveAvatarId(AvatarManager.getActiveAvatarId());
    });

    // 2. Listen for incoming Husk events
    const unlistenHusk = listen<any>("husk-event", (event) => {
      const log: HuskLog = {
        timestamp: new Date().toLocaleTimeString(),
        state: event.payload.state,
        action: event.payload.action,
        message: event.payload.message,
        source: event.payload.source,
      };
      setHuskLogs((prev) => [log, ...prev.slice(0, 49)]);
    });

    // 3. Listen for Avatar changes from other windows/Tauri
    const unlistenAvatar = listen<AvatarManifest>("avatar-changed", (event) => {
      if (event.payload) {
        setActiveAvatarId(event.payload.id);
      }
      setInstalledAvatars([...AvatarManager.getInstalledAvatars()]);
    });

    const handleWindowAvatarChange = (e: Event) => {
      const detail = (e as CustomEvent<AvatarManifest>).detail;
      if (detail) {
        setActiveAvatarId(detail.id);
      }
      setInstalledAvatars([...AvatarManager.getInstalledAvatars()]);
    };

    const handleListUpdated = (e: Event) => {
      const detail = (e as CustomEvent<AvatarManifest[]>).detail;
      if (detail && Array.isArray(detail)) {
        setInstalledAvatars([...detail]);
      } else {
        setInstalledAvatars([...AvatarManager.getInstalledAvatars()]);
      }
      setActiveAvatarId(AvatarManager.getActiveAvatarId());
    };

    window.addEventListener("avatar-changed", handleWindowAvatarChange);
    window.addEventListener("avatar-list-updated", handleListUpdated);

    return () => {
      unlistenHusk.then((fn) => fn());
      unlistenAvatar.then((fn) => fn());
      window.removeEventListener("avatar-changed", handleWindowAvatarChange);
      window.removeEventListener("avatar-list-updated", handleListUpdated);
    };
  }, []);

  const handleRefreshSystemIndex = async () => {
    setIsSyncingIndex(true);
    setSyncStatus("");
    try {
      const summary: { total_apps: number; last_updated: string; os: string } =
        await invoke("refresh_system_index");
      setSystemContext((prev) =>
        prev
          ? {
              ...prev,
              total_apps: summary.total_apps,
              last_updated: summary.last_updated,
            }
          : null
      );
      setSyncStatus(`Индекс обновлен: ${summary.total_apps} приложений`);
      setTimeout(() => setSyncStatus(""), 4000);
    } catch (err: any) {
      console.error("Index refresh failed:", err);
      setSyncStatus(`Ошибка: ${err?.message || err}`);
      setTimeout(() => setSyncStatus(""), 4000);
    } finally {
      setIsSyncingIndex(false);
    }
  };

  const handleOpenUrl = (url: string) => {
    invoke("open_url", { url }).catch((err) => console.warn("Failed to open URL:", err));
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const key = provider === "gemini" ? geminiApiKey : deepseekApiKey;
      const model = provider === "gemini" ? geminiModelName : deepseekModelName;
      const baseUrl = provider === "deepseek" ? deepseekBaseUrl : undefined;
      const res = await UnifiedBrain.testConnection(provider, key, model, baseUrl);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || String(err),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleKeyRecord = (e: React.KeyboardEvent, actionKey: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      setRecordingAction(null);
      return;
    }

    // Ignore standalone modifier presses
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
      return;
    }

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");

    // Format key name nicely
    let keyName = e.key;
    if (keyName === " ") keyName = "Space";
    else if (keyName.length === 1) keyName = keyName.toUpperCase();

    parts.push(keyName);
    const combo = parts.join("+");

    setShortcuts((prev) => ({
      ...prev,
      [actionKey]: combo,
    }));
    setRecordingAction(null);
  };

  const handleSaveSettings = async () => {
    localStorage.setItem("ai_provider", provider);
    localStorage.setItem("gemini_api_key", geminiApiKey);
    localStorage.setItem("gemini_model_name", geminiModelName);
    localStorage.setItem("gemini_thinking_budget", geminiThinkingBudget.toString());
    localStorage.setItem("deepseek_api_key", deepseekApiKey);
    localStorage.setItem("deepseek_model_name", deepseekModelName);
    localStorage.setItem("deepseek_base_url", deepseekBaseUrl);
    localStorage.setItem("companion_user_name", userName);
    localStorage.setItem("companion_persona", persona);
    localStorage.setItem("companion_shortcuts", JSON.stringify(shortcuts));

    // Update global shortcuts in Rust
    try {
      await invoke("update_global_shortcuts", { shortcuts });
    } catch (err) {
      console.warn("Could not update global shortcuts:", err);
    }

    // Broadcast update across Tauri windows to apply immediately
    try {
      await emit("ai-settings-changed", {
        provider,
        geminiApiKey,
        geminiModelName,
        deepseekApiKey,
        deepseekModelName,
        persona,
      });
    } catch (err) {
      console.warn("Could not broadcast ai-settings-changed:", err);
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ai-settings-changed", { detail: { provider } }));
    }

    setSavedStatus("Настройки сохранены и применены.");
    setTimeout(() => setSavedStatus(""), 3500);
  };

  const loadAllMemories = async () => {
    try {
      const results: MemoryItem[] = await invoke("get_all_memories");
      setMemories(results);
    } catch (e: any) {
      console.error("Failed to load memories:", e);
    }
  };

  const handleSearchMemory = async () => {
    try {
      if (!memoryQuery.trim()) {
        await loadAllMemories();
        return;
      }
      const results: MemoryItem[] = await invoke("search_memory", { query: memoryQuery.trim() });
      setMemories(results);
    } catch (e: any) {
      console.error("Memory search failed:", e);
    }
  };

  const handleSaveNewMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemoryKey.trim() || !newMemoryContent.trim()) {
      setMemoryStatus("Пожалуйста, заполните ключ и содержание.");
      setTimeout(() => setMemoryStatus(""), 3500);
      return;
    }
    try {
      const tags = newMemoryTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      const item: MemoryItem = {
        key: newMemoryKey.trim().toLowerCase().replace(/\s+/g, "_"),
        category: newMemoryCategory,
        content: newMemoryContent.trim(),
        tags: tags.length > 0 ? tags : [newMemoryCategory],
        updated_at: Math.floor(Date.now() / 1000),
      };

      await invoke("save_memory_entry", { item });
      setMemoryStatus(`Знание "${item.key}" успешно сохранено в SQLite.`);
      setNewMemoryKey("");
      setNewMemoryContent("");
      setNewMemoryTags("");
      setIsAddMemoryOpen(false);
      await loadAllMemories();
      setTimeout(() => setMemoryStatus(""), 3500);
    } catch (err: any) {
      setMemoryStatus(`Ошибка сохранения: ${err?.message || err}`);
      setTimeout(() => setMemoryStatus(""), 4000);
    }
  };

  const handleDeleteMemory = async (id?: number, key?: string) => {
    if (!id && !key) return;
    try {
      if (id) {
        await invoke("delete_memory", { id });
      }
      setMemoryStatus(`Запись "${key || id}" удалена из базы.`);
      await loadAllMemories();
      setTimeout(() => setMemoryStatus(""), 3500);
    } catch (err: any) {
      setMemoryStatus(`Ошибка удаления: ${err?.message || err}`);
      setTimeout(() => setMemoryStatus(""), 4000);
    }
  };

  const handleStartEdit = (m: MemoryItem) => {
    setEditingMemoryId(m.id ?? null);
    setEditContent(m.content);
    setEditTags(m.tags ? m.tags.join(", ") : "");
  };

  const handleSaveEdit = async (m: MemoryItem) => {
    try {
      const tags = editTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      const updated: MemoryItem = {
        ...m,
        content: editContent.trim(),
        tags,
        updated_at: Math.floor(Date.now() / 1000),
      };

      await invoke("save_memory_entry", { item: updated });
      setEditingMemoryId(null);
      setMemoryStatus(`Запись "${m.key}" успешно обновлена.`);
      await loadAllMemories();
      setTimeout(() => setMemoryStatus(""), 3500);
    } catch (err: any) {
      setMemoryStatus(`Ошибка обновления: ${err?.message || err}`);
      setTimeout(() => setMemoryStatus(""), 4000);
    }
  };

  // Avatar skin switching
  const handleSelectAvatar = async (id: string) => {
    setErrorMessage("");
    await AvatarManager.setActiveAvatar(id);
    setActiveAvatarId(id);
    const selected = installedAvatars.find((a) => a.id === id);
    setAvatarStatus(`Активирован скин "${selected?.name || id}"`);
    setTimeout(() => setAvatarStatus(""), 3500);
  };

  const handleDeleteAvatar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setErrorMessage("");
    const success = await AvatarManager.deleteAvatar(id);
    if (success) {
      setInstalledAvatars([...AvatarManager.getInstalledAvatars()]);
      setActiveAvatarId(AvatarManager.getActiveAvatarId());
      setAvatarStatus("Аватар удален.");
      setTimeout(() => setAvatarStatus(""), 3000);
    }
  };

  // Helper to read file to Data URL
  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Handle single image file upload
  const handleSingleImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setErrorMessage("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setSingleImageUrl(dataUrl);
      if (!customAvatarName) {
        const defaultName = file.name.replace(/\.[^/.]+$/, "");
        setCustomAvatarName(defaultName);
      }
    } catch (err: any) {
      setErrorMessage(`Ошибка чтения файла: ${err?.message || err}`);
    }
  };

  // Handle multi-sprite slot file upload
  const handleMultiSlotFile = async (
    slot: "idle" | "talking" | "working" | "error",
    file: File
  ) => {
    if (!file.type.startsWith("image/")) return;
    setErrorMessage("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setMultiSprites((prev) => ({ ...prev, [slot]: dataUrl }));
      if (!customAvatarName) {
        const defaultName = file.name
          .replace(/\.[^/.]+$/, "")
          .replace(/[_-]?(idle|talking|talk|working|work|error|err)\b/gi, "")
          .trim();
        if (defaultName) setCustomAvatarName(defaultName);
      }
    } catch (err: any) {
      setErrorMessage(`Ошибка чтения спрайта ${slot}: ${err?.message || err}`);
    }
  };

  // Handle multiple files dropped or selected at once
  const handleMultipleFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setErrorMessage("");

    if (!customAvatarName) {
      const baseName = imageFiles[0].name
        .replace(/\.[^/.]+$/, "")
        .replace(/[_-]?(idle|talking|talk|working|work|error|err)\b/gi, "")
        .trim();
      setCustomAvatarName(baseName || "Мой Маскот");
    }

    const updated = { ...multiSprites };
    const unassigned: { file: File; dataUrl: string }[] = [];

    for (const file of imageFiles) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const lower = file.name.toLowerCase();

        if (
          lower.includes("idle") ||
          lower.includes("stand") ||
          lower.includes("default") ||
          lower.includes("normal") ||
          lower.includes("stay") ||
          lower.includes("1")
        ) {
          updated.idle = dataUrl;
        } else if (
          lower.includes("talk") ||
          lower.includes("speak") ||
          lower.includes("say") ||
          lower.includes("chat") ||
          lower.includes("mouth") ||
          lower.includes("2")
        ) {
          updated.talking = dataUrl;
        } else if (
          lower.includes("error") ||
          lower.includes("err") ||
          lower.includes("shock") ||
          lower.includes("angry") ||
          lower.includes("bad") ||
          lower.includes("cry") ||
          lower.includes("3")
        ) {
          updated.error = dataUrl;
        } else if (
          lower.includes("work") ||
          lower.includes("busy") ||
          lower.includes("type") ||
          lower.includes("code") ||
          lower.includes("focus") ||
          lower.includes("4")
        ) {
          updated.working = dataUrl;
        } else {
          unassigned.push({ file, dataUrl });
        }
      } catch (err: any) {
        console.error("Error reading file:", err);
      }
    }

    // Fill remaining empty slots with unassigned files in order
    if (!updated.idle && unassigned.length > 0) {
      updated.idle = unassigned.shift()!.dataUrl;
    }
    if (!updated.talking && unassigned.length > 0) {
      updated.talking = unassigned.shift()!.dataUrl;
    }
    if (!updated.error && unassigned.length > 0) {
      updated.error = unassigned.shift()!.dataUrl;
    }
    if (!updated.working && unassigned.length > 0) {
      updated.working = unassigned.shift()!.dataUrl;
    }

    setMultiSprites(updated);
    setAvatarStatus(`Загружено ${imageFiles.length} файл(ов)! Проверьте слоты ниже.`);
    setTimeout(() => setAvatarStatus(""), 4000);
  };

  // Save custom avatar manifest with full IndexedDB persistence
  const handleSaveCustomAvatar = async () => {
    setErrorMessage("");
    setIsSaving(true);

    try {
      const name = customAvatarName.trim() || "Мой Маскот";
      let manifest: AvatarManifest;

      if (uploadMode === "single") {
        if (!singleImageUrl) {
          setErrorMessage("Пожалуйста, загрузите хотя бы одно изображение или GIF!");
          setIsSaving(false);
          return;
        }
        manifest = {
          id: `custom-${Date.now()}`,
          name,
          type: "2d-sprites",
          preview: singleImageUrl,
          sprites: {
            idle: singleImageUrl,
            talking: singleImageUrl,
            working: singleImageUrl,
            error: singleImageUrl,
            needs_approval: singleImageUrl,
          },
        };
      } else {
        if (!multiSprites.idle) {
          setErrorMessage("Пожалуйста, заполните слот Idle (Основной спрайт/GIF)!");
          setIsSaving(false);
          return;
        }
        manifest = {
          id: `custom-${Date.now()}`,
          name,
          type: "2d-sprites",
          preview: multiSprites.idle,
          sprites: {
            idle: multiSprites.idle,
            talking: multiSprites.talking || multiSprites.idle,
            working: multiSprites.working || multiSprites.idle,
            error: multiSprites.error || multiSprites.idle,
            needs_approval: multiSprites.idle,
          },
        };
      }

      // Save to IndexedDB and update active skin
      await AvatarManager.saveAvatar(manifest);
      await AvatarManager.setActiveAvatar(manifest.id);

      const refreshed = AvatarManager.getInstalledAvatars();
      setInstalledAvatars([...refreshed]);
      setActiveAvatarId(manifest.id);

      setAvatarStatus(`Маскот "${manifest.name}" успешно установлен и активирован.`);
      setTimeout(() => setAvatarStatus(""), 5000);

      // Reset upload form
      setCustomAvatarName("");
      setSingleImageUrl("");
      setMultiSprites({ idle: "", talking: "", working: "", error: "" });
    } catch (err: any) {
      console.error("[DashboardWindow] Save avatar error:", err);
      setErrorMessage(`Ошибка сохранения: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans select-none">
      {/* Sidebar Navigation */}
      <div className="w-56 bg-slate-900 border-r border-slate-800 p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 mb-6 px-2">
            <div>
              <h1 className="text-sm font-bold text-cyan-400">Companion Core</h1>
              <p className="text-[10px] text-slate-400">GNU GPL-3.0 Architecture</p>
            </div>
          </div>

          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab("settings")}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "settings"
                  ? "bg-cyan-600/20 text-cyan-300 border border-cyan-500/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              Settings & API Keys
            </button>
            <button
              onClick={() => setActiveTab("avatars")}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "avatars"
                  ? "bg-cyan-600/20 text-cyan-300 border border-cyan-500/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              Avatars & Skins
            </button>
            <button
              onClick={() => {
                setActiveTab("memory");
                loadAllMemories();
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "memory"
                  ? "bg-cyan-600/20 text-cyan-300 border border-cyan-500/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              Memory
            </button>
            <button
              onClick={() => setActiveTab("husk")}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "husk"
                  ? "bg-cyan-600/20 text-cyan-300 border border-cyan-500/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              Husk Mode Terminal IPC
            </button>
          </nav>
        </div>

        <div className="text-[10px] text-slate-500 px-2">
          Unix Socket: <code className="text-slate-400">/tmp/mascot-husk.sock</code>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-6 overflow-y-auto">
        {/* Settings Tab */}
        {activeTab === "settings" && (
          <div className="max-w-xl space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-100">AI Brain & Provider Settings</h2>
              <p className="text-xs text-slate-400">
                Настройте активную нейросеть (Google Gemini или DeepSeek), ключи API и параметры диалога.
              </p>
            </div>

            <div className="space-y-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
              {/* Provider Switcher */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Активный AI Провайдер
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setProvider("gemini");
                      setTestResult(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      provider === "gemini"
                        ? "bg-cyan-950/40 border-cyan-400 ring-2 ring-cyan-500/30 text-white shadow-lg shadow-cyan-500/10"
                        : "bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono font-bold text-cyan-400">GEMINI</span>
                      {provider === "gemini" && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                          Активен
                        </span>
                      )}
                    </div>
                    <div className="font-bold text-xs">Google Gemini</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Gemini 3.5 Flash, 3.8 Flash, 3.1 Flash-Lite
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setProvider("deepseek");
                      setTestResult(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      provider === "deepseek"
                        ? "bg-blue-950/40 border-blue-400 ring-2 ring-blue-500/30 text-white shadow-lg shadow-blue-500/10"
                        : "bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono font-bold text-blue-400">DEEPSEEK</span>
                      {provider === "deepseek" && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40">
                          Активен
                        </span>
                      )}
                    </div>
                    <div className="font-bold text-xs">DeepSeek AI</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      DeepSeek-V3 (Chat) & DeepSeek-R1 (Reasoner)
                    </div>
                  </button>
                </div>
              </div>

              {/* Google Gemini Configuration */}
              {provider === "gemini" && (
                <div className="space-y-4 pt-1">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-slate-300">
                        Google Gemini API Key
                      </label>
                      <button
                        type="button"
                        onClick={() => handleOpenUrl("https://aistudio.google.com/app/apikey")}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 underline"
                      >
                        Получить ключ в Google AI Studio ↗
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showGeminiKey ? "text" : "password"}
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full bg-slate-800 text-xs text-white px-3 py-2 pr-10 rounded-lg border border-slate-700 focus:border-cyan-400 outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(!showGeminiKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-[10px] px-1 py-0.5 rounded border border-slate-700"
                        title={showGeminiKey ? "Скрыть ключ" : "Показать ключ"}
                      >
                        {showGeminiKey ? "Скрыть" : "Показать"}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Ключ хранится строго локально на вашем устройстве.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Модель Google Gemini
                    </label>
                    <select
                      value={geminiModelName}
                      onChange={(e) => setGeminiModelName(e.target.value)}
                      className="w-full bg-slate-800 text-xs text-white px-3 py-2 rounded-lg border border-slate-700 focus:border-cyan-400 outline-none font-mono"
                    >
                      <option value="gemini-3.5-flash">gemini-3.5-flash (Умный CoT + Скорость ~1.2s, Рекомендуется)</option>
                      <option value="gemini-3.8-flash">gemini-3.8-flash (Новейшая модель 3.8)</option>
                      <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ультра-быстрый режим ~400ms)</option>
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Рекомендуется <code className="text-cyan-400">gemini-3.5-flash</code> для глубокого понимания контекста и надежного вызова инструментов.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Режим размышлений (Thinking Budget)
                    </label>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setGeminiThinkingBudget(0)}
                        className={`py-2 px-2.5 rounded-lg border text-left transition-all ${
                          geminiThinkingBudget === 0
                            ? "bg-slate-800 border-cyan-400 text-cyan-300 shadow-sm"
                            : "bg-slate-950/40 border-slate-700/60 text-slate-400 hover:border-slate-600"
                        }`}
                      >
                        <div className="font-bold text-[11px]">
                          Выключен
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">0 токенов (мгновенно)</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setGeminiThinkingBudget(1024)}
                        className={`py-2 px-2.5 rounded-lg border text-left transition-all ${
                          geminiThinkingBudget === 1024
                            ? "bg-slate-800 border-cyan-400 text-cyan-300 shadow-sm"
                            : "bg-slate-950/40 border-slate-700/60 text-slate-400 hover:border-slate-600"
                        }`}
                      >
                        <div className="font-bold text-[11px]">
                          Умный
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">~1024 токена CoT</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setGeminiThinkingBudget(2048)}
                        className={`py-2 px-2.5 rounded-lg border text-left transition-all ${
                          geminiThinkingBudget === 2048
                            ? "bg-slate-800 border-cyan-400 text-cyan-300 shadow-sm"
                            : "bg-slate-950/40 border-slate-700/60 text-slate-400 hover:border-slate-600"
                        }`}
                      >
                        <div className="font-bold text-[11px]">
                          Глубокий
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">~2048 токенов CoT</div>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* DeepSeek Configuration */}
              {provider === "deepseek" && (
                <div className="space-y-4 pt-1">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-slate-300">
                        DeepSeek API Key
                      </label>
                      <button
                        type="button"
                        onClick={() => handleOpenUrl("https://platform.deepseek.com/api_keys")}
                        className="text-[10px] text-blue-400 hover:text-blue-300 underline"
                      >
                        Получить ключ на platform.deepseek.com ↗
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showDeepseekKey ? "text" : "password"}
                        value={deepseekApiKey}
                        onChange={(e) => setDeepseekApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full bg-slate-800 text-xs text-white px-3 py-2 pr-10 rounded-lg border border-slate-700 focus:border-blue-400 outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDeepseekKey(!showDeepseekKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-[10px] px-1 py-0.5 rounded border border-slate-700"
                        title={showDeepseekKey ? "Скрыть ключ" : "Показать ключ"}
                      >
                        {showDeepseekKey ? "Скрыть" : "Показать"}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Прямое подключение к официальному API DeepSeek без прокси-серверов.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Модель DeepSeek
                    </label>
                    <select
                      value={deepseekModelName}
                      onChange={(e) => setDeepseekModelName(e.target.value)}
                      className="w-full bg-slate-800 text-xs text-white px-3 py-2 rounded-lg border border-slate-700 focus:border-blue-400 outline-none font-mono"
                    >
                      <option value="deepseek-chat">deepseek-chat (DeepSeek-V3: Высокая скорость, вызов тулов и управление приложениями)</option>
                      <option value="deepseek-reasoner">deepseek-reasoner (DeepSeek-R1: Продвинутые рассуждения CoT, решение сложных задач)</option>
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Для запуска программ и терминальных команд используйте <code className="text-blue-400">deepseek-chat</code>.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      API Base URL
                    </label>
                    <input
                      type="text"
                      value={deepseekBaseUrl}
                      onChange={(e) => setDeepseekBaseUrl(e.target.value)}
                      placeholder="https://api.deepseek.com"
                      className="w-full bg-slate-800 text-xs text-white px-3 py-2 rounded-lg border border-slate-700 focus:border-blue-400 outline-none font-mono"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Стандартный эндпоинт: <code className="text-slate-400">https://api.deepseek.com</code>
                    </p>
                  </div>
                </div>
              )}

              {/* Connection Test & Instant Visual Status */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTesting}
                    className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs px-3.5 py-2 rounded-lg border border-slate-700 transition-colors font-medium whitespace-nowrap"
                  >
                    {isTesting ? (
                      <>
                        <span className="inline-block w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                        <span>Проверка связи...</span>
                      </>
                    ) : (
                      <span>Проверить подключение (Ping)</span>
                    )}
                  </button>

                  {testResult && (
                    <div
                      className={`text-xs px-3 py-2 rounded-lg border flex items-center gap-2 animate-in fade-in flex-1 ${
                        testResult.success
                          ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-300"
                          : "bg-red-950/60 border-red-500/50 text-red-300"
                      }`}
                    >
                      <span className="text-xs font-mono font-bold">{testResult.success ? "[OK]" : "[FAIL]"}</span>
                      <span className="leading-snug">{testResult.message}</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Имя пользователя (Никнейм)
                </label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Developer"
                  className="w-full bg-slate-800 text-xs text-white px-3 py-2 rounded-lg border border-slate-700 focus:border-cyan-400 outline-none font-mono"
                />
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                <button
                  onClick={handleSaveSettings}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-4 py-2 rounded-lg font-medium transition-colors shadow-lg shadow-cyan-600/20"
                >
                  Сохранить и применить
                </button>
                {savedStatus && (
                  <span className="text-xs text-emerald-400 animate-in fade-in font-medium">{savedStatus}</span>
                )}
              </div>
            </div>

            {/* Companion Personality Card */}
            <div className="space-y-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-200">Изначальный характер компаньона</h3>
                  <p className="text-[10px] text-slate-400">
                    Настройте базовый стиль, тон и характер. Если оставить поле пустым — характер будет чистым, и личность будет строиться исключительно на воспоминаниях.
                  </p>
                </div>
                {persona.trim() === "" ? (
                  <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full font-mono">
                    Чистый характер
                  </span>
                ) : (
                  <span className="text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 px-2.5 py-0.5 rounded-full font-mono">
                    Задан пользователем
                  </span>
                )}
              </div>

              <div>
                <textarea
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  placeholder="Оставьте поле пустым, чтобы компаньон опирался исключительно на память, либо задайте уникальный характер (роль, манеру общения, особенности)..."
                  rows={4}
                  className="w-full bg-slate-800 text-xs text-white p-3 rounded-lg border border-slate-700 focus:border-cyan-400 outline-none font-sans leading-relaxed resize-none"
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[10px] text-slate-500">
                    {persona.trim() === ""
                      ? "Личность компаньона строится исключительно на вашей памяти и фактах из SQLite."
                      : "Компаньон будет следовать этому характеру во всех ответах."}
                  </p>
                  <div className="flex gap-2">
                    {persona.trim() !== "" && (
                      <button
                        type="button"
                        onClick={() => setPersona("")}
                        className="text-[11px] text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500/50 px-2.5 py-1 rounded transition-colors"
                      >
                        Очистить (без характера)
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPersona(DEFAULT_PERSONA)}
                      className="text-[11px] text-slate-400 hover:text-cyan-300 border border-slate-700 hover:border-cyan-500/50 px-2.5 py-1 rounded transition-colors"
                    >
                      Сбросить по умолчанию
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-4 py-1.5 rounded-lg font-medium transition-colors shadow-lg shadow-cyan-600/20"
                >
                  Применить характер
                </button>
                {savedStatus && (
                  <span className="text-xs text-emerald-400 font-medium">{savedStatus}</span>
                )}
              </div>
            </div>

            {/* Global Hotkeys Card */}
            <div className="space-y-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-200">Горячие клавиши (Global Hotkeys)</h3>
                  <p className="text-[10px] text-slate-400">
                    Системные комбинации клавиш для быстрого скрытия, вызова и закрытия компаньона
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShortcuts({ ...DEFAULT_SHORTCUTS })}
                  className="text-[10px] text-slate-400 hover:text-cyan-300 transition-colors"
                >
                  Сбросить все клавиши
                </button>
              </div>

              <div className="space-y-2.5">
                {[
                  {
                    id: "toggle_mascot",
                    label: "Показать / скрыть ассистента",
                    desc: "Быстро свернуть компаньона в трей или показать на экране",
                  },
                  {
                    id: "toggle_history",
                    label: "Показать / скрыть историю диалога",
                    desc: "Открыть или свернуть панель с историей всех сообщений и ответов",
                  },
                  {
                    id: "open_settings",
                    label: "Открыть окно настроек",
                    desc: "Развернуть панель управления Companion Dashboard",
                  },
                  {
                    id: "quit_app",
                    label: "Закрыть приложение",
                    desc: "Полностью завершить работу ассистента и выйти",
                  },
                ].map((item) => {
                  const isRecording = recordingAction === item.id;
                  const currentShortcut = shortcuts[item.id] || "";

                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80 gap-3"
                    >
                      <div>
                        <div className="text-xs font-medium text-slate-200">{item.label}</div>
                        <div className="text-[10px] text-slate-400">{item.desc}</div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setRecordingAction(isRecording ? null : item.id)}
                          onKeyDown={(e) => isRecording && handleKeyRecord(e, item.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                            isRecording
                              ? "bg-amber-500/20 border-amber-400 text-amber-200 animate-pulse ring-2 ring-amber-500/30"
                              : "bg-slate-800 border-slate-700 text-cyan-300 hover:border-slate-600"
                          }`}
                          title="Нажмите для записи новой комбинации клавиш"
                        >
                          {isRecording ? "Нажмите клавиши... (Esc)" : currentShortcut || "Не назначено"}
                        </button>
                        {currentShortcut && (
                          <button
                            type="button"
                            onClick={() =>
                              setShortcuts((prev) => ({
                                ...prev,
                                [item.id]: "",
                              }))
                            }
                            className="text-slate-500 hover:text-red-400 text-xs px-1"
                            title="Снять клавишу"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-4 py-1.5 rounded-lg font-medium transition-colors shadow-lg shadow-cyan-600/20"
                >
                  Применить горячие клавиши
                </button>
                {savedStatus && (
                  <span className="text-xs text-emerald-400 font-medium">{savedStatus}</span>
                )}
              </div>
            </div>

            {/* System Profile & App Index Card */}
            <div className="space-y-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-200">Системный профиль и Индекс приложений</h3>
                  <p className="text-[10px] text-slate-400">
                    Автоматическое распознавание окружения и динамический поиск софта по XDG-стандартам
                  </p>
                </div>
                {systemContext && (
                  <span className="text-[11px] bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 px-2.5 py-0.5 rounded-full font-mono">
                    {systemContext.total_apps} приложений
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Операционная система:</span>
                  <span className="font-semibold text-slate-200 font-mono">
                    {systemContext?.profile.os_name || "Linux"} {systemContext?.profile.os_version || ""}
                  </span>
                </div>

                <div className="bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Графика и Сессия:</span>
                  <span className="font-semibold text-cyan-300 font-mono">
                    {systemContext?.profile.session_type || "Wayland"} ({systemContext?.profile.desktop_env || "Default"})
                  </span>
                </div>

                <div className="bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Пользователь:</span>
                  <span className="font-semibold text-slate-200 font-mono">
                    {systemContext?.profile.user_name || userName}
                  </span>
                </div>

                <div className="bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Командный шелл:</span>
                  <span className="font-semibold text-purple-300 font-mono">
                    {systemContext?.profile.default_shell || "sh"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-500 font-mono">
                  {systemContext?.last_updated
                    ? `Синхронизировано: ${systemContext.last_updated}`
                    : "Индекс готов к использованию"}
                </span>

                <button
                  onClick={handleRefreshSystemIndex}
                  disabled={isSyncingIndex}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-cyan-300 text-xs px-3 py-1.5 rounded-lg border border-cyan-800/40 transition-colors font-medium"
                >
                  {isSyncingIndex ? (
                    <>
                      <span className="inline-block w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      <span>Сканирую диск...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>Обновить индекс приложений</span>
                    </>
                  )}
                </button>
              </div>

              {syncStatus && (
                <div className="text-[11px] text-cyan-300 bg-cyan-950/60 border border-cyan-800/50 p-2 rounded-lg text-center animate-in fade-in">
                  {syncStatus}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Avatars Tab */}
        {activeTab === "avatars" && (
          <div className="max-w-4xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-100">Avatar & Skin Manager</h2>
                <p className="text-xs text-slate-400">
                  Switch companion skins in real time or upload custom animated GIFs / sprites.
                </p>
              </div>
              {avatarStatus && (
                <div className="text-xs text-emerald-300 bg-emerald-950/70 border border-emerald-500/50 px-3 py-1.5 rounded-lg animate-in fade-in">
                  {avatarStatus}
                </div>
              )}
              {errorMessage && (
                <div className="text-xs text-red-300 bg-red-950/70 border border-red-500/50 px-3 py-1.5 rounded-lg animate-in fade-in">
                  {errorMessage}
                </div>
              )}
            </div>

            {/* Installed Avatars Grid */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Installed Avatars ({installedAvatars.length})
                </h3>
                <span className="text-[11px] text-slate-500">
                  Click any card to immediately switch
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {installedAvatars.map((avatar) => {
                  const isActive = avatar.id === activeAvatarId;
                  const isDefault =
                    avatar.id === DEFAULT_AVATAR_ID ||
                    avatar.id === "default-anime-companion";

                  return (
                    <div
                      key={avatar.id}
                      onClick={() => handleSelectAvatar(avatar.id)}
                      className={`relative group rounded-xl p-3 border transition-all cursor-pointer flex flex-col justify-between ${
                        isActive
                          ? "bg-cyan-950/30 border-cyan-400 ring-2 ring-cyan-500/40 shadow-lg shadow-cyan-500/10"
                          : "bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
                      }`}
                    >
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                          {avatar.type}
                        </span>

                        {isActive ? (
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
                            ✓ Active
                          </span>
                        ) : !isDefault ? (
                          <button
                            onClick={(e) => handleDeleteAvatar(e, avatar.id)}
                            className="text-[9px] text-slate-500 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-500/10 transition-colors"
                            title="Delete avatar"
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>

                      {/* Avatar Preview (plays animated GIF) */}
                      <div className="w-full h-32 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-center p-2 mb-2 overflow-hidden group-hover:scale-[1.02] transition-transform">
                        <img
                          src={avatar.preview || avatar.sprites.idle}
                          alt={avatar.name}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>

                      {/* Avatar Details */}
                      <div>
                        <h4 className="text-xs font-semibold text-slate-200 truncate" title={avatar.name}>
                          {avatar.name}
                        </h4>
                        <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
                          <span>
                            {Object.keys(avatar.sprites || {}).length} states
                          </span>
                          {isActive && <span className="text-cyan-400 font-mono">Current</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Upload Custom Avatar Section */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-200">Upload Custom Avatar</h3>
                <p className="text-xs text-slate-400">
                  Import animated GIFs or images. Stored persistently via local IndexedDB storage.
                </p>
              </div>

              {/* Mode Toggle: Single Image vs Multi-Sprite */}
              <div className="flex gap-2 border-b border-slate-800 pb-3">
                <button
                  type="button"
                  onClick={() => {
                    setUploadMode("multi");
                    setErrorMessage("");
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    uploadMode === "multi"
                      ? "bg-cyan-600/20 text-cyan-300 border border-cyan-500/40"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  Multi-Sprite / 4 GIFs (Idle, Talking, Error, Working)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUploadMode("single");
                    setErrorMessage("");
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    uploadMode === "single"
                      ? "bg-cyan-600/20 text-cyan-300 border border-cyan-500/40"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  Single GIF / Image (Quick Import)
                </button>
              </div>

              {/* Name Input */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Avatar Name
                </label>
                <input
                  type="text"
                  value={customAvatarName}
                  onChange={(e) => setCustomAvatarName(e.target.value)}
                  placeholder="e.g. Cyber Neko, Pixel Hero..."
                  className="w-full bg-slate-800 text-xs text-white px-3 py-2 rounded-lg border border-slate-700 focus:border-cyan-400 outline-none font-mono"
                />
              </div>

              {/* Single Image Upload */}
              {uploadMode === "single" && (
                <div className="space-y-3">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        await handleSingleImageFile(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => singleFileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-700 hover:border-cyan-500/60 rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-950/40 flex flex-col items-center justify-center gap-2"
                  >
                    <input
                      ref={singleFileInputRef}
                      type="file"
                      accept="image/*,.gif"
                      className="hidden"
                      onChange={async (e) => {
                        if (e.target.files && e.target.files[0]) {
                          await handleSingleImageFile(e.target.files[0]);
                        }
                      }}
                    />

                    {singleImageUrl ? (
                      <div className="flex flex-col items-center gap-2">
                        <img
                          src={singleImageUrl}
                          alt="Uploaded avatar"
                          className="w-24 h-24 object-contain rounded-lg border border-cyan-500/50 p-1 bg-slate-900"
                        />
                        <span className="text-xs text-cyan-400 font-medium">
                          Image loaded! Click or drop another image to replace.
                        </span>
                      </div>
                    ) : (
                      <>
                        <svg className="w-8 h-8 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <div className="text-xs text-slate-300 font-medium">
                          Drag & drop GIF / image here, or <span className="text-cyan-400">browse</span>
                        </div>
                        <p className="text-[10px] text-slate-500">
                          Supports animated GIF, PNG, SVG, JPG, WebP.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Multi-Sprite Upload Slots */}
              {uploadMode === "multi" && (
                <div className="space-y-3">
                  {/* Batch Upload Dropzone */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        await handleMultipleFiles(Array.from(e.dataTransfer.files));
                      }
                    }}
                    onClick={() => multiBatchInputRef.current?.click()}
                    className="border-2 border-dashed border-cyan-500/50 hover:border-cyan-400 bg-cyan-950/20 hover:bg-cyan-950/30 rounded-xl p-4 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-1.5"
                  >
                    <input
                      ref={multiBatchInputRef}
                      type="file"
                      multiple
                      accept="image/*,.gif"
                      className="hidden"
                      onChange={async (e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          await handleMultipleFiles(Array.from(e.target.files));
                        }
                      }}
                    />
                    <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span className="text-xs text-cyan-300 font-semibold">
                      Drop all 4 GIFs here at once, or click to choose multiple files
                    </span>
                    <p className="text-[10px] text-slate-400">
                      Auto-sorts into Idle, Talking, Error, and Working slots (or assign them manually below)
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                    {/* Idle Slot */}
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={async (e) => {
                        e.preventDefault();
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                          await handleMultiSlotFile("idle", e.dataTransfer.files[0]);
                        }
                      }}
                      className="border border-slate-700 hover:border-cyan-500/50 rounded-lg p-2.5 bg-slate-950/50 flex flex-col items-center text-center gap-1.5"
                    >
                      <span className="text-[11px] font-semibold text-slate-300">
                        Idle (Required)
                      </span>
                      <div className="w-16 h-16 rounded bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden">
                        {multiSprites.idle ? (
                          <img
                            src={multiSprites.idle}
                            alt="Idle preview"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-slate-600">Idle</span>
                        )}
                      </div>
                      <label className="text-[10px] bg-slate-800 hover:bg-slate-700 text-cyan-300 px-2 py-1 rounded cursor-pointer transition-colors">
                        Choose
                        <input
                          type="file"
                          accept="image/*,.gif"
                          className="hidden"
                          onChange={async (e) => {
                            if (e.target.files && e.target.files[0]) {
                              await handleMultiSlotFile("idle", e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                    </div>

                    {/* Talking Slot */}
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={async (e) => {
                        e.preventDefault();
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                          await handleMultiSlotFile("talking", e.dataTransfer.files[0]);
                        }
                      }}
                      className="border border-slate-700 hover:border-cyan-500/50 rounded-lg p-2.5 bg-slate-950/50 flex flex-col items-center text-center gap-1.5"
                    >
                      <span className="text-[11px] font-semibold text-slate-300">
                        Talking
                      </span>
                      <div className="w-16 h-16 rounded bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden">
                        {multiSprites.talking ? (
                          <img
                            src={multiSprites.talking}
                            alt="Talking preview"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-slate-600">Open Mouth</span>
                        )}
                      </div>
                      <label className="text-[10px] bg-slate-800 hover:bg-slate-700 text-cyan-300 px-2 py-1 rounded cursor-pointer transition-colors">
                        Choose
                        <input
                          type="file"
                          accept="image/*,.gif"
                          className="hidden"
                          onChange={async (e) => {
                            if (e.target.files && e.target.files[0]) {
                              await handleMultiSlotFile("talking", e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                    </div>

                    {/* Error Slot */}
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={async (e) => {
                        e.preventDefault();
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                          await handleMultiSlotFile("error", e.dataTransfer.files[0]);
                        }
                      }}
                      className="border border-slate-700 hover:border-cyan-500/50 rounded-lg p-2.5 bg-slate-950/50 flex flex-col items-center text-center gap-1.5"
                    >
                      <span className="text-[11px] font-semibold text-slate-300">
                        Error / Shocked
                      </span>
                      <div className="w-16 h-16 rounded bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden">
                        {multiSprites.error ? (
                          <img
                            src={multiSprites.error}
                            alt="Error preview"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-slate-600">&gt; &lt;</span>
                        )}
                      </div>
                      <label className="text-[10px] bg-slate-800 hover:bg-slate-700 text-cyan-300 px-2 py-1 rounded cursor-pointer transition-colors">
                        Choose
                        <input
                          type="file"
                          accept="image/*,.gif"
                          className="hidden"
                          onChange={async (e) => {
                            if (e.target.files && e.target.files[0]) {
                              await handleMultiSlotFile("error", e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                    </div>

                    {/* Working Slot */}
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={async (e) => {
                        e.preventDefault();
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                          await handleMultiSlotFile("working", e.dataTransfer.files[0]);
                        }
                      }}
                      className="border border-slate-700 hover:border-cyan-500/50 rounded-lg p-2.5 bg-slate-950/50 flex flex-col items-center text-center gap-1.5"
                    >
                      <span className="text-[11px] font-semibold text-slate-300">
                        Working (Optional)
                      </span>
                      <div className="w-16 h-16 rounded bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden">
                        {multiSprites.working ? (
                          <img
                            src={multiSprites.working}
                            alt="Working preview"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-slate-600">Typing</span>
                        )}
                      </div>
                      <label className="text-[10px] bg-slate-800 hover:bg-slate-700 text-cyan-300 px-2 py-1 rounded cursor-pointer transition-colors">
                        Choose
                        <input
                          type="file"
                          accept="image/*,.gif"
                          className="hidden"
                          onChange={async (e) => {
                            if (e.target.files && e.target.files[0]) {
                              await handleMultiSlotFile("working", e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Install Button & Status */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-2">
                <div>
                  {errorMessage && (
                    <span className="text-xs text-red-400 font-medium">
                      {errorMessage}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSaveCustomAvatar}
                  disabled={
                    isSaving ||
                    (uploadMode === "single"
                      ? !singleImageUrl
                      : !multiSprites.idle)
                  }
                  className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600 text-white text-xs px-5 py-2.5 rounded-lg font-bold transition-all shadow-lg shadow-cyan-600/20 active:scale-95"
                >
                  {isSaving ? "Сохранение маскота..." : "Install & Activate Avatar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Memory Tab */}
        {activeTab === "memory" && (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100">
                  Memory & Knowledge Base
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Долгосрочная база фактов SQLite (<code className="text-cyan-400">companion_memory.db</code>).
                  Ассистент автоматически учитывает эти правила и факты в каждом запросе.
                </p>
              </div>

              <button
                onClick={() => setIsAddMemoryOpen((prev) => !prev)}
                className={`text-xs px-3.5 py-2 rounded-lg font-medium transition-all flex items-center gap-1.5 shadow-sm ${
                  isAddMemoryOpen
                    ? "bg-slate-800 text-slate-300 border border-slate-700"
                    : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20"
                }`}
              >
                <span>{isAddMemoryOpen ? "✕" : "+"}</span>
                <span>{isAddMemoryOpen ? "Скрыть форму" : "Добавить знание"}</span>
              </button>
            </div>

            {/* Notification alert */}
            {memoryStatus && (
              <div className="bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 text-xs px-3.5 py-2.5 rounded-lg flex items-center justify-between animate-fadeIn">
                <span>{memoryStatus}</span>
                <button
                  onClick={() => setMemoryStatus("")}
                  className="text-cyan-400 hover:text-cyan-200 text-sm ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Stats Overview Counters */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div
                onClick={() => setSelectedCategory("all")}
                className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                  selectedCategory === "all"
                    ? "bg-slate-800 border-cyan-500/50 shadow-sm shadow-cyan-500/10"
                    : "bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/50"
                }`}
              >
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Всего</div>
                <div className="text-base font-bold text-slate-100 mt-0.5">{memories.length}</div>
              </div>

              <div
                onClick={() => setSelectedCategory("preference")}
                className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                  selectedCategory === "preference"
                    ? "bg-emerald-950/40 border-emerald-500/50"
                    : "bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/50"
                }`}
              >
                <div className="text-[10px] text-emerald-400 uppercase tracking-wider font-semibold">
                  Правила
                </div>
                <div className="text-base font-bold text-emerald-300 mt-0.5">
                  {memories.filter((m) => m.category === "preference" || m.category === "profile").length}
                </div>
              </div>

              <div
                onClick={() => setSelectedCategory("fact")}
                className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                  selectedCategory === "fact"
                    ? "bg-cyan-950/40 border-cyan-500/50"
                    : "bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/50"
                }`}
              >
                <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-semibold">
                  Факты
                </div>
                <div className="text-base font-bold text-cyan-300 mt-0.5">
                  {memories.filter((m) => m.category === "fact").length}
                </div>
              </div>

              <div
                onClick={() => setSelectedCategory("project")}
                className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                  selectedCategory === "project"
                    ? "bg-amber-950/40 border-amber-500/50"
                    : "bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/50"
                }`}
              >
                <div className="text-[10px] text-amber-400 uppercase tracking-wider font-semibold">
                  Проекты
                </div>
                <div className="text-base font-bold text-amber-300 mt-0.5">
                  {memories.filter((m) => m.category === "project").length}
                </div>
              </div>

              <div
                onClick={() => setSelectedCategory("summary")}
                className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                  selectedCategory === "summary"
                    ? "bg-purple-950/40 border-purple-500/50"
                    : "bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/50"
                }`}
              >
                <div className="text-[10px] text-purple-400 uppercase tracking-wider font-semibold">
                  Сводки
                </div>
                <div className="text-base font-bold text-purple-300 mt-0.5">
                  {memories.filter((m) => m.category === "summary").length}
                </div>
              </div>
            </div>

            {/* Add Memory Form Modal / Inline Collapsible */}
            {isAddMemoryOpen && (
              <form
                onSubmit={handleSaveNewMemory}
                className="bg-slate-900 border border-cyan-500/30 rounded-xl p-4 space-y-3.5 shadow-lg shadow-cyan-950/20"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h3 className="text-xs font-bold text-cyan-300 uppercase tracking-wider">
                    Добавить новое правило или факт в SQLite
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsAddMemoryOpen(false)}
                    className="text-slate-400 hover:text-slate-200 text-xs"
                  >
                    Отмена
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">Категория</label>
                    <select
                      value={newMemoryCategory}
                      onChange={(e) => setNewMemoryCategory(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg text-xs px-3 py-2 text-slate-200 focus:border-cyan-400 outline-none"
                    >
                      <option value="preference">Правило / Предпочтение (preference)</option>
                      <option value="fact">Факт о пользователе (fact)</option>
                      <option value="project">Заметка по проекту (project)</option>
                      <option value="profile">Профиль пользователя (profile)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-300 font-medium mb-1">
                      Ключ идентификатора (snake_case)
                    </label>
                    <input
                      type="text"
                      value={newMemoryKey}
                      onChange={(e) => setNewMemoryKey(e.target.value)}
                      placeholder="например: backend_rust или no_emojis"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg text-xs px-3 py-2 text-slate-200 focus:border-cyan-400 outline-none font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-300 font-medium mb-1">
                    Содержание факта или правила
                  </label>
                  <textarea
                    rows={2}
                    value={newMemoryContent}
                    onChange={(e) => setNewMemoryContent(e.target.value)}
                    placeholder="например: 'Я пишу бекенд на Rust' или 'Не используй эмодзи в ответах'"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg text-xs px-3 py-2 text-slate-200 focus:border-cyan-400 outline-none resize-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-300 font-medium mb-1">
                    Теги (через запятую, опционально)
                  </label>
                  <input
                    type="text"
                    value={newMemoryTags}
                    onChange={(e) => setNewMemoryTags(e.target.value)}
                    placeholder="например: rust, backend, axum"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg text-xs px-3 py-2 text-slate-200 focus:border-cyan-400 outline-none font-mono"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsAddMemoryOpen(false)}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-4 py-1.5 rounded-lg font-bold shadow-md shadow-cyan-600/20 active:scale-95"
                  >
                    Сохранить в память
                  </button>
                </div>
              </form>
            )}

            {/* Search Bar & Filter Pills */}
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={memoryQuery}
                  onChange={(e) => setMemoryQuery(e.target.value)}
                  placeholder="Поиск по ключу, тексту факта или тегам..."
                  className="w-full bg-slate-900 border border-slate-800 text-xs px-3 py-2.5 rounded-lg focus:border-cyan-400 outline-none font-mono text-slate-200 pr-16"
                  onKeyDown={(e) => e.key === "Enter" && handleSearchMemory()}
                />
                {memoryQuery && (
                  <button
                    onClick={() => {
                      setMemoryQuery("");
                      loadAllMemories();
                    }}
                    className="absolute right-2 top-2.5 text-slate-500 hover:text-slate-300 text-xs px-1"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSearchMemory}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-4 py-2.5 rounded-lg border border-slate-700 font-medium"
                >
                  Найти
                </button>
                <button
                  onClick={() => {
                    setMemoryQuery("");
                    loadAllMemories();
                  }}
                  className="bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs px-3 py-2.5 rounded-lg border border-slate-800"
                  title="Обновить список"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Cards List */}
            {(() => {
              const filtered = memories.filter((m) => {
                const matchesCategory =
                  selectedCategory === "all" ||
                  (selectedCategory === "preference" &&
                    (m.category === "preference" || m.category === "profile")) ||
                  m.category === selectedCategory;

                const q = memoryQuery.trim().toLowerCase();
                const matchesQuery =
                  !q ||
                  m.key.toLowerCase().includes(q) ||
                  m.content.toLowerCase().includes(q) ||
                  m.tags?.some((t) => t.toLowerCase().includes(q));

                return matchesCategory && matchesQuery;
              });

              if (filtered.length === 0) {
                return (
                  <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-8 text-center text-xs text-slate-500 space-y-3">
                    <p className="text-slate-400 font-medium">
                      {memoryQuery
                        ? "По вашему запросу ничего не найдено."
                        : "В базе SQLite пока нет сохраненных воспоминаний."}
                    </p>
                    <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                      Вы можете добавить факты вручную или сказать маскоту в диалоге, например:
                      «Я пишу бекенд на Rust» или «Не используй эмодзи» — и модель автоматически использует системный инструмент <code>save_memory</code>.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 pt-2">
                      <button
                        onClick={async () => {
                          const item: MemoryItem = {
                            key: "no_emojis",
                            category: "preference",
                            content: "Не использовать эмодзи в ответах ассистента",
                            tags: ["rules", "formatting"],
                            updated_at: Math.floor(Date.now() / 1000),
                          };
                          await invoke("save_memory_entry", { item });
                          await loadAllMemories();
                          setMemoryStatus("Добавлено правило: Не использовать эмодзи.");
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-lg border border-slate-700"
                      >
                        + Пример: Не использовать эмодзи
                      </button>
                      <button
                        onClick={async () => {
                          const item: MemoryItem = {
                            key: "backend_rust",
                            category: "fact",
                            content: "Пользователь разрабатывает бекенд на Rust с использованием Tokio",
                            tags: ["rust", "backend", "skills"],
                            updated_at: Math.floor(Date.now() / 1000),
                          };
                          await invoke("save_memory_entry", { item });
                          await loadAllMemories();
                          setMemoryStatus("Добавлен факт: Разработка на Rust.");
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-lg border border-slate-700"
                      >
                        + Пример: Бекенд на Rust
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 gap-3">
                  {filtered.map((m) => {
                    const isPref = m.category === "preference" || m.category === "profile";
                    const isFact = m.category === "fact";
                    const isProj = m.category === "project";
                    const isSumm = m.category === "summary";

                    const badgeStyle = isPref
                      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                      : isFact
                      ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                      : isProj
                      ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                      : isSumm
                      ? "bg-purple-500/10 text-purple-300 border-purple-500/30"
                      : "bg-slate-800 text-slate-300 border-slate-700";

                    const badgeLabel = isPref
                      ? "Правило"
                      : isFact
                      ? "Факт"
                      : isProj
                      ? "Проект"
                      : isSumm
                      ? "Сводка"
                      : m.category;

                    const isEditing = editingMemoryId === m.id;

                    return (
                      <div
                        key={m.id || m.key}
                        className="bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-xl p-3.5 transition-all space-y-2.5 shadow-sm"
                      >
                        {/* Card Top Row */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-md border ${badgeStyle}`}
                            >
                              {badgeLabel}
                            </span>
                            <span className="font-mono text-xs font-semibold text-slate-200">
                              {m.key}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 font-mono">
                              {new Date(m.updated_at * 1000).toLocaleString("ru-RU", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>

                            {!isEditing && (
                              <div className="flex items-center gap-1 ml-1">
                                <button
                                  onClick={() => handleStartEdit(m)}
                                  className="text-slate-400 hover:text-cyan-300 p-1 rounded hover:bg-slate-800 text-xs transition-colors"
                                  title="Редактировать"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDeleteMemory(m.id, m.key)}
                                  className="text-slate-400 hover:text-red-400 p-1 rounded hover:bg-slate-800 text-xs transition-colors"
                                  title="Удалить"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Card Content */}
                        {isEditing ? (
                          <div className="space-y-2 pt-1 border-t border-slate-800">
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Содержание</label>
                              <textarea
                                rows={2}
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg text-xs p-2 text-slate-200 focus:border-cyan-400 outline-none resize-none font-sans"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">
                                Теги (через запятую)
                              </label>
                              <input
                                type="text"
                                value={editTags}
                                onChange={(e) => setEditTags(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg text-xs px-2 py-1 text-slate-200 focus:border-cyan-400 outline-none font-mono"
                              />
                            </div>
                            <div className="flex justify-end gap-2 pt-1">
                              <button
                                onClick={() => setEditingMemoryId(null)}
                                className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200"
                              >
                                Отмена
                              </button>
                              <button
                                onClick={() => handleSaveEdit(m)}
                                className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs px-3 py-1 rounded font-medium shadow-sm"
                              >
                                Сохранить
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-300 leading-relaxed font-sans select-text">
                            {m.content}
                          </p>
                        )}

                        {/* Tags list */}
                        {!isEditing && m.tags && m.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {m.tags.map((tag, idx) => (
                              <span
                                key={idx}
                                onClick={() => {
                                  setMemoryQuery(tag);
                                  handleSearchMemory();
                                }}
                                className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800/80 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 cursor-pointer transition-colors"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* Husk Tab */}
        {activeTab === "husk" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-100">Husk Mode Live IPC Stream</h2>
              <p className="text-xs text-slate-400">
                Real-time events from terminal hooks, Claude Code, cargo, and test runners.
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 font-mono text-xs overflow-x-auto space-y-1 max-h-[460px] overflow-y-auto">
              {huskLogs.length === 0 ? (
                <div className="text-slate-500 py-8 text-center text-xs">
                  Awaiting events on <code className="text-cyan-400">/tmp/mascot-husk.sock</code>...
                  <p className="text-[10px] mt-1 text-slate-600">
                    Test with: <code className="text-slate-400">echo '&#123;"state":"busy","action":"editing_file"&#125;' | nc -U /tmp/mascot-husk.sock</code>
                  </p>
                </div>
              ) : (
                huskLogs.map((log, i) => (
                  <div key={i} className="flex gap-3 text-[11px] border-b border-slate-800/50 py-1">
                    <span className="text-slate-500">{log.timestamp}</span>
                    <span
                      className={`font-bold ${
                        log.state === "error"
                          ? "text-red-400"
                          : log.state === "busy"
                          ? "text-yellow-400"
                          : "text-emerald-400"
                      }`}
                    >
                      [{log.state.toUpperCase()}]
                    </span>
                    <span className="text-slate-300">{log.action || log.message || "event"}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
