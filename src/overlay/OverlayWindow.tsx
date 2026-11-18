/**
 * GNU General Public License v3.0
 * Fullscreen Click-Through Screen Annotation Overlay (SAO HUD Aesthetic)
 */

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  DrawOnScreenPayload,
  ActiveAnnotationBatch,
  NormalizedPoint,
  normalizeDrawOnScreenPayload,
} from "../types/annotations";

const DEFAULT_COLOR = "#EBA821"; // SAO Amber Gold
const WARNING_COLOR = "#D94848"; // SAO Crimson

/**
 * Computes smooth SVG path through a series of normalized points using quadratic bezier curves
 */
function pointsToSvgPath(points: NormalizedPoint[] | undefined, W: number, H: number): string {
  if (!points || points.length === 0) return "";
  const pts = points.map((p) => ({
    x: (p.x / 1000) * W,
    y: (p.y / 1000) * H,
  }));

  if (pts.length === 1) {
    return `M ${pts[0].x} ${pts[0].y} m -3,0 a 3,3 0 1,0 6,0 a 3,3 0 1,0 -6,0`;
  }
  if (pts.length === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    const yc = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y}, ${xc} ${yc}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * Normalizes color inputs (supports friendly names like "gold", "crimson", "red")
 */
function resolveColor(input?: string): string {
  if (!input) return DEFAULT_COLOR;
  const lower = input.trim().toLowerCase();
  if (lower === "crimson" || lower === "red" || lower === "warning" || lower === "error") {
    return WARNING_COLOR;
  }
  if (lower === "gold" || lower === "amber" || lower === "yellow" || lower === "default") {
    return DEFAULT_COLOR;
  }
  if (lower === "green" || lower === "success") {
    return "#2E9E6B";
  }
  if (lower === "blue" || lower === "cyan") {
    return "#00D2FF";
  }
  return input;
}

export const OverlayWindow: React.FC = () => {
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: typeof window !== "undefined" ? (window.innerWidth || window.screen.width || 1920) : 1920,
    height: typeof window !== "undefined" ? (window.innerHeight || window.screen.height || 1080) : 1080,
  });

  const [batches, setBatches] = useState<ActiveAnnotationBatch[]>([]);
  const batchesRef = useRef<ActiveAnnotationBatch[]>([]);
  batchesRef.current = batches;

  // Track window resizing and initial full screen sync
  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth || window.screen.width || 1920,
        height: window.innerHeight || window.screen.height || 1080,
      });
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Safe dismiss & hide
  const dismissAll = useCallback(() => {
    setBatches([]);
    invoke("hide_overlay").catch(() => {});
  }, []);

  // Normalize an arbitrary payload and append it as a new annotation batch
  const handleRawPayload = useCallback((raw: any) => {
    const payload = normalizeDrawOnScreenPayload(raw);
    if (!payload || !Array.isArray(payload.shapes) || payload.shapes.length === 0) {
      return;
    }

    const durationSec =
      typeof payload.durationSeconds === "number" && payload.durationSeconds > 0
        ? payload.durationSeconds
        : 6;

    const newBatch: ActiveAnnotationBatch = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      shapes: payload.shapes,
      createdAt: Date.now(),
      durationMs: durationSec * 1000,
      fadingOut: false,
    };

    setBatches((prev) => [...prev, newBatch]);
  }, []);

  // Fetch any annotation that was emitted before this WebView finished loading,
  // so the very first draw-on-screen call is never silently dropped.
  useEffect(() => {
    let cancelled = false;
    invoke<any>("take_pending_annotation")
      .then((raw) => {
        if (!cancelled && raw) {
          handleRawPayload(raw);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [handleRawPayload]);

  // Listen for draw and clear events
  useEffect(() => {
    const unlistenDraw = listen<DrawOnScreenPayload>("draw-on-screen", (event) => {
      handleRawPayload(event.payload);
    });

    const unlistenClear = listen("clear-screen-annotations", () => {
      dismissAll();
    });

    return () => {
      unlistenDraw.then((fn) => fn());
      unlistenClear.then((fn) => fn());
    };
  }, [dismissAll, handleRawPayload]);

  // TTL Auto-cleanup interval
  useEffect(() => {
    if (batches.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const updated: ActiveAnnotationBatch[] = [];
      let stateChanged = false;

      for (const batch of batchesRef.current) {
        const elapsed = now - batch.createdAt;
        const remaining = batch.durationMs - elapsed;

        if (remaining <= 0) {
          // Expired: prune
          stateChanged = true;
          continue;
        }

        // Trigger fade out in last 700ms
        if (remaining <= 700 && !batch.fadingOut) {
          updated.push({ ...batch, fadingOut: true });
          stateChanged = true;
        } else {
          updated.push(batch);
        }
      }

      if (stateChanged) {
        setBatches(updated);
        if (updated.length === 0) {
          invoke("hide_overlay").catch(() => {});
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [batches.length]);

  const { width: W, height: H } = dimensions;

  // DPI/resolution scale factor for fixed-pixel strokes, arrowheads and reticle ticks so the
  // annotations stay legible on HiDPI displays and crisp on low-res screens.
  const dpiScale = Math.max(0.75, Math.min(2.5, Math.min(W, H) / 1080));

  // Flatten active shapes for rendering
  const activeElements = useMemo(() => {
    return batches.flatMap((batch) =>
      batch.shapes.map((shape, idx) => ({
        shape,
        batchId: batch.id,
        key: `${batch.id}-${idx}`,
        fadingOut: batch.fadingOut,
      }))
    );
  }, [batches]);

  return (
    <div className="fixed inset-0 w-screen h-screen pointer-events-none select-none overflow-hidden bg-transparent z-[999999]">
      <svg
        className="w-full h-full pointer-events-none overflow-visible"
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: W, height: H }}
      >
        <defs>
          {/* SAO HUD Glow Filter */}
          <filter id="sao-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="
                1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 1.6 0"
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* High-Contrast Drop Shadow for legibility over light backgrounds */}
          <filter id="sao-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.85" />
          </filter>
        </defs>

        {activeElements.map(({ shape, key, fadingOut }) => {
          const color = resolveColor(shape.color);
          const strokeWidth = (shape.strokeWidth ?? 3) * dpiScale;

          return (
            <g
              key={key}
              filter="url(#sao-shadow)"
              className={`transition-opacity duration-700 ease-out ${
                fadingOut ? "opacity-0" : "opacity-100"
              }`}
            >
              {/* Primitive 1: Circle */}
              {(shape.type === "circle" || (shape as any).type === "round") && (() => {
                const cx = ((shape.x ?? 500) / 1000) * W;
                const cy = ((shape.y ?? 500) / 1000) * H;
                // Radius uses the same horizontal scale as x, so a radius of N spans the exact
                // same fraction of the screen width as an x-coordinate of N. Rendered as a true
                // circle (single r) so it stays round regardless of the display aspect ratio.
                const r = ((shape.radius ?? 50) / 1000) * W;
                const tickLen = Math.max(6 * dpiScale, Math.min(14 * dpiScale, r * 0.2));

                return (
                  <g className="animate-sao-draw">
                    {/* Soft glowing radar backdrop */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={color}
                      fillOpacity={0.07}
                    />
                    {/* Main Target Ring */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="none"
                      stroke={color}
                      strokeWidth={strokeWidth}
                      strokeDasharray="4 2"
                      filter="url(#sao-glow)"
                    />
                    {/* Inner Solid Ring */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={Math.max(2 * dpiScale, r - 3 * dpiScale)}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5 * dpiScale}
                    />
                    {/* Center Reticle Point */}
                    <circle cx={cx} cy={cy} r={2.5 * dpiScale} fill={color} />
                    {/* SAO 4-Axis Reticle Crosshair Ticks */}
                    <line x1={cx - r - tickLen} y1={cy} x2={cx - r + tickLen * 0.4} y2={cy} stroke={color} strokeWidth={2 * dpiScale} />
                    <line x1={cx + r - tickLen * 0.4} y1={cy} x2={cx + r + tickLen} y2={cy} stroke={color} strokeWidth={2 * dpiScale} />
                    <line x1={cx} y1={cy - r - tickLen} x2={cx} y2={cy - r + tickLen * 0.4} stroke={color} strokeWidth={2 * dpiScale} />
                    <line x1={cx} y1={cy + r - tickLen * 0.4} x2={cx} y2={cy + r + tickLen} stroke={color} strokeWidth={2 * dpiScale} />
                  </g>
                );
              })()}

              {/* Primitive 2: Rect / Square / Box (SAO Framing Box) */}
              {(shape.type === "rect" ||
                shape.type === "square" ||
                shape.type === "box" ||
                shape.type === "rectangle") && (() => {
                const isSquare = shape.type === "square" || shape.type === "box";

                let x: number;
                let y: number;
                let w: number;
                let h: number;

                if (isSquare) {
                  // Square: (x, y) is the CENTER; the side uses a single uniform scale so it
                  // renders as a true square rather than a stretched rectangle on non-1:1 screens.
                  const side = (((shape as any).size ?? shape.width ?? 140) / 1000) * Math.min(W, H);
                  x = ((shape.x ?? 500) / 1000) * W - side / 2;
                  y = ((shape.y ?? 500) / 1000) * H - side / 2;
                  w = side;
                  h = side;
                } else {
                  // Rect: (x, y) is top-left. Width maps to screen width and height maps to screen
                  // height, matching how the model estimates horizontal vs vertical extents.
                  w = ((shape.width ?? (shape as any).size ?? 120) / 1000) * W;
                  h = ((shape.height ?? (shape as any).size ?? 80) / 1000) * H;
                  x = ((shape.x ?? 100) / 1000) * W;
                  y = ((shape.y ?? 100) / 1000) * H;
                }

                const rx = shape.rounded ?? 4;
                const corner = Math.min(16 * dpiScale, Math.min(w, h) * 0.3);

                return (
                  <g className="animate-sao-draw">
                    {/* Translucent Highlight Fill */}
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      rx={rx}
                      fill={color}
                      fillOpacity={0.06}
                    />
                    {/* Main Border */}
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      rx={rx}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5 * dpiScale}
                      strokeDasharray="6 3"
                      filter="url(#sao-glow)"
                    />
                    {/* SAO HUD 4 Corner Reticle Accents */}
                    <path
                      d={`M ${x} ${y + corner} L ${x} ${y} L ${x + corner} ${y}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={strokeWidth}
                    />
                    <path
                      d={`M ${x + w - corner} ${y} L ${x + w} ${y} L ${x + w} ${y + corner}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={strokeWidth}
                    />
                    <path
                      d={`M ${x + w} ${y + h - corner} L ${x + w} ${y + h} L ${x + w - corner} ${y + h}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={strokeWidth}
                    />
                    <path
                      d={`M ${x + corner} ${y + h} L ${x} ${y + h} L ${x} ${y + h - corner}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={strokeWidth}
                    />
                  </g>
                );
              })()}

              {/* Primitive 3: Arrow */}
              {(shape.type === "arrow" || (shape as any).type === "pointer") && (() => {
                const x1 = ((shape.startX ?? 100) / 1000) * W;
                const y1 = ((shape.startY ?? 100) / 1000) * H;
                const x2 = ((shape.endX ?? 300) / 1000) * W;
                const y2 = ((shape.endY ?? 300) / 1000) * H;

                const angle = Math.atan2(y2 - y1, x2 - x1);
                // Fixed-pixel arrowhead scaled to DPI for consistent proportions across resolutions
                const arrowLen = 16 * dpiScale;
                const arrowWidth = 8 * dpiScale;

                const p1x = x2 - arrowLen * Math.cos(angle) + arrowWidth * Math.sin(angle);
                const p1y = y2 - arrowLen * Math.sin(angle) - arrowWidth * Math.cos(angle);
                const p2x = x2 - arrowLen * Math.cos(angle) - arrowWidth * Math.sin(angle);
                const p2y = y2 - arrowLen * Math.sin(angle) + arrowWidth * Math.cos(angle);

                return (
                  <g className="animate-sao-draw">
                    {/* Origin HUD Node */}
                    <circle cx={x1} cy={y1} r={3.5 * dpiScale} fill={color} />
                    <circle cx={x1} cy={y1} r={6 * dpiScale} fill="none" stroke={color} strokeWidth={1.5 * dpiScale} />
                    {/* Connecting Vector Stem */}
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={color}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      filter="url(#sao-glow)"
                    />
                    {/* Precision Arrowhead */}
                    <polygon
                      points={`${x2},${y2} ${p1x},${p1y} ${x2 - arrowLen * 0.65 * Math.cos(angle)},${y2 - arrowLen * 0.65 * Math.sin(angle)} ${p2x},${p2y}`}
                      fill={color}
                      filter="url(#sao-glow)"
                    />
                  </g>
                );
              })()}

              {/* Primitive 4: Freehand (Underline, Doodles, Paths) */}
              {(shape.type === "freehand" ||
                (shape as any).type === "path" ||
                (shape as any).type === "doodle") && (() => {
                const pathD = pointsToSvgPath(shape.points, W, H);
                if (!pathD) return null;

                return (
                  <g className="animate-sao-draw">
                    <path
                      d={pathD}
                      fill="none"
                      stroke={color}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter="url(#sao-glow)"
                    />
                  </g>
                );
              })()}

              {/* Attached SAO HUD Callout Label */}
              {shape.label && (() => {
                // Determine sensible anchor for callout box
                let lx = 500;
                let ly = 500;
                if (shape.type === "circle" || (shape as any).type === "round") {
                  const r = ((shape.radius ?? 50) / 1000) * Math.min(W, H);
                  lx = ((shape.x ?? 500) / 1000) * W;
                  ly = ((shape.y ?? 500) / 1000) * H - r - 12;
                } else if (
                  shape.type === "rect" ||
                  (shape as any).type === "square" ||
                  (shape as any).type === "box" ||
                  (shape as any).type === "rectangle"
                ) {
                  lx = ((shape.x ?? 100) / 1000) * W;
                  ly = ((shape.y ?? 100) / 1000) * H - 12;
                } else if (shape.type === "arrow") {
                  lx = ((shape.endX ?? 300) / 1000) * W;
                  ly = ((shape.endY ?? 300) / 1000) * H - 16;
                } else if (shape.type === "freehand" && shape.points && shape.points[0]) {
                  lx = (shape.points[0].x / 1000) * W;
                  ly = (shape.points[0].y / 1000) * H - 12;
                }

                // Keep label on screen boundaries
                const clampX = Math.max(16, Math.min(W - 220, lx));
                const clampY = Math.max(24, Math.min(H - 40, ly));

                return (
                  <foreignObject
                    x={clampX}
                    y={clampY - 24}
                    width={260}
                    height={48}
                    className="overflow-visible pointer-events-none"
                  >
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#12141A]/95 border border-white/20 shadow-2xl backdrop-blur-md">
                      <span
                        className="w-1.5 h-1.5 rotate-45 shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span
                        className="text-[11px] font-mono font-bold tracking-wide uppercase select-none whitespace-nowrap"
                        style={{ color }}
                      >
                        {shape.label}
                      </span>
                    </div>
                  </foreignObject>
                );
              })()}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
