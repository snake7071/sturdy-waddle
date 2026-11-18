/**
 * GNU General Public License v3.0
 * Screen Annotation Primitives & Normalized Coordinate Contracts (0-1000)
 */

export type AnnotationShapeType =
  | "circle"
  | "rect"
  | "arrow"
  | "freehand"
  | "square"
  | "box"
  | "rectangle";

export interface NormalizedPoint {
  x: number; // 0 - 1000
  y: number; // 0 - 1000
}

export interface AnnotationShape {
  id?: string;
  type: AnnotationShapeType;
  color?: string; // hex code e.g. #EBA821 (amber), #D94848 (crimson)
  strokeWidth?: number; // relative or px
  fill?: string;

  // Circle / Rect
  x?: number; // 0 - 1000
  y?: number; // 0 - 1000
  radius?: number; // 0 - 1000 (aspect-ratio preserved)

  // Rect / Square
  width?: number; // 0 - 1000
  height?: number; // 0 - 1000
  size?: number; // 0 - 1000 (for square/box)
  centered?: boolean; // if true, (x, y) is center of rect instead of top-left
  rounded?: number; // radius in px

  // Arrow
  startX?: number; // 0 - 1000
  startY?: number; // 0 - 1000
  endX?: number; // 0 - 1000
  endY?: number; // 0 - 1000

  // Freehand path
  points?: NormalizedPoint[];

  // Optional callout label
  label?: string;
  labelPosition?: "top" | "bottom" | "left" | "right" | "auto";
}

export interface DrawOnScreenPayload {
  shapes: AnnotationShape[];
  durationSeconds?: number; // default ~6
  explanation?: string;
  message?: string;
}

export interface ActiveAnnotationBatch {
  id: string;
  shapes: AnnotationShape[];
  createdAt: number;
  durationMs: number;
  fadingOut?: boolean;
}

/**
 * Robustly normalizes arbitrary LLM tool inputs into standard DrawOnScreenPayload:
 * - Unwraps double-wrapped payloads ({ payload: { ... } })
 * - Handles flat arguments ({ type: "rect", x: 400, ... }) without 'shapes' array
 * - Handles JSON-stringified shapes
 * - Normalizes synonyms (square, box, rectangle -> rect; point, round -> circle; pointer -> arrow)
 * - Automatically computes center offset for square/box primitives
 */
export function normalizeDrawOnScreenPayload(raw: any): DrawOnScreenPayload {
  if (!raw || typeof raw !== "object") {
    return { shapes: [], durationSeconds: 6 };
  }

  const data =
    raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
      ? raw.payload
      : raw;

  let shapes: any[] = [];
  if (Array.isArray(data.shapes)) {
    shapes = data.shapes;
  } else if (typeof data.shapes === "string") {
    try {
      const parsed = JSON.parse(data.shapes);
      if (Array.isArray(parsed)) shapes = parsed;
      else if (parsed && typeof parsed === "object") shapes = [parsed];
    } catch {}
  } else if (data.shape && typeof data.shape === "object") {
    shapes = [data.shape];
  } else if (data.type) {
    // LLM passed flat shape arguments directly
    shapes = [data];
  }

  const normalizedShapes: AnnotationShape[] = shapes
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const rawType = String(s.type || "circle").toLowerCase().trim();
      let type: AnnotationShapeType = "circle";

      if (rawType === "rect" || rawType === "rectangle" || rawType === "frame") {
        type = "rect";
      } else if (rawType === "square" || rawType === "box") {
        type = "square";
      } else if (
        rawType === "circle" ||
        rawType === "round" ||
        rawType === "oval" ||
        rawType === "ring" ||
        rawType === "dot" ||
        rawType === "point"
      ) {
        type = "circle";
      } else if (
        rawType === "arrow" ||
        rawType === "pointer" ||
        rawType === "line" ||
        rawType === "vector"
      ) {
        type = "arrow";
      } else if (
        rawType === "freehand" ||
        rawType === "path" ||
        rawType === "doodle" ||
        rawType === "draw" ||
        rawType === "drawing" ||
        rawType === "sketch"
      ) {
        type = "freehand";
      }

      let x = typeof s.x === "number" ? s.x : undefined;
      let y = typeof s.y === "number" ? s.y : undefined;
      let width: number | undefined;
      let height: number | undefined;
      let size: number | undefined;

      if (type === "square") {
        // Square/box: (x, y) is the CENTER and a single size defines a true square side length.
        size = s.size ?? s.width ?? s.w ?? s.height ?? s.h ?? 140;
        width = size;
        height = size;
      } else {
        width = s.width ?? s.w ?? s.size;
        height = s.height ?? s.h ?? s.size;
        const isCentered = s.centered === true || s.center === true;
        if (
          isCentered &&
          x !== undefined &&
          y !== undefined &&
          width !== undefined &&
          height !== undefined
        ) {
          x = Math.max(0, Math.round(x - width / 2));
          y = Math.max(0, Math.round(y - height / 2));
        }
      }

      return {
        ...s,
        type,
        x,
        y,
        width,
        height,
        size,
      };
    });

  const durationSeconds =
    typeof data.durationSeconds === "number" && data.durationSeconds > 0
      ? data.durationSeconds
      : typeof raw.durationSeconds === "number" && raw.durationSeconds > 0
      ? raw.durationSeconds
      : 6;

  const explanation =
    typeof data.explanation === "string"
      ? data.explanation
      : typeof data.message === "string"
      ? data.message
      : typeof raw.explanation === "string"
      ? raw.explanation
      : typeof raw.message === "string"
      ? raw.message
      : undefined;

  return {
    shapes: normalizedShapes,
    durationSeconds,
    explanation,
    message: explanation,
  };
}
