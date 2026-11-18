// GNU General Public License v3.0
// Cross-Platform Screen Capture Engine ("On-Demand Vision")

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use image::imageops::FilterType;
use image::{DynamicImage, ImageEncoder};
use serde::Serialize;
use std::io::Cursor;
use xcap::{Monitor, Window as XCapWindow};

/// Selects the monitor for capture: the one hosting the focused window, else the primary,
/// else the first available monitor.
fn select_monitor() -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    if monitors.is_empty() {
        return Err("No monitors detected on host".to_string());
    }

    XCapWindow::all()
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
        .ok_or_else(|| "Could not determine target monitor for capture".to_string())
}

/// Captures the monitor frame, downscales the longest edge to 1080p preserving aspect ratio,
/// and encodes it as JPEG (~70% quality) into a Base64 string.
fn capture_and_encode(monitor: &Monitor) -> Result<String, String> {
    let frame = monitor
        .capture_image()
        .map_err(|e| format!("Screen capture failed: {}", e))?;

    let dyn_image = DynamicImage::ImageRgba8(frame);

    // Downscale so the longest edge is max 1080p, preserving aspect ratio.
    // NOTE: using imageops::resize(max_edge, max_edge, ..) here would squash the frame into a
    // square and distort the aspect ratio, which in turn makes the LLM misjudge element positions
    // and sizes when drawing annotations. We compute proportional dimensions instead.
    let (width, height) = (dyn_image.width(), dyn_image.height());
    let max_edge = 1080.0;
    let resized = if (width as f32) > max_edge || (height as f32) > max_edge {
        let scale = if width >= height {
            max_edge / width as f32
        } else {
            max_edge / height as f32
        };
        let new_w = ((width as f32 * scale).round() as u32).max(1);
        let new_h = ((height as f32 * scale).round() as u32).max(1);
        dyn_image.resize_exact(new_w, new_h, FilterType::Triangle)
    } else {
        dyn_image
    };

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

    Ok(BASE64_STANDARD.encode(&jpeg_bytes))
}

/// Captures a snapshot of the active/primary screen and returns it as a Base64-encoded JPEG string.
#[tauri::command]
pub fn capture_screen_snapshot() -> Result<String, String> {
    let monitor = select_monitor()?;
    capture_and_encode(&monitor)
}

/// Monitor geometry + capture, returned together so callers can map the normalized 0-1000
/// coordinate grid used by the model and overlay back to physical pixels.
#[derive(Serialize, Clone, Debug)]
pub struct ScreenCaptureGeometry {
    pub base64_image: String,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub x: i32,
    pub y: i32,
}

#[tauri::command]
pub fn capture_screen_geometry() -> Result<ScreenCaptureGeometry, String> {
    let monitor = select_monitor()?;
    let base64_image = capture_and_encode(&monitor)?;
    Ok(ScreenCaptureGeometry {
        base64_image,
        width: monitor.width().unwrap_or(0),
        height: monitor.height().unwrap_or(0),
        scale_factor: monitor.scale_factor().unwrap_or(1.0) as f64,
        x: monitor.x().unwrap_or(0),
        y: monitor.y().unwrap_or(0),
    })
}

/// Maps a normalized (0..1000, 0..1000) coordinate to LOGICAL screen pixels on the
/// active monitor (physical pixels divided by the scale factor). This matches the
/// coordinate space used by compositor input: `hl.dsp.cursor.move` on Hyprland and
/// `xdotool mousemove` on X11.
pub fn normalized_to_logical(nx: f64, ny: f64) -> Result<(i32, i32), String> {
    let monitor = select_monitor()?;
    let scale = (monitor.scale_factor().unwrap_or(1.0) as f64).max(0.1);
    let logical_w = monitor.width().unwrap_or(0) as f64 / scale;
    let logical_h = monitor.height().unwrap_or(0) as f64 / scale;
    let lx = (nx.clamp(0.0, 1000.0) / 1000.0) * logical_w;
    let ly = (ny.clamp(0.0, 1000.0) / 1000.0) * logical_h;
    Ok((lx.round() as i32, ly.round() as i32))
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
