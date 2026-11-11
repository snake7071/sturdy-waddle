// GNU General Public License v3.0
// Cross-Platform Screen Capture Engine ("On-Demand Vision")

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use image::imageops::FilterType;
use image::{DynamicImage, ImageEncoder};
use std::io::Cursor;
use xcap::{Monitor, Window as XCapWindow};

/// Captures a snapshot of the active/primary screen, downscales it so the longest edge is max 1080p,
/// compresses it to JPEG (~70% quality), and returns it as a Base64-encoded string.
#[tauri::command]
pub fn capture_screen_snapshot() -> Result<String, String> {
    // 1. Enumerate all connected monitors
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    if monitors.is_empty() {
        return Err("No monitors detected on host".to_string());
    }

    // 2. Identify target monitor:
    // Identify monitor where the active/focused window is located,
    // or fallback to the primary monitor, and finally to the first monitor.
    let monitor = XCapWindow::all()
        .ok()
        .and_then(|windows| {
            windows
                .into_iter()
                .find(|w| w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
                .and_then(|w| w.current_monitor().ok())
        })
        .or_else(|| {
            monitors
                .iter()
                .find(|m| m.is_primary().unwrap_or(false))
                .cloned()
        })
        .or_else(|| monitors.first().cloned())
        .ok_or_else(|| "Could not determine target monitor for capture".to_string())?;

    // 3. Capture screen frame as RgbaImage
    let frame = monitor
        .capture_image()
        .map_err(|e| format!("Screen capture failed: {}", e))?;

    let dyn_image = DynamicImage::ImageRgba8(frame);

    // 4. Optimization: Downscale so longest edge is max 1080p preserving aspect ratio
    let (width, height) = (dyn_image.width(), dyn_image.height());
    let max_edge = 1080;
    let resized = if width > max_edge || height > max_edge {
        dyn_image.resize(max_edge, max_edge, FilterType::Triangle)
    } else {
        dyn_image
    };

    // 5. Compress to JPEG format (quality ~70%)
    let rgb_image = resized.to_rgb8();
    let mut jpeg_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut jpeg_bytes);

    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 70);
    encoder
        .write_image(
            rgb_image.as_raw(),
            rgb_image.width(),
            rgb_image.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("JPEG compression failed: {}", e))?;

    // 6. Return Base64 encoded string
    let b64_string = BASE64_STANDARD.encode(&jpeg_bytes);
    Ok(b64_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capture_screen_compiles() {
        if let Ok(monitors) = Monitor::all() {
            let _ = monitors.first().cloned();
        }
    }

    #[test]
    fn test_capture_screen_execution() {
        match capture_screen_snapshot() {
            Ok(b64) => println!("Captured successfully: {} bytes", b64.len()),
            Err(e) => println!("Capture error: {}", e),
        }
    }
}
