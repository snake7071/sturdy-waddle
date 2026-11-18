// GNU General Public License v3.0
// Cross-platform low-level input emulation (mouse + keyboard).
//
// Linux uses a fallback chain:
//   - Mouse  : ydotool (Wayland/X11, uinput) -> xdotool (X11)
//   - Keyboard: wtype (Wayland virtual-keyboard) -> xdotool (X11)
//   - Non-ASCII text: clipboard paste via wl-copy (Wayland) / xclip (X11)
//
// Windows and macOS return explicit "not implemented" errors from the trait layer
// until dedicated SendInput / CGEvent backends are added.

use std::io::Write;
use std::process::{Command, Stdio};

fn has_bin(bin: &str) -> bool {
    Command::new("sh")
        .args(["-c", &format!("command -v {} >/dev/null 2>&1", bin)])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn is_hyprland() -> bool {
    has_bin("hyprctl") && std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_ok()
}

/// Moves the cursor using Hyprland's native dispatcher (logical coordinates, correct
/// under fractional scaling). This is the reliable path on Hyprland >= 0.55 (Lua API).
fn hyprctl_move_cursor(x: i32, y: i32) -> Result<(), String> {
    run(
        "hyprctl",
        &[
            s("dispatch"),
            format!("hl.dsp.cursor.move({{ x = {}, y = {} }})", x, y),
        ],
    )
}

fn run(bin: &str, args: &[String]) -> Result<(), String> {
    let status = Command::new(bin)
        .args(args)
        .status()
        .map_err(|e| format!("Failed to run {}: {}", bin, e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{} exited with status {:?}", bin, status.code()))
    }
}

fn s(v: &str) -> String {
    v.to_string()
}

fn run_with_stdin(bin: &str, args: &[String], input: &str) -> Result<(), String> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", bin, e))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
    }
    let status = child.wait().map_err(|e| format!("Failed to wait on {}: {}", bin, e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{} exited with status {:?}", bin, status.code()))
    }
}

fn run_capture(bin: &str, args: &[String]) -> Option<String> {
    let output = Command::new(bin)
        .args(args)
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        None
    }
}

/// Moves the cursor to the physical pixel position (x, y) and clicks.
/// `button` is "left" | "right" | "middle"; `click_type` is "single" | "double".
pub fn mouse_click(x: i32, y: i32, button: &str, click_type: &str) -> Result<(), String> {
    let clicks = if click_type == "double" { 2 } else { 1 };

    if is_hyprland() {
        // Hyprland: native cursor move (logical coords) + ydotool for the click itself.
        hyprctl_move_cursor(x, y)?;
        let btn = match button {
            "right" => "0x01",
            "middle" => "0x02",
            _ => "0x00",
        };
        run("ydotool", &[s("click"), s("--repeat"), clicks.to_string(), s(btn)])?;
        Ok(())
    } else if has_bin("xdotool") {
        let btn = match button {
            "right" => "3",
            "middle" => "2",
            _ => "1",
        };
        run(
            "xdotool",
            &[
                s("mousemove"),
                s("--sync"),
                x.to_string(),
                y.to_string(),
                s("click"),
                s("--repeat"),
                clicks.to_string(),
                s(btn),
            ],
        )?;
        Ok(())
    } else if has_bin("ydotool") {
        run(
            "ydotool",
            &[
                s("mousemove"),
                s("--absolute"),
                s("--"),
                x.to_string(),
                y.to_string(),
            ],
        )?;
        let btn = match button {
            "right" => "0x01",
            "middle" => "0x02",
            _ => "0x00",
        };
        for _ in 0..clicks {
            run("ydotool", &[s("click"), s(btn)])?;
        }
        Ok(())
    } else {
        Err("Mouse input requires 'hyprctl' (Hyprland), 'ydotool' (Wayland) or 'xdotool' (X11). Install one and retry.".to_string())
    }
}

/// Moves the cursor to (x, y) then scrolls. `direction` is "up" | "down", `amount` is the
/// number of wheel ticks.
pub fn mouse_scroll(x: i32, y: i32, direction: &str, amount: i32) -> Result<(), String> {
    let ticks = amount.clamp(1, 50);

    if is_hyprland() {
        // Hyprland: native cursor move + relative wheel via ydotool.
        hyprctl_move_cursor(x, y)?;
        let signed = if direction == "up" { -ticks } else { ticks };
        run(
            "ydotool",
            &[s("mousemove"), s("--wheel"), s("-y"), signed.to_string()],
        )?;
        Ok(())
    } else if has_bin("xdotool") {
        // X11 wheel buttons: 4 = up, 5 = down.
        let button = if direction == "down" { "5" } else { "4" };
        run(
            "xdotool",
            &[
                s("mousemove"),
                s("--sync"),
                x.to_string(),
                y.to_string(),
                s("click"),
                s("--repeat"),
                ticks.to_string(),
                s(button),
            ],
        )?;
        Ok(())
    } else if has_bin("ydotool") {
        run(
            "ydotool",
            &[
                s("mousemove"),
                s("--absolute"),
                s("--"),
                x.to_string(),
                y.to_string(),
            ],
        )?;
        let signed = if direction == "up" { -ticks } else { ticks };
        run(
            "ydotool",
            &[s("mousemove"), s("--wheel"), s("-y"), signed.to_string()],
        )?;
        Ok(())
    } else {
        Err("Mouse input requires 'hyprctl' (Hyprland), 'ydotool' (Wayland) or 'xdotool' (X11). Install one and retry.".to_string())
    }
}

/// Types text at the focused input. Non-ASCII text (e.g. Cyrillic) is pasted via the
/// clipboard so it does not depend on the active keyboard layout.
pub fn type_text(text: &str, submit: bool) -> Result<(), String> {
    if !text.is_ascii() {
        paste_via_clipboard(text)?;
    } else if has_bin("wtype") {
        run("wtype", &[s("--"), s(text)])?;
    } else if has_bin("xdotool") {
        run("xdotool", &[s("type"), s("--clearmodifiers"), s("--"), s(text)])?;
    } else if has_bin("ydotool") {
        run("ydotool", &[s("type"), s("--"), s(text)])?;
    } else {
        return Err("Text input requires 'wtype' (Wayland) or 'xdotool' (X11). Install one and retry.".to_string());
    }

    if submit {
        press_key("enter")?;
    }
    Ok(())
}

/// Presses a keyboard combination, e.g. ["Ctrl", "C"], ["Alt", "Tab"], ["Escape"].
pub fn press_hotkey(keys: &[String]) -> Result<(), String> {
    if keys.is_empty() {
        return Err("No keys provided for press_hotkey.".to_string());
    }

    let mods: Vec<String> = keys
        .iter()
        .filter(|k| is_modifier(k))
        .map(|k| k.to_lowercase())
        .collect();
    let main_keys: Vec<String> = keys
        .iter()
        .filter(|k| !is_modifier(k))
        .map(|k| k.to_lowercase())
        .collect();

    if has_bin("wtype") {
        let mut args: Vec<String> = vec![];
        for m in &mods {
            args.push(s("-M"));
            args.push(s(&wtype_mod(m)));
        }
        for k in &main_keys {
            args.push(s("-k"));
            args.push(s(&wtype_key(k)));
        }
        for m in &mods {
            args.push(s("-m"));
            args.push(s(&wtype_mod(m)));
        }
        run("wtype", &args)
    } else if has_bin("xdotool") {
        let mut combo: Vec<String> = mods.iter().map(|m| xdotool_mod(m)).collect();
        for k in &main_keys {
            combo.push(xdotool_key(k));
        }
        run("xdotool", &[s("key"), s("--clearmodifiers"), combo.join("+")])
    } else {
        Err("Keyboard input requires 'wtype' (Wayland) or 'xdotool' (X11). Install one and retry.".to_string())
    }
}

/// Presses a single key (used by type_text submit).
fn press_key(key: &str) -> Result<(), String> {
    press_hotkey(&[s(key)])
}

/// Pastes non-ASCII text via the clipboard and synthesizes Ctrl+V, then restores the
/// previous clipboard contents on a best-effort basis.
fn paste_via_clipboard(text: &str) -> Result<(), String> {
    let (copy_bin, copy_args, paste_bin) = if has_bin("wl-copy") && has_bin("wl-paste") {
        (Some("wl-copy"), vec![s("--paste-once")], Some("wl-paste"))
    } else if has_bin("xclip") {
        (Some("xclip"), vec![s("-selection"), s("clipboard")], None)
    } else {
        return Err("Clipboard paste requires 'wl-copy' (Wayland) or 'xclip' (X11). Install one and retry.".to_string());
    };

    let saved = match paste_bin {
        Some(bin) => run_capture(bin, &[]),
        None => Some(String::new()),
    };

    if let Some(bin) = copy_bin {
        run_with_stdin(bin, &copy_args, text)?;
    }

    // Synthesize Ctrl+V.
    if has_bin("ydotool") {
        let _ = run("ydotool", &[s("key"), s("29:1"), s("47:1"), s("47:0"), s("29:0")]);
    } else if has_bin("wtype") {
        let _ = run("wtype", &[s("-M"), s("ctrl"), s("-k"), s("v"), s("-m"), s("ctrl")]);
    } else if has_bin("xdotool") {
        let _ = run("xdotool", &[s("key"), s("--clearmodifiers"), s("ctrl+v")]);
    }

    // Best-effort restore.
    if let (Some(bin), Some(prev)) = (copy_bin, saved) {
        let _ = run_with_stdin(bin, &copy_args, &prev);
    }
    Ok(())
}

fn is_modifier(key: &str) -> bool {
    matches!(
        key.to_lowercase().as_str(),
        "ctrl" | "control" | "alt" | "option" | "shift" | "super" | "meta" | "win" | "cmd" | "hyper"
    )
}

fn wtype_mod(mod_: &str) -> String {
    match mod_.to_lowercase().as_str() {
        "ctrl" | "control" => "ctrl".into(),
        "alt" | "option" => "alt".into(),
        "shift" => "shift".into(),
        "super" | "meta" | "win" | "cmd" => "super".into(),
        "hyper" => "hyper".into(),
        _ => mod_.to_lowercase(),
    }
}

fn xdotool_mod(mod_: &str) -> String {
    match mod_.to_lowercase().as_str() {
        "ctrl" | "control" => "ctrl".into(),
        "alt" | "option" => "alt".into(),
        "shift" => "shift".into(),
        "super" | "meta" | "win" | "cmd" => "super".into(),
        _ => mod_.to_lowercase(),
    }
}

fn wtype_key(key: &str) -> String {
    match key.to_lowercase().as_str() {
        "esc" | "escape" => "esc".into(),
        "enter" | "return" => "enter".into(),
        "tab" => "tab".into(),
        "space" => "space".into(),
        "backspace" => "backspace".into(),
        "delete" | "del" => "delete".into(),
        "up" | "down" | "left" | "right" => key.to_lowercase(),
        "home" | "end" | "pageup" | "pagedown" => key.to_lowercase(),
        k => k.to_string(),
    }
}

fn xdotool_key(key: &str) -> String {
    match key.to_lowercase().as_str() {
        "esc" | "escape" => "Escape".into(),
        "enter" | "return" => "Return".into(),
        "tab" => "Tab".into(),
        "space" => "space".into(),
        "backspace" => "BackSpace".into(),
        "delete" | "del" => "Delete".into(),
        "up" | "down" | "left" | "right" => key.to_lowercase(),
        "home" | "end" | "pageup" | "pagedown" => key.to_lowercase(),
        k => k.to_string(),
    }
}
