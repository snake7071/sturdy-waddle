/**
 * GNU General Public License v3.0
 * Multi-Window Router for Tauri Companion (Mascot vs Dashboard)
 */

import { useMemo } from "react";
import { MascotWindow } from "./mascot/MascotWindow";
import { DashboardWindow } from "./dashboard/DashboardWindow";
import { OverlayWindow } from "./overlay/OverlayWindow";
import "./App.css";

export function App() {
  const windowType = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("window") || "mascot";
  }, []);

  if (windowType === "dashboard") {
    return <DashboardWindow />;
  }

  if (windowType === "overlay") {
    return <OverlayWindow />;
  }

  return <MascotWindow />;
}

export default App;
