/**
 * GNU General Public License v3.0
 * Avatar Schema and Manifest Definitions
 */

export interface AvatarManifest {
  id: string;
  name: string;
  type: "2d-sprites" | "3d-vrm";
  preview: string; // base64 Data URL or SVG string
  sprites: {
    idle: string;
    talking: string;
    working?: string;
    error?: string;
    needs_approval?: string;
    glitch?: string;
  };
}
