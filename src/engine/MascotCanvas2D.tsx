/**
 * GNU General Public License v3.0
 * Battery-Saving HTML5 Canvas 2D Mascot Renderer
 */

import React, { useEffect, useRef } from "react";
import { AvatarState } from "./AvatarStateMachine";

interface MascotCanvas2DProps {
  state: AvatarState;
  isBlinking?: boolean;
}

export const MascotCanvas2D: React.FC<MascotCanvas2DProps> = ({ state }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let tick = 0;

    const render = () => {
      tick++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2 + 10;
      const breatheOffset = Math.sin(tick * 0.05) * 3;

      // Handle Jitter/Flinch offsets
      let jitterX = 0;
      let jitterY = 0;
      if (state === "glitch") {
        jitterX = (Math.random() - 0.5) * 8;
        jitterY = (Math.random() - 0.5) * 4;
      } else if (state === "error") {
        // Flinch reaction
        jitterX = (Math.random() - 0.5) * 5;
        jitterY = (Math.random() - 0.5) * 3;
      }

      ctx.save();
      ctx.translate(centerX + jitterX, centerY + breatheOffset + jitterY);

      // Slight head tilt when questioning/needs_approval
      if (state === "needs_approval") {
        ctx.rotate(-0.06);
      }

      // 1. Shadow / Glow
      ctx.beginPath();
      ctx.ellipse(0, 70, 45, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle =
        state === "error"
          ? "rgba(239, 68, 68, 0.35)"
          : state === "needs_approval"
          ? "rgba(245, 158, 11, 0.35)"
          : "rgba(6, 182, 212, 0.25)";
      ctx.fill();

      // 2. Body / Torso
      ctx.beginPath();
      ctx.roundRect(-30, 0, 60, 65, 16);
      ctx.fillStyle = state === "working" ? "#1e293b" : "#0f172a";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle =
        state === "error"
          ? "#ef4444"
          : state === "needs_approval"
          ? "#f59e0b"
          : state === "glitch"
          ? "#f43f5e"
          : "#06b6d4";
      ctx.stroke();

      // 3. Head
      ctx.beginPath();
      ctx.roundRect(-42, -60, 84, 60, 20);
      ctx.fillStyle = "#020617";
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle =
        state === "error"
          ? "#ef4444"
          : state === "needs_approval"
          ? "#f59e0b"
          : state === "glitch"
          ? "#06b6d4"
          : "#38bdf8";
      ctx.stroke();

      // 4. Eyes & Expressions
      const isBlinkFrame = (tick % 160 > 152) && state !== "error" && state !== "needs_approval" && state !== "dragging";
      const eyeColor =
        state === "error"
          ? "#ef4444"
          : state === "needs_approval"
          ? "#fbbf24"
          : state === "glitch"
          ? "#ec4899"
          : "#22d3ee";

      if (isBlinkFrame) {
        // Blinking lines
        ctx.beginPath();
        ctx.moveTo(-26, -32);
        ctx.lineTo(-10, -32);
        ctx.moveTo(10, -32);
        ctx.lineTo(26, -32);
        ctx.strokeStyle = eyeColor;
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (state === "error") {
        // Expressive angry/shocked eyes: "> <" with red stroke
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 3.5;
        // Left eye ">"
        ctx.beginPath();
        ctx.moveTo(-26, -38);
        ctx.lineTo(-14, -32);
        ctx.lineTo(-26, -26);
        ctx.stroke();
        // Right eye "<"
        ctx.beginPath();
        ctx.moveTo(26, -38);
        ctx.lineTo(14, -32);
        ctx.lineTo(26, -26);
        ctx.stroke();

        // Alert exclamation mark above head
        ctx.font = "bold 20px monospace";
        ctx.fillStyle = "#ef4444";
        ctx.fillText("!", -4, -75);
      } else if (state === "needs_approval") {
        // Questioning/hesitant eyes with raised eyebrow
        // Raised left eyebrow
        ctx.beginPath();
        ctx.moveTo(-28, -44);
        ctx.lineTo(-12, -49);
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 3;
        ctx.stroke();

        // Left eye: wide curious circle
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(-18, -32, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(-20, -34, 2, 0, Math.PI * 2);
        ctx.fill();

        // Right eye: hesitant squint
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.roundRect(12, -36, 12, 8, 3);
        ctx.fill();

        // Question mark indicator above head
        ctx.font = "bold 18px monospace";
        ctx.fillStyle = "#f59e0b";
        ctx.fillText("?", -5, -75);
      } else if (state === "working") {
        // Working visor / scanlines
        ctx.fillStyle = "rgba(6, 182, 212, 0.85)";
        ctx.beginPath();
        ctx.roundRect(-28, -38, 56, 12, 4);
        ctx.fill();

        // Binary code blip
        ctx.fillStyle = "#ffffff";
        ctx.font = "9px monospace";
        ctx.fillText("0101", -12, -29);
      } else if (state === "dragging") {
        // Surprised wavy spiral eyes
        ctx.strokeStyle = eyeColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(-18, -32, 6, 0, Math.PI * 1.5);
        ctx.arc(18, -32, 6, 0, Math.PI * 1.5);
        ctx.stroke();
      } else {
        // Regular Cute Digital Eyes
        ctx.fillStyle = eyeColor;
        ctx.beginPath();
        ctx.roundRect(-24, -38, 12, 16, 4);
        ctx.roundRect(12, -38, 12, 16, 4);
        ctx.fill();

        // Eye highlights
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(-20, -34, 2, 0, Math.PI * 2);
        ctx.arc(16, -34, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // 5. Mouth (Talking animation / expressions)
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 2.5;
      if (state === "talking") {
        const mouthOpen = (Math.sin(tick * 0.4) + 1) * 3;
        ctx.beginPath();
        ctx.arc(0, -16, 4 + mouthOpen, 0.2, Math.PI - 0.2);
        ctx.stroke();
      } else if (state === "error") {
        // Zig-zag mouth
        ctx.beginPath();
        ctx.moveTo(-8, -14);
        ctx.lineTo(-3, -18);
        ctx.lineTo(3, -14);
        ctx.lineTo(8, -18);
        ctx.stroke();
      } else if (state === "needs_approval") {
        // Hesitant slightly crooked mouth
        ctx.beginPath();
        ctx.moveTo(-6, -15);
        ctx.lineTo(6, -17);
        ctx.stroke();
      } else if (state === "perched") {
        // Contented smile
        ctx.beginPath();
        ctx.arc(0, -18, 6, 0.2, Math.PI - 0.2);
        ctx.stroke();
      } else {
        // Resting small digital smile
        ctx.beginPath();
        ctx.moveTo(-5, -16);
        ctx.lineTo(5, -16);
        ctx.stroke();
      }

      // 6. Cute Antennas / Ears
      ctx.beginPath();
      ctx.moveTo(-28, -60);
      ctx.lineTo(-38, -75);
      ctx.moveTo(28, -60);
      ctx.lineTo(38, -75);
      ctx.strokeStyle =
        state === "error" ? "#ef4444" : state === "needs_approval" ? "#f59e0b" : "#38bdf8";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Antenna lights
      ctx.fillStyle =
        state === "error" ? "#ef4444" : state === "needs_approval" ? "#f59e0b" : "#06b6d4";
      ctx.beginPath();
      ctx.arc(-38, -75, 4, 0, Math.PI * 2);
      ctx.arc(38, -75, 4, 0, Math.PI * 2);
      ctx.fill();

      // 7. Perched pose leg dangling indicator
      if (state === "perched") {
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-15, 65);
        ctx.lineTo(-15, 78);
        ctx.moveTo(15, 65);
        ctx.lineTo(15, 78);
        ctx.stroke();
      }

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [state]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={220}
      className="cursor-grab active:cursor-grabbing select-none"
    />
  );
};
