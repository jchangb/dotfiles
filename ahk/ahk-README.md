# ahk

AutoHotkey v2 scripts for Windows automation.

## Requirements

- [AutoHotkey v2](https://www.autohotkey.com/) — make sure to install v2, not v1

## Auto-start

To run a script on every Windows startup:

1. Press `Win+R`, type `shell:startup`, hit Enter
2. Drop a shortcut to the `.ahk` file into that folder

## Scripts

### `monitor_cycle.ahk`

Cycles windows per monitor and toggles an RDP window, using the M1–M5 macro keys on a Keychron Q.

**Hardware setup:** Remap M1–M5 to F13–F17 in [VIA](https://usevia.app/) — this keeps the key logic in firmware and out of the script.

| Key | F-key | Monitor | Resolution |
|-----|-------|---------|------------|
| M1 | F13 | DISPLAY2 — vertical left | 1080×1920 |
| M2 | F14 | DISPLAY4 — top | 3072×1728 |
| M3 | F15 | DISPLAY1 — primary | 2560×1440 |
| M4 | F16 | DISPLAY3 — right | 2560×1440 |
| M5 | F17 | RDP toggle | — |

**Cycling behavior:** Each keypress collects all visible (non-minimized) windows whose centre point falls within that monitor's bounds, then activates the next one in the stack. Wraps around.

**RDP toggle:** Detects the RDP window by class (`TscShellContainerClass`). If minimized → restores and maximizes. If visible → minimizes.

> If the wrong monitor is cycling, your Windows display coordinates may differ from what's hardcoded. Run this in PowerShell and update the bounds in the script:
> ```powershell
> Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "$($_.DeviceName) | Bounds: $($_.Bounds) | Primary: $($_.Primary)" }
> ```

---

## LLM context — rebuilding or adapting this setup

This section is for an AI assistant helping to recreate, modify, or debug this script.

### Architecture overview

The setup has two layers:

1. **Firmware layer (VIA):** M1–M5 on the Keychron Q are remapped to F13–F17. This makes the keys OS-agnostic and avoids conflicts with any application shortcuts. The mapping lives on the keyboard itself and requires no background software.

2. **OS layer (AHK v2):** The script listens for F13–F17 and executes window management logic. Each key is bound to a specific monitor by its Windows virtual desktop coordinates.

### How monitor bounds work

Windows places all monitors in a shared virtual coordinate space. The primary monitor always has its top-left corner at `(0, 0)`. Monitors to the left have negative X values; monitors above have negative Y values.

To get the current bounds, run in PowerShell:
```powershell
Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "$($_.DeviceName) | Bounds: $($_.Bounds) | Primary: $($_.Primary)" }
```

Example output for this setup:
```
\\.\DISPLAY1 | Bounds: {X=0,Y=0,Width=2560,Height=1440}      | Primary: True
\\.\DISPLAY2 | Bounds: {X=-1080,Y=0,Width=1080,Height=1920}  | Primary: False
\\.\DISPLAY4 | Bounds: {X=-1081,Y=-2160,Width=3072,Height=1728} | Primary: False
\\.\DISPLAY3 | Bounds: {X=2560,Y=0,Width=2560,Height=1440}   | Primary: False
```

Note: Windows device names (DISPLAY1, DISPLAY2...) do not necessarily match physical left-to-right order. Always use the X/Y coordinates to determine layout, not the device name.

### How the cycling logic works

For each keypress, the script:
1. Iterates all open windows via `WinGetList()`
2. Skips minimized windows (`WinGetMinMax = -1`), invisible windows, and `Program Manager`
3. Calculates each window's centre point `(wx + ww/2, wy + wh/2)`
4. Keeps only windows whose centre falls within the target monitor's bounds
5. Finds the currently active window in that list
6. Activates the next one (wraps from last back to first)

Window ownership to a monitor is determined by centre point, not by where the window was opened or which monitor has the majority of its pixels. This is a deliberate choice — it matches user intuition and handles windows that straddle two monitors predictably.

### How the RDP toggle works

The RDP window is identified by its window class `TscShellContainerClass`, which is stable regardless of the remote machine's name or the connection window title. A title-based fallback (`Remote Desktop Connection`) is included for edge cases.

Toggle logic:
- `WinGetMinMax() = -1` → minimized → restore + maximize + activate
- anything else → minimize

### Key decisions and tradeoffs

| Decision | Rationale |
|----------|-----------|
| F13–F17 instead of custom key codes | These are universally recognized by Windows and AHK with no default bindings. Any high F-key (F13–F24) works equally well. |
| Centre-point monitor detection | More intuitive than majority-pixel detection for windows straddling monitors |
| Skip minimized windows | Minimized windows are "parked" — cycling them would be disorienting. If the user wants a minimized window, they use the taskbar. |
| AHK v2 over v1 | v2 has cleaner syntax, better Unicode support, and is actively maintained. v1 is in legacy mode. |
| No fixed app list per monitor | Chosen for flexibility — the user didn't want to maintain a list. Can be added later by filtering `wins` against a per-monitor array of exe names. |

### Adapting for a different monitor layout

1. Run the PowerShell command above to get current bounds
2. Update the `monitors` Map in the script — each entry is `[x, y, width, height]` matching the `X`, `Y`, `Width`, `Height` from the PowerShell output
3. Reassign F-keys to monitors as desired
4. The VIA remap (M1–M5 → F13–F17) does not need to change unless you want more or fewer macro keys

### Adapting for a different keyboard

Any keyboard can be used. The only requirement is that the macro keys send keystrokes that AHK can intercept. F13–F17 is the recommended target because they have no default Windows bindings. If the keyboard can't send F13–F17, any unused combination works (e.g. `^!1` through `^!5`) — update the hotkey lines at the bottom of the script accordingly.
