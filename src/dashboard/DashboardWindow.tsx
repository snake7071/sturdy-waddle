/**
 * GNU General Public License v3.0
 * Dashboard Window Component (Settings, Avatars, Long-Term Memory Explorer & Husk Logs)
 * Dark Smoked Glass SAO Aincrad HUD Aesthetic
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

  // Mascot & Wayland Display Scaling State
  const [mascotScale, setMascotScale] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("companion_mascot_scale");
      return saved ? Math.max(0.5, Math.min(3.0, parseFloat(saved))) : 1.0;
    } catch {
      return 1.0;
    }
  });

  const handleScaleChange = async (newScale: number) => {
    const clamped = Math.max(0.5, Math.min(3.0, Math.round(newScale * 100) / 100));
    setMascotScale(clamped);
    try {
      localStorage.setItem("companion_mascot_scale", clamped.toString());
      await invoke("set_mascot_scale", { scale: clamped });
      await emit("mascot-scale-changed", clamped);
    } catch (err) {
      console.warn("Failed to update mascot scale:", err);
    }
  };

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
    invoke<any>("get_system_context")
      .then((ctx) => {
        setSystemContext(ctx);
        if (ctx?.profile?.user_name && !localStorage.getItem("companion_user_name")) {
          setUserName(ctx.profile.user_name);
        }
      })
      .catch((err) => console.warn("Failed to load system context:", err));

    invoke<MemoryItem[]>("get_all_memories")
      .then((items) => setMemories(items))
      .catch((err) => console.warn("Failed to load initial memories:", err));

    AvatarManager.syncFromIndexedDB().then((list) => {
      setInstalledAvatars([...list]);
      setActiveAvatarId(AvatarManager.getActiveAvatarId());
    });

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
      setSyncStatus(`Индекс синхронизирован: ${summary.total_apps} программ`);
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

    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
      return;
    }

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");

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
    localStorage.setItem("companion_mascot_scale", mascotScale.toString());

    try {
      await invoke("update_global_shortcuts", { shortcuts });
    } catch (err) {
      console.warn("Could not update global shortcuts:", err);
    }

    try {
      await invoke("set_mascot_scale", { scale: mascotScale });
      await emit("mascot-scale-changed", mascotScale);
    } catch (err) {
      console.warn("Could not update mascot scale:", err);
    }

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

    setSavedStatus("Параметры успешно сохранены в системный реестр.");
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
      setMemoryStatus("Заполните ключ и содержание.");
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
      setMemoryStatus(`Запись "${item.key}" записана в SQLite.`);
      setNewMemoryKey("");
      setNewMemoryContent("");
      setNewMemoryTags("");
      setIsAddMemoryOpen(false);
      await loadAllMemories();
      setTimeout(() => setMemoryStatus(""), 3500);
    } catch (err: any) {
      setMemoryStatus(`Ошибка записи: ${err?.message || err}`);
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
      setMemoryStatus(`Запись "${m.key}" обновлена.`);
      await loadAllMemories();
      setTimeout(() => setMemoryStatus(""), 3500);
    } catch (err: any) {
      setMemoryStatus(`Ошибка обновления: ${err?.message || err}`);
      setTimeout(() => setMemoryStatus(""), 4000);
    }
  };

  const handleSelectAvatar = async (id: string) => {
    setErrorMessage("");
    await AvatarManager.setActiveAvatar(id);
    setActiveAvatarId(id);
    const selected = installedAvatars.find((a) => a.id === id);
    setAvatarStatus(`Скин "${selected?.name || id}" экипирован.`);
    setTimeout(() => setAvatarStatus(""), 3500);
  };

  const handleDeleteAvatar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setErrorMessage("");
    const success = await AvatarManager.deleteAvatar(id);
    if (success) {
      setInstalledAvatars([...AvatarManager.getInstalledAvatars()]);
      setActiveAvatarId(AvatarManager.getActiveAvatarId());
      setAvatarStatus("Скин удален из инвентаря.");
      setTimeout(() => setAvatarStatus(""), 3000);
    }
  };

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

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

  const handleMultipleFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setErrorMessage("");

    if (!customAvatarName) {
      const baseName = imageFiles[0].name
        .replace(/\.[^/.]+$/, "")
        .replace(/[_-]?(idle|talking|talk|working|work|error|err)\b/gi, "")
        .trim();
      setCustomAvatarName(baseName || "Custom Avatar");
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
    setAvatarStatus(`Импортировано ${imageFiles.length} файл(ов).`);
    setTimeout(() => setAvatarStatus(""), 4000);
  };

  const handleSaveCustomAvatar = async () => {
    setErrorMessage("");
    setIsSaving(true);

    try {
      const name = customAvatarName.trim() || "Custom Avatar";
      let manifest: AvatarManifest;

      if (uploadMode === "single") {
        if (!singleImageUrl) {
          setErrorMessage("Загрузите изображение или анимированный GIF.");
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
          setErrorMessage("Слот Idle обязателен для экипировки.");
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

      await AvatarManager.saveAvatar(manifest);
      await AvatarManager.setActiveAvatar(manifest.id);

      const refreshed = AvatarManager.getInstalledAvatars();
      setInstalledAvatars([...refreshed]);
      setActiveAvatarId(manifest.id);

      setAvatarStatus(`Скин "${manifest.name}" экипирован.`);
      setTimeout(() => setAvatarStatus(""), 5000);

      setCustomAvatarName("");
      setSingleImageUrl("");
      setMultiSprites({ idle: "", talking: "", working: "", error: "" });
    } catch (err: any) {
      console.error("[DashboardWindow] Save avatar error:", err);
      setErrorMessage(`Ошибка: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const isWindows = systemContext?.profile?.os_name === "Windows";
  const huskEndpoint = isWindows ? "\\\\.\\pipe\\mascot-husk" : "/tmp/mascot-husk.sock";

  return (
    <div className="flex h-screen bg-[#0E1015] text-neutral-200 font-sans select-none antialiased">
      {/* =========================================================================
          SAO Left Navigation Rail (Floating Circular Medallions & Active Ribbon)
          ========================================================================= */}
      <div className="w-20 lg:w-60 bg-[#12141A]/95 border-r border-white/10 p-3 lg:p-4 flex flex-col justify-between shrink-0">
        <div>
          {/* App Header */}
          <div className="flex items-center gap-3 mb-6 px-1">
            <div className="w-10 h-10 rounded-full bg-[#181B24] border border-white/10 flex items-center justify-center text-[#EBA821] font-bold shrink-0 shadow-md">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="hidden lg:block min-w-0">
              <h1 className="text-xs font-mono font-bold tracking-wider text-neutral-100 uppercase">
                COMPANION
              </h1>
              <p className="text-[10px] text-neutral-500 font-mono">SETTINGS & CONTROL</p>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="space-y-2">
            {[
              {
                id: "settings",
                label: "AI Провайдеры",
                sub: "Модели и ключи",
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                ),
              },
              {
                id: "avatars",
                label: "Аватары и скины",
                sub: "Выбор персонажа",
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                ),
              },
              {
                id: "memory",
                label: "База памяти",
                sub: "Сохраненный контекст",
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                ),
              },
              {
                id: "husk",
                label: "Husk IPC Терминал",
                sub: "Локальный сокет",
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                ),
              },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    if (tab.id === "memory") loadAllMemories();
                  }}
                  className={`w-full flex items-center gap-3 p-1.5 rounded-lg transition-all duration-200 text-left ${
                    isActive
                      ? "bg-[#EBA821] text-[#12141A] shadow-md shadow-[#EBA821]/20 font-bold border-r-4 border-r-[#12141A]"
                      : "text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.04]"
                  }`}
                  title={tab.label}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${
                      isActive
                        ? "bg-[#12141A] text-[#EBA821]"
                        : "bg-[#181B24] text-neutral-300 border border-white/10"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {tab.icon}
                    </svg>
                  </div>
                  <div className="hidden lg:block min-w-0 pr-2">
                    <div className="text-xs font-bold truncate">{tab.label}</div>
                    <div
                      className={`text-[10px] truncate ${
                        isActive ? "text-[#12141A]/80 font-semibold" : "text-neutral-500 font-mono"
                      }`}
                    >
                      {tab.sub}
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer System Status */}
        <div className="hidden lg:block bg-black/40 border border-white/5 rounded-lg p-2.5 text-[10px] font-mono text-neutral-400">
          <div className="flex items-center gap-1.5 mb-1 text-neutral-300">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2E9E6B] animate-pulse" />
            <span>SOCKET READY</span>
          </div>
          <div className="truncate text-neutral-500 text-[9px]">{huskEndpoint}</div>
        </div>
      </div>

      {/* =========================================================================
          Unified Content Surface (Dark Smoked Obsidian Glass)
          Clean 1px Hairline Dividers (divide-y divide-white/10)
          ========================================================================= */}
      <div className="flex-1 bg-[#12141A]/90 p-6 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Status Header Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold tracking-wider font-mono uppercase text-neutral-100">
                    Companion Dashboard
                  </h2>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-[#2E9E6B] border border-emerald-500/20 font-bold">
                    ONLINE
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400 font-mono mt-0.5">
                  Пользователь: <span className="text-neutral-200">{userName}</span>
                </p>
              </div>
            </div>

            {/* Gauges (AI Link & Memory) */}
            <div className="flex items-center gap-4">
              <div className="w-28 sm:w-36">
                <div className="flex justify-between text-[10px] font-mono text-neutral-400 mb-1">
                  <span>AI LINK</span>
                  <span className={testResult?.success ? "text-[#2E9E6B]" : "text-neutral-400"}>
                    {testResult?.success ? "CONNECTED" : "READY"}
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      testResult?.success ? "w-full bg-[#2E9E6B]" : "w-3/4 bg-[#EBA821]"
                    }`}
                  />
                </div>
              </div>

              <div className="w-28 sm:w-36">
                <div className="flex justify-between text-[10px] font-mono text-neutral-400 mb-1">
                  <span>STORAGE</span>
                  <span className="text-neutral-300">{memories.length} FACTS</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#EBA821]/70"
                    style={{ width: `${Math.min(100, Math.max(15, memories.length * 6))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* =========================================================================
              Tab 1: Settings & AI Brain
              ========================================================================= */}
          {activeTab === "settings" && (
            <div className="space-y-6">
              {/* Flat Section 1: AI Provider Selector */}
              <div className="space-y-3">
                <div className="text-[11px] font-mono font-bold tracking-widest uppercase text-neutral-400">
                  // NEURAL ENGINE SELECTION
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setProvider("gemini");
                      setTestResult(null);
                    }}
                    className={`p-3.5 rounded-lg border text-left transition-all ${
                      provider === "gemini"
                        ? "bg-white/[0.06] border-white/20 border-l-4 border-l-[#EBA821] text-neutral-100"
                        : "bg-black/20 border-white/5 hover:border-white/10 text-neutral-400"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono font-bold text-neutral-200">GOOGLE GEMINI</span>
                      {provider === "gemini" && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-[#EBA821] text-[#12141A]">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      Gemini 3.5 Flash, 3.8 Flash, 3.1 Flash-Lite
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setProvider("deepseek");
                      setTestResult(null);
                    }}
                    className={`p-3.5 rounded-lg border text-left transition-all ${
                      provider === "deepseek"
                        ? "bg-white/[0.06] border-white/20 border-l-4 border-l-[#EBA821] text-neutral-100"
                        : "bg-black/20 border-white/5 hover:border-white/10 text-neutral-400"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono font-bold text-neutral-200">DEEPSEEK AI</span>
                      {provider === "deepseek" && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-[#EBA821] text-[#12141A]">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      DeepSeek-V3 (Chat) & DeepSeek-R1 (Reasoner)
                    </div>
                  </button>
                </div>
              </div>

              {/* Flat Section 2: Neural Credentials (divide-y divide-white/10) */}
              <div className="divide-y divide-white/10 border-t border-b border-white/10 py-1">
                {/* Gemini Fields */}
                {provider === "gemini" && (
                  <>
                    <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="sm:w-1/3">
                        <label className="text-xs font-semibold text-neutral-200 block">API Key</label>
                        <button
                          type="button"
                          onClick={() => handleOpenUrl("https://aistudio.google.com/app/apikey")}
                          className="text-[10px] text-neutral-400 hover:text-neutral-200 underline mt-0.5"
                        >
                          Google AI Studio ↗
                        </button>
                      </div>
                      <div className="sm:w-2/3 relative">
                        <input
                          type={showGeminiKey ? "text" : "password"}
                          value={geminiApiKey}
                          onChange={(e) => setGeminiApiKey(e.target.value)}
                          placeholder="AIzaSy..."
                          className="w-full bg-black/30 border border-white/10 focus:border-white/30 text-xs text-neutral-100 px-3 py-2 pr-14 rounded-lg font-mono outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGeminiKey(!showGeminiKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200 text-[10px] px-1.5 py-0.5 rounded bg-white/5"
                        >
                          {showGeminiKey ? "HIDE" : "SHOW"}
                        </button>
                      </div>
                    </div>

                    <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="sm:w-1/3">
                        <label className="text-xs font-semibold text-neutral-200 block">Model Engine</label>
                        <span className="text-[10px] text-neutral-500">Рекомендуется 3.5 Flash</span>
                      </div>
                      <div className="sm:w-2/3">
                        <select
                          value={geminiModelName}
                          onChange={(e) => setGeminiModelName(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 text-xs text-neutral-200 px-3 py-2 rounded-lg font-mono outline-none"
                        >
                          <option value="gemini-3.5-flash">gemini-3.5-flash (Smart CoT + Speed ~1.2s)</option>
                          <option value="gemini-3.8-flash">gemini-3.8-flash (Latest Model)</option>
                          <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ultra-fast ~400ms)</option>
                        </select>
                      </div>
                    </div>

                    <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="sm:w-1/3">
                        <label className="text-xs font-semibold text-neutral-200 block">Thinking Budget</label>
                        <span className="text-[10px] text-neutral-500">Глубина рассуждений CoT</span>
                      </div>
                      <div className="sm:w-2/3 grid grid-cols-3 gap-2">
                        {[
                          { val: 0, label: "0 (Fast)" },
                          { val: 1024, label: "1024 (Smart)" },
                          { val: 2048, label: "2048 (Deep)" },
                        ].map((b) => (
                          <button
                            key={b.val}
                            type="button"
                            onClick={() => setGeminiThinkingBudget(b.val)}
                            className={`py-1.5 px-2 rounded-lg text-xs font-mono transition-colors border ${
                              geminiThinkingBudget === b.val
                                ? "bg-[#EBA821] text-[#12141A] font-bold border-transparent"
                                : "bg-black/20 text-neutral-400 border-white/10 hover:text-white"
                            }`}
                          >
                            {b.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* DeepSeek Fields */}
                {provider === "deepseek" && (
                  <>
                    <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="sm:w-1/3">
                        <label className="text-xs font-semibold text-neutral-200 block">DeepSeek API Key</label>
                        <button
                          type="button"
                          onClick={() => handleOpenUrl("https://platform.deepseek.com/api_keys")}
                          className="text-[10px] text-neutral-400 hover:text-neutral-200 underline mt-0.5"
                        >
                          platform.deepseek.com ↗
                        </button>
                      </div>
                      <div className="sm:w-2/3 relative">
                        <input
                          type={showDeepseekKey ? "text" : "password"}
                          value={deepseekApiKey}
                          onChange={(e) => setDeepseekApiKey(e.target.value)}
                          placeholder="sk-..."
                          className="w-full bg-black/30 border border-white/10 focus:border-white/30 text-xs text-neutral-100 px-3 py-2 pr-14 rounded-lg font-mono outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowDeepseekKey(!showDeepseekKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200 text-[10px] px-1.5 py-0.5 rounded bg-white/5"
                        >
                          {showDeepseekKey ? "HIDE" : "SHOW"}
                        </button>
                      </div>
                    </div>

                    <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="sm:w-1/3">
                        <label className="text-xs font-semibold text-neutral-200 block">DeepSeek Model</label>
                        <span className="text-[10px] text-neutral-500">Chat vs Reasoner</span>
                      </div>
                      <div className="sm:w-2/3">
                        <select
                          value={deepseekModelName}
                          onChange={(e) => setDeepseekModelName(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 text-xs text-neutral-200 px-3 py-2 rounded-lg font-mono outline-none"
                        >
                          <option value="deepseek-chat">deepseek-chat (DeepSeek-V3: Tools & OS Commands)</option>
                          <option value="deepseek-reasoner">deepseek-reasoner (DeepSeek-R1: Deep Reasoner)</option>
                        </select>
                      </div>
                    </div>

                    <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="sm:w-1/3">
                        <label className="text-xs font-semibold text-neutral-200 block">API Base URL</label>
                      </div>
                      <div className="sm:w-2/3">
                        <input
                          type="text"
                          value={deepseekBaseUrl}
                          onChange={(e) => setDeepseekBaseUrl(e.target.value)}
                          placeholder="https://api.deepseek.com"
                          className="w-full bg-black/30 border border-white/10 text-xs text-neutral-100 px-3 py-2 rounded-lg font-mono outline-none"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Connection Ping Row */}
                <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="sm:w-1/3">
                    <label className="text-xs font-semibold text-neutral-200 block">Connection Health</label>
                    <span className="text-[10px] text-neutral-500">Проверка эндпоинта</span>
                  </div>
                  <div className="sm:w-2/3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={isTesting}
                      className="bg-white/10 hover:bg-white/15 disabled:opacity-50 text-neutral-200 text-xs px-4 py-2 rounded-lg font-mono font-semibold transition-colors"
                    >
                      {isTesting ? "PINGING..." : "PING AI SERVER"}
                    </button>
                    {testResult && (
                      <span
                        className={`text-xs font-mono font-semibold ${
                          testResult.success ? "text-[#2E9E6B]" : "text-[#D94848]"
                        }`}
                      >
                        {testResult.success ? "[ONLINE OK]" : `[FAIL: ${testResult.message}]`}
                      </span>
                    )}
                  </div>
                </div>

                {/* User Name Row */}
                <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="sm:w-1/3">
                    <label className="text-xs font-semibold text-neutral-200 block">User Handle</label>
                    <span className="text-[10px] text-neutral-500">Обращение к пользователю</span>
                  </div>
                  <div className="sm:w-2/3">
                    <input
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder="Developer"
                      className="w-full bg-black/30 border border-white/10 text-xs text-neutral-100 px-3 py-2 rounded-lg font-mono outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Flat Section 3: Companion Persona */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-mono font-bold tracking-widest uppercase text-neutral-400">
                    // COMPANION SOUL & PERSONA
                  </div>
                  <div className="flex gap-2">
                    {persona.trim() !== "" && (
                      <button
                        type="button"
                        onClick={() => setPersona("")}
                        className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                      >
                        Очистить
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPersona(DEFAULT_PERSONA)}
                      className="text-[10px] text-neutral-400 hover:text-white transition-colors"
                    >
                      По умолчанию
                    </button>
                  </div>
                </div>

                <textarea
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  placeholder="Задайте характер компаньона или оставьте пустым..."
                  rows={3}
                  className="w-full bg-black/30 border border-white/10 focus:border-white/30 text-xs text-neutral-200 p-3 rounded-lg leading-relaxed outline-none resize-none font-sans"
                />
              </div>

              {/* Flat Section 4: Hotkeys */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-mono font-bold tracking-widest uppercase text-neutral-400">
                    // SYSTEM HOTKEYS
                  </div>
                  <button
                    type="button"
                    onClick={() => setShortcuts({ ...DEFAULT_SHORTCUTS })}
                    className="text-[10px] text-neutral-400 hover:text-white transition-colors"
                  >
                    Сбросить
                  </button>
                </div>

                <div className="divide-y divide-white/10 border-t border-b border-white/10">
                  {[
                    { id: "toggle_mascot", label: "Показать / скрыть маскота" },
                    { id: "toggle_history", label: "Показать / скрыть историю" },
                    { id: "open_settings", label: "Открыть системное меню" },
                    { id: "quit_app", label: "Завершить работу приложения" },
                  ].map((item) => {
                    const isRecording = recordingAction === item.id;
                    const combo = shortcuts[item.id] || "";
                    return (
                      <div key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                        <span className="text-xs text-neutral-300">{item.label}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setRecordingAction(isRecording ? null : item.id)}
                            onKeyDown={(e) => isRecording && handleKeyRecord(e, item.id)}
                            className={`px-3 py-1 rounded text-xs font-mono transition-all border ${
                              isRecording
                                ? "bg-[#EBA821] text-[#12141A] font-bold animate-pulse border-transparent"
                                : "bg-black/30 border-white/10 text-neutral-300 hover:text-white"
                            }`}
                          >
                            {isRecording ? "Press Keys..." : combo || "None"}
                          </button>
                          {combo && (
                            <button
                              type="button"
                              onClick={() => setShortcuts((prev) => ({ ...prev, [item.id]: "" }))}
                              className="text-neutral-500 hover:text-[#D94848] text-xs px-1"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Flat Section 5: Wayland / HiDPI Scaling */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-mono font-bold tracking-widest uppercase text-neutral-400">
                    // WAYLAND / HIDPI MASCOT SCALING
                  </div>
                  <span className="text-xs font-mono text-neutral-200">
                    {Math.round(mascotScale * 100)}% ({Math.round(320 * mascotScale)}×{Math.round(400 * mascotScale)}px)
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-2">
                  {[
                    { label: "75%", scale: 0.75 },
                    { label: "100%", scale: 1.0 },
                    { label: "120%", scale: 1.2 },
                    { label: "150%", scale: 1.5 },
                    { label: "200%", scale: 2.0 },
                  ].map((p) => {
                    const isActive = Math.abs(mascotScale - p.scale) < 0.01;
                    return (
                      <button
                        key={p.scale}
                        type="button"
                        onClick={() => handleScaleChange(p.scale)}
                        className={`py-1.5 rounded text-xs font-mono transition-colors border ${
                          isActive
                            ? "bg-[#EBA821] text-[#12141A] font-bold border-transparent"
                            : "bg-black/20 border-white/10 text-neutral-400 hover:text-white"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.05"
                  value={mascotScale}
                  onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
                  className="w-full accent-[#EBA821] cursor-pointer mt-1"
                />
              </div>

              {/* Flat Section 6: System Profile & App Indexer */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-mono font-bold tracking-widest uppercase text-neutral-400">
                    // SYSTEM CONTEXT & XDG APP INDEXER
                  </div>
                  {systemContext && (
                    <span className="text-[10px] font-mono text-neutral-400">
                      {systemContext.total_apps} APPS INDEXED
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <div className="bg-black/20 border border-white/5 rounded-lg p-2.5">
                    <span className="text-[10px] text-neutral-500 block mb-0.5">OS PLATFORM</span>
                    <span className="text-neutral-200 truncate block">
                      {systemContext?.profile.os_name || "Linux"}
                    </span>
                  </div>
                  <div className="bg-black/20 border border-white/5 rounded-lg p-2.5">
                    <span className="text-[10px] text-neutral-500 block mb-0.5">SESSION / DE</span>
                    <span className="text-neutral-200 truncate block">
                      {systemContext?.profile.session_type || "Wayland"} ({systemContext?.profile.desktop_env || "Hyprland"})
                    </span>
                  </div>
                  <div className="bg-black/20 border border-white/5 rounded-lg p-2.5">
                    <span className="text-[10px] text-neutral-500 block mb-0.5">OPERATOR</span>
                    <span className="text-neutral-200 truncate block">
                      {systemContext?.profile.user_name || userName}
                    </span>
                  </div>
                  <div className="bg-black/20 border border-white/5 rounded-lg p-2.5">
                    <span className="text-[10px] text-neutral-500 block mb-0.5">DEFAULT SHELL</span>
                    <span className="text-neutral-200 truncate block">
                      {systemContext?.profile.default_shell || "sh"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-neutral-500 font-mono">
                    {systemContext?.last_updated ? `Updated: ${systemContext.last_updated}` : "Index active"}
                  </span>
                  <button
                    type="button"
                    onClick={handleRefreshSystemIndex}
                    disabled={isSyncingIndex}
                    className="bg-white/10 hover:bg-white/15 disabled:opacity-50 text-neutral-300 text-xs px-3 py-1.5 rounded font-mono transition-colors"
                  >
                    {isSyncingIndex ? "SCANNING..." : "REFRESH APP INDEX"}
                  </button>
                </div>

                {syncStatus && (
                  <div className="text-[10px] font-mono text-[#2E9E6B] bg-emerald-500/10 border border-emerald-500/20 p-2 rounded text-center">
                    {syncStatus}
                  </div>
                )}
              </div>

              {/* Bottom Sticky Action Bar */}
              <div className="pt-4 flex items-center justify-between border-t border-white/10">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="bg-[#EBA821] hover:bg-[#d89619] text-[#12141A] font-bold text-xs px-6 py-2.5 rounded-lg shadow-lg shadow-[#EBA821]/20 active:scale-95 transition-all"
                >
                  SAVE & APPLY CHANGES
                </button>
                {savedStatus && (
                  <span className="text-xs font-mono text-[#2E9E6B] font-semibold animate-in fade-in">
                    {savedStatus}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* =========================================================================
              Tab 2: Avatars & Equipment
              ========================================================================= */}
          {activeTab === "avatars" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-mono font-bold tracking-widest uppercase text-neutral-400">
                    // EQUIPMENT & SKINS INVENTORY
                  </h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Выберите экипированный скин ассистента или загрузите новый спрайт-пак.
                  </p>
                </div>
                {avatarStatus && (
                  <span className="text-xs font-mono text-[#2E9E6B] font-semibold">{avatarStatus}</span>
                )}
                {errorMessage && (
                  <span className="text-xs font-mono text-[#D94848] font-semibold">{errorMessage}</span>
                )}
              </div>

              {/* Equipment Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {installedAvatars.map((avatar) => {
                  const isActive = avatar.id === activeAvatarId;
                  const isDefault =
                    avatar.id === DEFAULT_AVATAR_ID || avatar.id === "default-anime-companion";

                  return (
                    <div
                      key={avatar.id}
                      onClick={() => handleSelectAvatar(avatar.id)}
                      className={`relative group rounded-lg p-3 border transition-all cursor-pointer flex flex-col justify-between ${
                        isActive
                          ? "bg-white/[0.08] border-white/20 border-l-4 border-l-[#EBA821]"
                          : "bg-black/20 border-white/5 hover:border-white/15 hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[9px] font-mono text-neutral-500 uppercase">{avatar.type}</span>
                        {isActive ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#EBA821] text-[#12141A]">
                            EQUIPPED
                          </span>
                        ) : !isDefault ? (
                          <button
                            onClick={(e) => handleDeleteAvatar(e, avatar.id)}
                            className="text-[9px] text-neutral-500 hover:text-[#D94848]"
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>

                      <div className="w-full h-28 bg-black/40 border border-white/5 rounded flex items-center justify-center p-2 mb-2 overflow-hidden">
                        <img
                          src={avatar.preview || avatar.sprites.idle}
                          alt={avatar.name}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>

                      <div className="truncate text-xs font-bold text-neutral-200">{avatar.name}</div>
                    </div>
                  );
                })}
              </div>

              {/* Custom Upload Section */}
              <div className="border-t border-white/10 pt-4 space-y-4">
                <div className="text-[11px] font-mono font-bold tracking-widest uppercase text-neutral-400">
                  // IMPORT CUSTOM AVATAR SPRITES
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setUploadMode("multi")}
                    className={`px-3 py-1.5 rounded text-xs font-mono border transition-colors ${
                      uploadMode === "multi"
                        ? "bg-[#EBA821] text-[#12141A] font-bold border-transparent"
                        : "bg-black/20 text-neutral-400 border-white/10 hover:text-white"
                    }`}
                  >
                    4-Sprite Set (Idle, Talk, Error, Work)
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadMode("single")}
                    className={`px-3 py-1.5 rounded text-xs font-mono border transition-colors ${
                      uploadMode === "single"
                        ? "bg-[#EBA821] text-[#12141A] font-bold border-transparent"
                        : "bg-black/20 text-neutral-400 border-white/10 hover:text-white"
                    }`}
                  >
                    Single GIF / Image
                  </button>
                </div>

                <input
                  type="text"
                  value={customAvatarName}
                  onChange={(e) => setCustomAvatarName(e.target.value)}
                  placeholder="Avatar Name (e.g. Asuna, Neko)..."
                  className="w-full bg-black/30 border border-white/10 text-xs text-neutral-100 px-3 py-2 rounded-lg font-mono outline-none"
                />

                {uploadMode === "single" ? (
                  <div
                    onClick={() => singleFileInputRef.current?.click()}
                    className="border-2 border-dashed border-white/15 hover:border-white/30 rounded-lg p-6 text-center cursor-pointer bg-black/20 transition-colors"
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
                        <img src={singleImageUrl} alt="preview" className="w-20 h-20 object-contain" />
                        <span className="text-xs text-[#EBA821] font-mono">Image loaded! Click to replace.</span>
                      </div>
                    ) : (
                      <div className="text-xs text-neutral-400">
                        Drop GIF or image here, or <span className="text-neutral-200 underline">browse</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div
                      onClick={() => multiBatchInputRef.current?.click()}
                      className="border-2 border-dashed border-white/15 hover:border-white/30 rounded-lg p-4 text-center cursor-pointer bg-black/20 transition-colors"
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
                      <span className="text-xs font-mono text-neutral-300">
                        Drop all 4 GIFs at once or click to batch import
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(["idle", "talking", "error", "working"] as const).map((slot) => (
                        <div key={slot} className="bg-black/20 border border-white/5 rounded-lg p-2.5 text-center">
                          <span className="text-[10px] font-mono text-neutral-400 uppercase block mb-1">
                            {slot}
                          </span>
                          <div className="w-full h-16 bg-black/40 rounded flex items-center justify-center mb-2 overflow-hidden">
                            {multiSprites[slot] ? (
                              <img src={multiSprites[slot]} alt={slot} className="max-h-full max-w-full object-contain" />
                            ) : (
                              <span className="text-[10px] text-neutral-600 font-mono">Empty</span>
                            )}
                          </div>
                          <label className="text-[10px] bg-white/10 hover:bg-white/15 text-neutral-300 px-2 py-0.5 rounded cursor-pointer font-mono">
                            Select
                            <input
                              type="file"
                              accept="image/*,.gif"
                              className="hidden"
                              onChange={async (e) => {
                                if (e.target.files && e.target.files[0]) {
                                  await handleMultiSlotFile(slot, e.target.files[0]);
                                }
                              }}
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSaveCustomAvatar}
                  disabled={isSaving}
                  className="bg-[#EBA821] hover:bg-[#d89619] disabled:opacity-50 text-[#12141A] font-bold text-xs px-5 py-2.5 rounded-lg active:scale-95 transition-all"
                >
                  {isSaving ? "INSTALLING..." : "INSTALL & EQUIP AVATAR"}
                </button>
              </div>
            </div>
          )}

          {/* =========================================================================
              Tab 3: Memory Archive
              ========================================================================= */}
          {activeTab === "memory" && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-mono font-bold tracking-widest uppercase text-neutral-400">
                    // LONG-TERM MEMORY ARCHIVE (SQLITE)
                  </h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Факты и правила, автоматически загружаемые в системный промпт нейросети.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddMemoryOpen(!isAddMemoryOpen)}
                  className="bg-[#EBA821] hover:bg-[#d89619] text-[#12141A] font-bold text-xs px-4 py-2 rounded-lg transition-all"
                >
                  {isAddMemoryOpen ? "✕ ЗАКРЫТЬ" : "+ ДОБАВИТЬ ЗАПИСЬ"}
                </button>
              </div>

              {/* Status Alert */}
              {memoryStatus && (
                <div className="text-xs font-mono text-[#2E9E6B] bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-lg">
                  {memoryStatus}
                </div>
              )}

              {/* Category Filter Pills */}
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "all", label: `ALL [${memories.length}]` },
                  { id: "preference", label: "RULES" },
                  { id: "fact", label: "FACTS" },
                  { id: "project", label: "PROJECTS" },
                  { id: "summary", label: "SUMMARIES" },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3 py-1 rounded text-xs font-mono border transition-colors ${
                      selectedCategory === cat.id
                        ? "bg-[#EBA821] text-[#12141A] font-bold border-transparent"
                        : "bg-black/20 border-white/10 text-neutral-400 hover:text-white"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Inline Add Form */}
              {isAddMemoryOpen && (
                <form
                  onSubmit={handleSaveNewMemory}
                  className="bg-black/30 border border-white/10 rounded-lg p-4 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-mono text-neutral-400 uppercase block mb-1">Категория</label>
                      <select
                        value={newMemoryCategory}
                        onChange={(e) => setNewMemoryCategory(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded text-xs px-3 py-2 text-neutral-200 outline-none"
                      >
                        <option value="preference">preference (Правило)</option>
                        <option value="fact">fact (Факт)</option>
                        <option value="project">project (Проект)</option>
                        <option value="profile">profile (Профиль)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-neutral-400 uppercase block mb-1">
                        Ключ (snake_case)
                      </label>
                      <input
                        type="text"
                        value={newMemoryKey}
                        onChange={(e) => setNewMemoryKey(e.target.value)}
                        placeholder="backend_rust"
                        className="w-full bg-black/40 border border-white/10 rounded text-xs px-3 py-2 text-neutral-200 font-mono outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono text-neutral-400 uppercase block mb-1">Содержание</label>
                    <textarea
                      rows={2}
                      value={newMemoryContent}
                      onChange={(e) => setNewMemoryContent(e.target.value)}
                      placeholder="Описание факта или правила..."
                      className="w-full bg-black/40 border border-white/10 rounded text-xs px-3 py-2 text-neutral-200 outline-none resize-none"
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAddMemoryOpen(false)}
                      className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
                    >
                      Отмена
                    </button>
                    <button
                      type="submit"
                      className="bg-[#EBA821] hover:bg-[#d89619] text-[#12141A] font-bold text-xs px-4 py-1.5 rounded"
                    >
                      Сохранить
                    </button>
                  </div>
                </form>
              )}

              {/* Search Box */}
              <div className="relative">
                <input
                  type="text"
                  value={memoryQuery}
                  onChange={(e) => setMemoryQuery(e.target.value)}
                  placeholder="Поиск по ключу, тексту или тегам..."
                  className="w-full bg-black/30 border border-white/10 text-xs px-3 py-2 rounded-lg font-mono text-neutral-200 outline-none"
                  onKeyDown={(e) => e.key === "Enter" && handleSearchMemory()}
                />
              </div>

              {/* Memory Items List (divide-y divide-white/10) */}
              <div className="divide-y divide-white/10 border-t border-b border-white/10">
                {memories
                  .filter((m) => {
                    const matchesCat =
                      selectedCategory === "all" ||
                      (selectedCategory === "preference" &&
                        (m.category === "preference" || m.category === "profile")) ||
                      m.category === selectedCategory;
                    const q = memoryQuery.trim().toLowerCase();
                    const matchesQuery =
                      !q ||
                      m.key.toLowerCase().includes(q) ||
                      m.content.toLowerCase().includes(q);
                    return matchesCat && matchesQuery;
                  })
                  .map((m) => (
                    <div key={m.id || m.key} className="py-3 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                              m.category === "preference"
                                ? "bg-emerald-500/20 text-[#2E9E6B]"
                                : m.category === "fact"
                                ? "bg-amber-500/20 text-[#EBA821]"
                                : "bg-white/10 text-neutral-300"
                            }`}
                          >
                            {m.category}
                          </span>
                          <span className="text-xs font-mono font-bold text-neutral-200">{m.key}</span>
                        </div>
                        <div className="flex items-center gap-2 text-neutral-500">
                          <button
                            onClick={() => handleStartEdit(m)}
                            className="hover:text-neutral-200 text-xs"
                            title="Редактировать"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => handleDeleteMemory(m.id, m.key)}
                            className="hover:text-[#D94848] text-xs"
                            title="Удалить"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {editingMemoryId === m.id ? (
                        <div className="space-y-2 pt-1">
                          <textarea
                            rows={2}
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs text-neutral-200 outline-none"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setEditingMemoryId(null)}
                              className="px-2 py-1 text-xs text-neutral-400"
                            >
                              Отмена
                            </button>
                            <button
                              onClick={() => handleSaveEdit(m)}
                              className="bg-[#EBA821] text-[#12141A] font-bold text-xs px-3 py-1 rounded"
                            >
                              Сохранить
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-neutral-300 leading-relaxed">{m.content}</p>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* =========================================================================
              Tab 4: Husk Mode IPC Stream
              ========================================================================= */}
          {activeTab === "husk" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-mono font-bold tracking-widest uppercase text-neutral-400">
                  // HUSK IPC LOG STREAM
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  События в реальном времени из терминала, тестов и скриптов через {huskEndpoint}
                </p>
              </div>

              <div className="bg-[#0A0C10] border border-white/10 rounded-lg p-4 font-mono text-xs text-neutral-300 max-h-[500px] overflow-y-auto space-y-1.5 shadow-inner">
                {huskLogs.length === 0 ? (
                  <div className="text-neutral-500 py-10 text-center text-xs">
                    Ожидание событий на канале <code className="text-[#EBA821]">{huskEndpoint}</code>...
                  </div>
                ) : (
                  huskLogs.map((log, i) => (
                    <div key={i} className="flex gap-3 text-[11px] border-b border-white/5 py-1">
                      <span className="text-neutral-500">{log.timestamp}</span>
                      <span
                        className={`font-bold ${
                          log.state === "error"
                            ? "text-[#D94848]"
                            : log.state === "busy"
                            ? "text-[#EBA821]"
                            : "text-[#2E9E6B]"
                        }`}
                      >
                        [{log.state.toUpperCase()}]
                      </span>
                      <span className="text-neutral-200">{log.action || log.message || "event"}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
