/**
 * GNU General Public License v3.0
 * Mascot Dynamic Sprite Renderer Component
 * Supports Animated GIFs (continuous playback for idle/talking/working/error)
 * and Static PNG/SVG sprites (CSS mouth-flap animation during speech streaming).
 */

import React, { useEffect, useState } from "react";
import { AvatarState } from "./AvatarStateMachine";
import { AvatarManifest } from "../types/avatar";
import { AvatarManager } from "./AvatarManager";

interface MascotSpriteRendererProps {
  state: AvatarState;
  scale?: number;
}

export const MascotSpriteRenderer: React.FC<MascotSpriteRendererProps> = ({ state, scale = 1.0 }) => {
  const [manifest, setManifest] = useState<AvatarManifest>(() =>
    AvatarManager.getActiveAvatar()
  );

  // Listen for avatar skin changes emitted globally or from manager
  useEffect(() => {
    const handleAvatarChanged = (e?: any) => {
      console.log("[MascotSpriteRenderer] avatar-changed event received:", e?.detail);
      setManifest(AvatarManager.getActiveAvatar());
    };

    window.addEventListener("avatar-changed", handleAvatarChanged);

    // Initial check in case IndexedDB refreshed active manifest
    AvatarManager.syncFromIndexedDB().then(() => {
      setManifest(AvatarManager.getActiveAvatar());
    });

    return () => {
      window.removeEventListener("avatar-changed", handleAvatarChanged);
    };
  }, []);

  // Check if a sprite URL is an animated GIF
  const isGifUrl = (url?: string): boolean => {
    if (!url) return false;
    return (
      url.startsWith("data:image/gif") ||
      url.endsWith(".gif") ||
      url.includes(".gif?") ||
      url.includes("image/gif")
    );
  };

  const sprites = manifest.sprites;
  const idleSprite = sprites.idle;

  // Determine active sprite and CSS animation class
  let activeSpriteUrl = idleSprite;
  let animationClass = "mascot-anim-breathe";

  switch (state) {
    case "talking":
      activeSpriteUrl = sprites.talking || idleSprite;
      animationClass = "mascot-anim-talking";
      break;

    case "error":
      activeSpriteUrl = sprites.error || idleSprite;
      animationClass = "mascot-anim-shake";
      break;

    case "needs_approval":
      activeSpriteUrl = sprites.needs_approval || idleSprite;
      animationClass = "mascot-anim-question";
      break;

    case "working":
      activeSpriteUrl = sprites.working || idleSprite;
      animationClass = "mascot-anim-working";
      break;

    case "glitch":
      activeSpriteUrl = sprites.glitch || sprites.working || sprites.idle || idleSprite;
      animationClass = "mascot-anim-glitch";
      break;

    case "idle":
    case "perched":
    case "dragging":
    default:
      activeSpriteUrl = idleSprite;
      animationClass = "mascot-anim-breathe";
      break;
  }

  const isCurrentGif = isGifUrl(activeSpriteUrl);

  return (
    <div
      data-tauri-drag-region
      className={`relative select-none pointer-events-auto flex items-center justify-center ${
        isCurrentGif ? "mascot-anim-gif" : animationClass
      }`}
      style={{
        width: `${Math.round(256 * scale)}px`,
        height: `${Math.round(256 * scale)}px`,
        cursor: "grab",
      }}
    >
      <img
        src={activeSpriteUrl}
        alt={manifest.name}
        data-tauri-drag-region
        draggable={false}
        className="w-full h-full object-contain pointer-events-auto select-none cursor-grab active:cursor-grabbing"
        style={{
          imageRendering: "auto",
        }}
      />

      <style>{`
        @keyframes mascot-breathe {
          0%, 100% {
            transform: translate3d(0, 0px, 0);
          }
          50% {
            transform: translate3d(0, -3px, 0);
          }
        }

        @keyframes mascot-shake {
          0%, 100% { transform: translate3d(0, 0, 0); }
          20% { transform: translate3d(-4px, 0, 0); }
          40% { transform: translate3d(4px, 0, 0); }
          60% { transform: translate3d(-2px, 0, 0); }
          80% { transform: translate3d(2px, 0, 0); }
        }

        @keyframes mascot-question {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(0, -3px, 0); }
        }

        @keyframes mascot-working {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(0, -2px, 0); }
        }

        @keyframes mascot-glitch {
          0% { transform: translate3d(0, 0, 0); }
          25% { transform: translate3d(-2px, 2px, 0); }
          50% { transform: translate3d(2px, -2px, 0); }
          75% { transform: translate3d(-1px, 1px, 0); }
          100% { transform: translate3d(0, 0, 0); }
        }

        .mascot-anim-breathe {
          animation: mascot-breathe 4s ease-in-out infinite;
          will-change: transform;
        }

        .mascot-anim-talking {
          animation: mascot-breathe 2.5s ease-in-out infinite;
          will-change: transform;
        }

        .mascot-anim-shake {
          animation: mascot-shake 0.4s ease-in-out 2;
          will-change: transform;
        }

        .mascot-anim-question {
          animation: mascot-question 3s ease-in-out infinite;
          will-change: transform;
        }

        .mascot-anim-working {
          animation: mascot-working 2.5s ease-in-out infinite;
          will-change: transform;
        }

        .mascot-anim-glitch {
          animation: mascot-glitch 0.25s linear infinite;
          will-change: transform;
        }

        /* GIFs handle their own internal frame playback smoothly */
        .mascot-anim-gif {
          /* No external transform needed for GIFs to prevent double-invalidation */
        }
      `}</style>
    </div>
  );
};
