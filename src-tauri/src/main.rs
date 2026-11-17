// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Ensure native Wayland display backend is preferred when running under Wayland,
        // with automatic fallback to x11 under Xorg/XWayland.
        if std::env::var("WAYLAND_DISPLAY").is_ok() && std::env::var("GDK_BACKEND").is_err() {
            unsafe {
                std::env::set_var("GDK_BACKEND", "wayland,x11");
            }
        }
    }

    companion_lib::run()
}
