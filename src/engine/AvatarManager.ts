/**
 * GNU General Public License v3.0
 * Avatar Management & Skin Switching Engine with IndexedDB Large-Asset Backing
 */

import { emit } from "@tauri-apps/api/event";
import { AvatarManifest } from "../types/avatar";
import defaultAvatarGif from "../assets/ezgif-75083ad0293d8d70.gif";

export const STORAGE_KEY_AVATARS = "installed_avatars";
export const STORAGE_KEY_ACTIVE = "active_avatar_id";
export const DEFAULT_AVATAR_ID = "ezgif-75083ad0293d8d70";
export const AOI_AVATAR_ID = "default-anime-companion";

const IDB_NAME = "companion_avatars_db";
const IDB_VERSION = 1;
const IDB_STORE = "avatars";

/**
 * Open or upgrade the IndexedDB store for companion avatars
 */
function openAvatarsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB is not supported in this environment"));
    }
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * IndexedDB helpers for storing large animated GIFs and sprite sets without localStorage 5MB limit
 */
async function idbGetAllAvatars(): Promise<AvatarManifest[]> {
  try {
    const db = await openAvatarsDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as AvatarManifest[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[AvatarManager] IndexedDB getAll fallback:", err);
    return [];
  }
}

async function idbGetAvatar(id: string): Promise<AvatarManifest | null> {
  try {
    const db = await openAvatarsDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as AvatarManifest) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSaveAvatar(avatar: AvatarManifest): Promise<void> {
  try {
    const db = await openAvatarsDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(avatar);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[AvatarManager] IndexedDB save error:", err);
  }
}

async function idbDeleteAvatar(id: string): Promise<void> {
  try {
    const db = await openAvatarsDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[AvatarManager] IndexedDB delete error:", err);
  }
}

/**
 * Helper to encode SVG string into high-resolution inline Data URI
 */
function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
}

/**
 * Clean, high-resolution inline SVG generator for default anime companion
 */
function createAnimeGirlSvg(variant: "idle" | "talking" | "working" | "error" | "needs_approval" | "glitch"): string {
  const isTalking = variant === "talking";
  const isWorking = variant === "working";
  const isError = variant === "error";
  const isNeedsApproval = variant === "needs_approval";
  const isGlitch = variant === "glitch";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
  <defs>
    <linearGradient id="hairGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f472b6" />
      <stop offset="50%" stop-color="#ec4899" />
      <stop offset="100%" stop-color="#db2777" />
    </linearGradient>
    <linearGradient id="hairTwintailGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f9a8d4" />
      <stop offset="70%" stop-color="#ec4899" />
      <stop offset="100%" stop-color="#be185d" />
    </linearGradient>
    <linearGradient id="eyeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#818cf8" />
      <stop offset="40%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#312e81" />
    </linearGradient>
    <radialGradient id="blushGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fb7185" stop-opacity="0.65" />
      <stop offset="100%" stop-color="#fb7185" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="jacketGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="ribbonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="100%" stop-color="#0284c7" />
    </linearGradient>
    ${
      isGlitch
        ? `<filter id="glitchSplit" x="-10%" y="-10%" width="120%" height="120%">
      <feOffset in="SourceGraphic" dx="-4" dy="0" result="offset1" />
      <feOffset in="SourceGraphic" dx="4" dy="0" result="offset2" />
      <feBlend in="SourceGraphic" in2="offset1" mode="screen" result="blend1" />
      <feBlend in="blend1" in2="offset2" mode="screen" />
    </filter>`
        : ""
    }
  </defs>

  <g ${isGlitch ? 'filter="url(#glitchSplit)"' : ""}>
    <!-- Soft Ambient Ground Shadow -->
    <ellipse cx="120" cy="226" rx="58" ry="10" fill="rgba(236, 72, 153, 0.2)" />

    <!-- Back Twin-Tails -->
    <path d="M 68 115 C 30 110, 15 145, 22 185 C 26 210, 48 215, 52 195 C 58 170, 56 140, 72 125 Z" fill="url(#hairTwintailGrad)" />
    <path d="M 172 115 C 210 110, 225 145, 218 185 C 214 210, 192 215, 188 195 C 182 170, 184 140, 168 125 Z" fill="url(#hairTwintailGrad)" />

    <!-- Twin-Tail Ribbons -->
    <circle cx="68" cy="115" r="7" fill="#06b6d4" />
    <path d="M 64 116 L 50 126 M 66 120 L 58 136" stroke="#06b6d4" stroke-width="3" stroke-linecap="round" />
    <circle cx="172" cy="115" r="7" fill="#06b6d4" />
    <path d="M 176 116 L 190 126 M 174 120 L 182 136" stroke="#06b6d4" stroke-width="3" stroke-linecap="round" />

    <!-- Sailor / Cyber Uniform -->
    <path d="M 85 185 L 70 230 L 170 230 L 155 185 Z" fill="url(#jacketGrad)" />
    <path d="M 98 185 L 120 215 L 142 185 Z" fill="#ffffff" />
    <path d="M 86 186 Q 120 205 154 186 L 160 210 Q 120 224 80 210 Z" fill="#312e81" stroke="#06b6d4" stroke-width="1.5" />
    <path d="M 120 206 L 110 216 L 120 220 L 130 216 Z" fill="url(#ribbonGrad)" />
    <circle cx="120" cy="207" r="3.5" fill="#f43f5e" />

    ${
      isWorking
        ? `<!-- Working State: Mini Cyber Keyboard & Typing Hands -->
    <g transform="translate(0, 5)">
      <rect x="75" y="210" width="90" height="20" rx="4" fill="#0f172a" stroke="#06b6d4" stroke-width="2" />
      <line x1="85" y1="216" x2="155" y2="216" stroke="#06b6d4" stroke-width="1" stroke-dasharray="3 3" />
      <line x1="85" y1="222" x2="155" y2="222" stroke="#06b6d4" stroke-width="1" stroke-dasharray="3 3" />
      <circle cx="92" cy="209" r="6" fill="#fef0ea" stroke="#fb7185" stroke-width="1" />
      <circle cx="148" cy="207" r="6" fill="#fef0ea" stroke="#fb7185" stroke-width="1" />
    </g>`
        : ""
    }

    <!-- Neck -->
    <rect x="111" y="166" width="18" height="24" rx="6" fill="#fde2d9" />
    <path d="M 111 176 Q 120 182 129 176" fill="none" stroke="#f4b8a5" stroke-width="2" />

    <!-- Head / Face -->
    <path d="M 72 120 C 72 75, 168 75, 168 120 C 168 158, 142 178, 120 178 C 98 178, 72 158, 72 120 Z" fill="#fef0ea" />

    <!-- Soft Blushing Cheeks -->
    <ellipse cx="90" cy="142" rx="13" ry="7" fill="url(#blushGrad)" />
    <line x1="84" y1="140" x2="89" y2="144" stroke="#fb7185" stroke-width="1.5" stroke-linecap="round" />
    <line x1="91" y1="140" x2="96" y2="144" stroke="#fb7185" stroke-width="1.5" stroke-linecap="round" />

    <ellipse cx="150" cy="142" rx="13" ry="7" fill="url(#blushGrad)" />
    <line x1="144" y1="140" x2="149" y2="144" stroke="#fb7185" stroke-width="1.5" stroke-linecap="round" />
    <line x1="151" y1="140" x2="156" y2="144" stroke="#fb7185" stroke-width="1.5" stroke-linecap="round" />

    <!-- Ears -->
    <path d="M 70 128 C 65 125, 65 137, 72 139 Z" fill="#fde2d9" />
    <path d="M 170 128 C 175 125, 175 137, 168 139 Z" fill="#fde2d9" />

    ${
      !isError
        ? `<circle cx="120" cy="143" r="1.5" fill="#f43f5e" opacity="0.6" />`
        : ""
    }

    <!-- Eyes and Expressions -->
    ${
      isError
        ? `<!-- Shocked / Flustered "> <" Eyes -->
    <g stroke="#ec4899" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M 88 125 L 102 133 L 88 141" />
      <path d="M 152 125 L 138 133 L 152 141" />
    </g>
    <path d="M 84 116 L 102 122" stroke="#be185d" stroke-width="3" stroke-linecap="round" />
    <path d="M 156 116 L 138 122" stroke="#be185d" stroke-width="3" stroke-linecap="round" />
    <path d="M 64 105 C 58 114, 58 124, 66 124 C 74 124, 74 114, 68 105 C 66 102, 65 102, 64 105 Z" fill="#38bdf8" stroke="#0284c7" stroke-width="1.5" />
    <text x="113" y="80" font-family="sans-serif" font-weight="900" font-size="26" fill="#ef4444">!</text>`
        : isNeedsApproval
        ? `<!-- Questioning Eyes & Eyebrow -->
    <g>
      <ellipse cx="96" cy="132" rx="11" ry="14" fill="url(#eyeGrad)" />
      <path d="M 85 126 Q 96 118 107 126" stroke="#1e1b4b" stroke-width="3.5" fill="none" stroke-linecap="round" />
      <circle cx="93" cy="128" r="4.5" fill="#ffffff" />
      <circle cx="99" cy="138" r="2.5" fill="#ffffff" />
      <path d="M 86 114 Q 96 108 106 113" stroke="#be185d" stroke-width="2.5" fill="none" stroke-linecap="round" />
    </g>
    <g>
      <path d="M 134 134 Q 145 125 156 134" stroke="#1e1b4b" stroke-width="3.5" fill="none" stroke-linecap="round" />
      <circle cx="145" cy="135" r="3" fill="#6366f1" />
      <path d="M 135 120 Q 146 122 154 119" stroke="#be185d" stroke-width="2.5" fill="none" stroke-linecap="round" />
    </g>
    <text x="162" y="90" font-family="sans-serif" font-weight="900" font-size="24" fill="#f59e0b">?</text>`
        : isWorking
        ? `<!-- Working Eyes: Focused with Cyber HUD Glint -->
    <g>
      <ellipse cx="96" cy="132" rx="11" ry="12" fill="url(#eyeGrad)" />
      <path d="M 84 125 Q 96 119 108 125" stroke="#1e1b4b" stroke-width="3.5" fill="none" stroke-linecap="round" />
      <circle cx="94" cy="129" r="4" fill="#ffffff" />
      <circle cx="99" cy="136" r="2" fill="#ffffff" />
      <path d="M 86 118 L 105 121" stroke="#be185d" stroke-width="2.5" stroke-linecap="round" />

      <ellipse cx="144" cy="132" rx="11" ry="12" fill="url(#eyeGrad)" />
      <path d="M 132 125 Q 144 119 156 125" stroke="#1e1b4b" stroke-width="3.5" fill="none" stroke-linecap="round" />
      <circle cx="142" cy="129" r="4" fill="#ffffff" />
      <circle cx="147" cy="136" r="2" fill="#ffffff" />
      <path d="M 154 118 L 135 121" stroke="#be185d" stroke-width="2.5" stroke-linecap="round" />

      <!-- Cyber Glasses / AR Visor -->
      <rect x="80" y="122" width="80" height="20" rx="5" fill="rgba(6, 182, 212, 0.25)" stroke="#06b6d4" stroke-width="1.5" />
      <line x1="82" y1="124" x2="98" y2="140" stroke="rgba(255,255,255,0.7)" stroke-width="2" stroke-linecap="round" />
      <text x="126" y="136" font-family="monospace" font-weight="bold" font-size="9" fill="#22d3ee">01</text>
    </g>`
        : `<!-- Normal Sparkling Anime Eyes -->
    <g>
      <ellipse cx="96" cy="131" rx="12" ry="15" fill="url(#eyeGrad)" />
      <ellipse cx="96" cy="134" rx="7" ry="9" fill="#1e1b4b" />
      <circle cx="93" cy="126" r="4.5" fill="#ffffff" />
      <circle cx="100" cy="137" r="2.5" fill="#ffffff" />
      <circle cx="91" cy="137" r="1.5" fill="#a5b4fc" />
      <path d="M 83 125 Q 96 116 109 125" stroke="#1e1b4b" stroke-width="4" fill="none" stroke-linecap="round" />
      <path d="M 81 123 L 77 119" stroke="#1e1b4b" stroke-width="2.5" stroke-linecap="round" />
      <path d="M 86 114 Q 96 110 106 114" stroke="#be185d" stroke-width="2.5" fill="none" stroke-linecap="round" />

      <ellipse cx="144" cy="131" rx="12" ry="15" fill="url(#eyeGrad)" />
      <ellipse cx="144" cy="134" rx="7" ry="9" fill="#1e1b4b" />
      <circle cx="141" cy="126" r="4.5" fill="#ffffff" />
      <circle cx="148" cy="137" r="2.5" fill="#ffffff" />
      <circle cx="139" cy="137" r="1.5" fill="#a5b4fc" />
      <path d="M 131 125 Q 144 116 157 125" stroke="#1e1b4b" stroke-width="4" fill="none" stroke-linecap="round" />
      <path d="M 159 123 L 163 119" stroke="#1e1b4b" stroke-width="2.5" stroke-linecap="round" />
      <path d="M 134 114 Q 144 110 154 114" stroke="#be185d" stroke-width="2.5" fill="none" stroke-linecap="round" />
    </g>`
    }

    <!-- Mouth -->
    ${
      isTalking
        ? `<!-- Open Talking Mouth -->
    <g>
      <path d="M 111 151 Q 120 150 129 151 C 130 162, 110 162, 111 151 Z" fill="#db2777" stroke="#9d174d" stroke-width="1.5" />
      <path d="M 115 158 Q 120 153 125 158 Q 120 163 115 158 Z" fill="#f472b6" />
    </g>`
        : isError
        ? `<!-- Wavy Trembling Mouth ﹏ -->
    <path d="M 110 155 Q 115 151 120 155 Q 125 159 130 155" fill="none" stroke="#be185d" stroke-width="2.5" stroke-linecap="round" />`
        : isWorking
        ? `<!-- Focused Small Smile -->
    <path d="M 114 153 Q 120 156 126 153" fill="none" stroke="#9d174d" stroke-width="2.5" stroke-linecap="round" />`
        : isNeedsApproval
        ? `<!-- Curious Small "o" Mouth -->
    <ellipse cx="120" cy="154" rx="4" ry="5" fill="#be185d" />
    <ellipse cx="120" cy="153" rx="2" ry="3" fill="#fef0ea" />`
        : `<!-- Gentle Closed Anime Smile -->
    <path d="M 113 151 Q 120 156 127 151" fill="none" stroke="#9d174d" stroke-width="2.5" stroke-linecap="round" />`
    }

    <!-- Front Bangs & Anime Hair -->
    <path d="M 66 105 C 65 72, 175 72, 174 105 C 174 115, 168 126, 166 138 C 164 125, 158 108, 154 102 C 148 116, 138 126, 134 130 C 130 115, 126 100, 120 98 C 114 100, 110 115, 106 130 C 102 126, 92 116, 86 102 C 82 108, 76 125, 74 138 C 72 126, 66 115, 66 105 Z" fill="url(#hairGrad)" />

    <!-- Cute Hair Shine -->
    <path d="M 80 88 Q 120 78 160 88" fill="none" stroke="rgba(255, 255, 255, 0.55)" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 6 16 6" />

    <!-- Cyber Star Hairpin -->
    <g transform="translate(78, 88)">
      <polygon points="0,-7 2,-2 7,0 2,2 0,7 -2,2 -7,0 -2,-2" fill="#22d3ee" />
      <circle cx="0" cy="0" r="1.5" fill="#ffffff" />
    </g>

    ${
      isGlitch
        ? `<!-- Glitch Lines -->
    <line x1="20" y1="90" x2="220" y2="90" stroke="#06b6d4" stroke-width="2" opacity="0.7" />
    <line x1="40" y1="140" x2="200" y2="140" stroke="#ec4899" stroke-width="1.5" opacity="0.8" />
    <line x1="10" y1="175" x2="230" y2="175" stroke="#22d3ee" stroke-width="2" opacity="0.6" stroke-dasharray="10 5" />`
        : ""
    }
  </g>
</svg>`;
}

const defaultIdleSvg = svgToDataUri(createAnimeGirlSvg("idle"));
const defaultTalkingSvg = svgToDataUri(createAnimeGirlSvg("talking"));
const defaultWorkingSvg = svgToDataUri(createAnimeGirlSvg("working"));
const defaultErrorSvg = svgToDataUri(createAnimeGirlSvg("error"));
const defaultNeedsApprovalSvg = svgToDataUri(createAnimeGirlSvg("needs_approval"));
const defaultGlitchSvg = svgToDataUri(createAnimeGirlSvg("glitch"));

/**
 * Built-in default avatar: ezgif animated companion
 */
export const DEFAULT_AVATAR: AvatarManifest = {
  id: DEFAULT_AVATAR_ID,
  name: "ezgif-75083ad0293d8d70",
  type: "animated-gif",
  preview: defaultAvatarGif,
  sprites: {
    idle: defaultAvatarGif,
    talking: defaultAvatarGif,
    working: defaultAvatarGif,
    error: defaultAvatarGif,
    needs_approval: defaultAvatarGif,
    glitch: defaultAvatarGif,
  },
};

/**
 * Built-in Anime Girl companion avatar (Aoi)
 */
export const AOI_AVATAR: AvatarManifest = {
  id: AOI_AVATAR_ID,
  name: "Aoi (Anime Companion)",
  type: "2d-sprites",
  preview: defaultIdleSvg,
  sprites: {
    idle: defaultIdleSvg,
    talking: defaultTalkingSvg,
    working: defaultWorkingSvg,
    error: defaultErrorSvg,
    needs_approval: defaultNeedsApprovalSvg,
    glitch: defaultGlitchSvg,
  },
};

/**
 * AvatarManager handles storing, loading, activating, and broadcasting avatars
 * with IndexedDB backing for large animated GIFs and custom assets.
 */
export class AvatarManager {
  private static inMemoryAvatars: AvatarManifest[] | null = null;
  private static idbSynced: boolean = false;

  /**
   * Retrieves all installed avatars from in-memory cache, localStorage, and IndexedDB.
   * Always ensures the built-in default avatar is included.
   */
  public static getInstalledAvatars(): AvatarManifest[] {
    if (this.inMemoryAvatars && this.inMemoryAvatars.length > 0) {
      return this.inMemoryAvatars;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY_AVATARS);
      let list: AvatarManifest[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          // ignore parse error
        }
      }

      if (list.length === 0) {
        list = [DEFAULT_AVATAR, AOI_AVATAR];
        try {
          localStorage.setItem(STORAGE_KEY_AVATARS, JSON.stringify(list));
        } catch {}
      }

      const defaultIdx = list.findIndex((a) => a.id === DEFAULT_AVATAR.id);
      if (defaultIdx === -1) {
        list.unshift(DEFAULT_AVATAR);
      } else {
        list[defaultIdx] = DEFAULT_AVATAR;
      }

      if (!list.some((a) => a.id === AOI_AVATAR.id)) {
        list.push(AOI_AVATAR);
      }

      this.inMemoryAvatars = list;

      // Asynchronously sync from IndexedDB to recover full large GIF data
      if (!this.idbSynced) {
        this.syncFromIndexedDB();
      }

      return this.inMemoryAvatars;
    } catch (err) {
      console.warn("[AvatarManager] Failed reading installed avatars:", err);
      this.inMemoryAvatars = [DEFAULT_AVATAR, AOI_AVATAR];
      return this.inMemoryAvatars;
    }
  }

  /**
   * Syncs avatars from IndexedDB into memory and notifies listeners if updated.
   */
  public static async syncFromIndexedDB(): Promise<AvatarManifest[]> {
    this.idbSynced = true;
    try {
      const idbList = await idbGetAllAvatars();
      const current = this.inMemoryAvatars || [DEFAULT_AVATAR, AOI_AVATAR];

      // Merge IndexedDB items into current (IndexedDB items take precedence since they contain full Data URLs)
      const map = new Map<string, AvatarManifest>();
      map.set(DEFAULT_AVATAR.id, DEFAULT_AVATAR);
      map.set(AOI_AVATAR.id, AOI_AVATAR);

      for (const item of current) {
        map.set(item.id, item);
      }
      for (const item of idbList) {
        map.set(item.id, item);
      }

      this.inMemoryAvatars = Array.from(map.values());

      // If active avatar was just hydrated with full sprites, dispatch event
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("avatar-list-updated", { detail: this.inMemoryAvatars }));
      }

      return this.inMemoryAvatars;
    } catch (err) {
      console.warn("[AvatarManager] Error syncing from IndexedDB:", err);
      return this.inMemoryAvatars || [DEFAULT_AVATAR, AOI_AVATAR];
    }
  }

  /**
   * Returns the active avatar ID.
   */
  public static getActiveAvatarId(): string {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIVE);
    if (!saved || saved === "default-anime-companion") {
      return DEFAULT_AVATAR_ID;
    }
    return saved;
  }

  /**
   * Returns the active AvatarManifest synchronously.
   */
  public static getActiveAvatar(): AvatarManifest {
    const activeId = this.getActiveAvatarId();
    const installed = this.getInstalledAvatars();
    const match = installed.find((a) => a.id === activeId);
    return match || installed[0] || DEFAULT_AVATAR;
  }

  /**
   * Returns the active AvatarManifest asynchronously, ensuring IndexedDB is queried if needed.
   */
  public static async getActiveAvatarAsync(): Promise<AvatarManifest> {
    const activeId = this.getActiveAvatarId();
    if (activeId === DEFAULT_AVATAR_ID) return DEFAULT_AVATAR;
    if (activeId === AOI_AVATAR_ID) return AOI_AVATAR;

    // Check memory first
    if (this.inMemoryAvatars) {
      const match = this.inMemoryAvatars.find((a) => a.id === activeId);
      if (match && match.sprites?.idle) return match;
    }

    // Try IndexedDB directly
    const fromIdb = await idbGetAvatar(activeId);
    if (fromIdb) {
      if (this.inMemoryAvatars) {
        const idx = this.inMemoryAvatars.findIndex((a) => a.id === activeId);
        if (idx >= 0) this.inMemoryAvatars[idx] = fromIdb;
        else this.inMemoryAvatars.push(fromIdb);
      }
      return fromIdb;
    }

    return this.getActiveAvatar();
  }

  /**
   * Sets the active avatar and emits "avatar-changed" event via Tauri IPC & window CustomEvent.
   */
  public static async setActiveAvatar(id: string): Promise<void> {
    const installed = this.getInstalledAvatars();
    let avatar = installed.find((a) => a.id === id);

    if (!avatar && id !== DEFAULT_AVATAR_ID && id !== AOI_AVATAR_ID) {
      avatar = (await idbGetAvatar(id)) || undefined;
    }

    const resolved = avatar || DEFAULT_AVATAR;

    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE, resolved.id);
    } catch {}

    // 1. Emit window event for local components
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("avatar-changed", { detail: resolved })
      );
    }

    // 2. Emit Tauri IPC event across windows (MascotWindow & DashboardWindow)
    try {
      await emit("avatar-changed", resolved);
    } catch (err) {
      console.debug("[AvatarManager] Tauri IPC emit fallback:", err);
    }
  }

  /**
   * Saves or updates an avatar manifest in IndexedDB and memory,
   * safely handling localStorage quota limitations.
   */
  public static async saveAvatar(manifest: AvatarManifest): Promise<void> {
    // 1. Ensure memory cache is initialized
    const installed = this.getInstalledAvatars();
    const existingIndex = installed.findIndex((a) => a.id === manifest.id);

    if (existingIndex >= 0) {
      installed[existingIndex] = manifest;
    } else {
      installed.push(manifest);
    }
    this.inMemoryAvatars = [...installed];

    // 2. Persist to IndexedDB (unlimited quota for large GIFs/sprites)
    await idbSaveAvatar(manifest);

    // 3. Attempt to save to localStorage as fast-boot cache
    try {
      localStorage.setItem(STORAGE_KEY_AVATARS, JSON.stringify(this.inMemoryAvatars));
    } catch (quotaErr) {
      console.warn(
        "[AvatarManager] localStorage quota exceeded. Full assets are safely saved in IndexedDB.",
        quotaErr
      );
      // Save lightweight metadata in localStorage so IDs and titles are instantly known
      try {
        const lightweight = this.inMemoryAvatars.map((a) => {
          if (a.id === DEFAULT_AVATAR_ID) return a;
          return {
            id: a.id,
            name: a.name,
            type: a.type,
            preview: a.preview?.startsWith("data:image/svg") ? a.preview : "",
            sprites: {
              idle: a.sprites?.idle?.startsWith("data:image/svg") ? a.sprites.idle : "",
              talking: "",
            },
          };
        });
        localStorage.setItem(STORAGE_KEY_AVATARS, JSON.stringify(lightweight));
      } catch {
        // ignore secondary quota errors
      }
    }

    // 4. Notify list listeners
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("avatar-list-updated", { detail: this.inMemoryAvatars })
      );
    }

    // 5. If currently active avatar was updated, re-emit change
    if (this.getActiveAvatarId() === manifest.id) {
      await this.setActiveAvatar(manifest.id);
    }
  }

  /**
   * Deletes a custom avatar. Cannot delete the default avatar.
   */
  public static async deleteAvatar(id: string): Promise<boolean> {
    if (id === DEFAULT_AVATAR_ID || id === AOI_AVATAR_ID) {
      console.warn("[AvatarManager] Cannot delete built-in avatar.");
      return false;
    }

    const installed = this.getInstalledAvatars();
    this.inMemoryAvatars = installed.filter((a) => a.id !== id);

    // Delete from IndexedDB
    await idbDeleteAvatar(id);

    // Update localStorage
    try {
      localStorage.setItem(STORAGE_KEY_AVATARS, JSON.stringify(this.inMemoryAvatars));
    } catch {}

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("avatar-list-updated", { detail: this.inMemoryAvatars })
      );
    }

    // If the deleted avatar was active, revert to default
    if (this.getActiveAvatarId() === id) {
      await this.setActiveAvatar(DEFAULT_AVATAR_ID);
    }

    return true;
  }
}
