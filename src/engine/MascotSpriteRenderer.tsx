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
}

export const MascotSpriteRenderer: React.FC<MascotSpriteRendererProps> = ({ state }) => {
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
      className={`relative select-none pointer-events-auto flex items-center justify-center transition-transform duration-300 ${
        isCurrentGif ? "mascot-anim-gif" : animationClass
      }`}
      style={{
        width: "256px",
        height: "256px",
        cursor: "grab",
      }}
    >
      <img
        src={activeSpriteUrl}
        alt={manifest.name}
        data-tauri-drag-region
        draggable={false}
        className="w-full h-full object-contain pointer-events-none select-none drop-shadow-2xl"
        style={{
          imageRendering: "auto",
        }}
      />

      <style>{`
        @keyframes mascot-breathe {
          0%, 100% {
            transform: translateY(0px) scale(1);
          }
          50% {
            transform: translateY(-4px) scale(1.01);
          }
        }

        @keyframes mascot-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px) rotate(-1.5deg); }
          40% { transform: translateX(5px) rotate(1.5deg); }
          60% { transform: translateX(-3px) rotate(-0.5deg); }
          80% { transform: translateX(3px) rotate(0.5deg); }
        }

        @keyframes mascot-question {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-3px) rotate(2deg); }
        }

        @keyframes mascot-working {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-2px) scale(0.995); }
        }

        @keyframes mascot-glitch {
          0% { transform: translate(0) }
          20% { transform: translate(-3px, 3px) }
          40% { transform: translate(-3px, -3px) }
          60% { transform: translate(3px, 3px) }
          80% { transform: translate(3px, -3px) }
          100% { transform: translate(0) }
        }

        .mascot-anim-breathe {
          animation: mascot-breathe 3.5s ease-in-out infinite;
        }

        .mascot-anim-talking {
          animation: mascot-breathe 2.6s ease-in-out infinite;
        }

        .mascot-anim-shake {
          animation: mascot-shake 0.4s ease-in-out 2;
        }

        .mascot-anim-question {
          animation: mascot-question 2.4s ease-in-out infinite;
        }

        .mascot-anim-working {
          animation: mascot-working 2.2s ease-in-out infinite;
        }

        .mascot-anim-glitch {
          animation: mascot-glitch 0.25s linear infinite;
        }

        /* Subtle gentle breathing for GIFs so internal GIF animation remains crisp and natural */
        .mascot-anim-gif {
          animation: mascot-breathe 4.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};
