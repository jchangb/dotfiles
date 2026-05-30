#Requires AutoHotkey v2.0
#SingleInstance Force

; ============================================================
;  MONITOR CYCLING + RDP TOGGLE
;  Key assignments (set these in VIA on your Keychron Q):
;    M1 → F13  →  DISPLAY2  (vertical left,  1080×1920, x=-1080)
;    M2 → F14  →  DISPLAY4  (top big,        3072×1728, x=-1081, y=-2160)
;    M3 → F15  →  DISPLAY1  (primary,        2560×1440, x=0)
;    M4 → F16  →  DISPLAY3  (right,          2560×1440, x=2560)
;    M5 → F17  →  RDP toggle (minimize ↔ maximize)
; ============================================================

; --- Monitor bounds (from your PowerShell output) ---
; Each entry: [x, y, width, height]
monitors := Map(
    "F13", [-1080,     0, 1080, 1920],   ; DISPLAY2  — vertical left
    "F14", [-1081, -2160, 3072, 1728],   ; DISPLAY4  — top big
    "F15", [    0,     0, 2560, 1440],   ; DISPLAY1  — primary
    "F16", [ 2560,     0, 2560, 1440]    ; DISPLAY3  — right
)

; ============================================================
;  WINDOWS TO ALWAYS SKIP
;  Title substrings or exact class names for ghost/overlay/tray
;  processes that should never appear in the cycle.
; ============================================================
blockedTitles := [
    "NVIDIA GeForce Overlay",
    "RaycastNodeGracefulShutdownWindow",
    "Raycast",
    "wv_1001",
    "ModrinthApp-siw",
]

; Minimum window size — anything smaller is a ghost process
minSize := 50

IsBlocked(title, ww, wh) {
    global blockedTitles, minSize
    if (ww < minSize || wh < minSize)
        return true
    for blocked in blockedTitles {
        if (title = blocked)
            return true
    }
    return false
}

; ============================================================
;  STABLE WINDOW ORDER — persists across keypresses
;  Keyed by monitor tag (e.g. "F13"), values are arrays of hwnds
; ============================================================
global monitorOrder := Map()

GetOrBuildOrder(tag, bounds) {
    mx := bounds[1], my := bounds[2], mw := bounds[3], mh := bounds[4]

    current := Map()
    for hwnd in WinGetList() {
        if !WinExist("ahk_id " hwnd)
            continue
        title := WinGetTitle("ahk_id " hwnd)
        if (title = "" || title = "Program Manager")
            continue

        WinGetPos(&wx, &wy, &ww, &wh, "ahk_id " hwnd)

        if IsBlocked(title, ww, wh)
            continue

        cx := wx + ww // 2
        cy := wy + wh // 2
        if (cx >= mx && cx < mx + mw && cy >= my && cy < my + mh)
            current[hwnd] := true
    }

    ; Rebuild stable list: keep existing order, drop closed windows, append new ones
    existing := monitorOrder.Has(tag) ? monitorOrder[tag] : []
    stable := []
    for hwnd in existing {
        if current.Has(hwnd)
            stable.Push(hwnd)
    }
    for hwnd in current {
        found := false
        for h in stable {
            if (h = hwnd) {
                found := true
                break
            }
        }
        if !found
            stable.Push(hwnd)
    }
    monitorOrder[tag] := stable
    return stable
}

; ============================================================
;  CYCLE WINDOWS ON A MONITOR
; ============================================================
CycleMonitor(tag, bounds) {
    wins := GetOrBuildOrder(tag, bounds)
    count := wins.Length
    if (count = 0)
        return
    if (count = 1) {
        WinActivate("ahk_id " wins[1])
        return
    }

    ; Find active window in stable list.
    ; If no window on this monitor is currently active (currentIdx = 0),
    ; fall through to nextIdx = 1 — fixes "must click monitor first" issue.
    activeHwnd := WinGetID("A")
    currentIdx := 0
    Loop count {
        if (wins[A_Index] = activeHwnd) {
            currentIdx := A_Index
            break
        }
    }

    ; Advance to next (wraps around)
    nextIdx := (currentIdx = 0 || currentIdx = count) ? 1 : currentIdx + 1

    ; Restore if minimized before activating
    if WinGetMinMax("ahk_id " wins[nextIdx]) = -1
        WinRestore("ahk_id " wins[nextIdx])

    WinActivate("ahk_id " wins[nextIdx])
}

; ============================================================
;  RDP TOGGLE  (minimize ↔ maximize/restore)
; ============================================================
ToggleRDP() {
    if !WinExist("ahk_class TscShellContainerClass") {
        if !WinExist("Remote Desktop Connection") {
            ToolTip("No RDP window found")
            SetTimer(() => ToolTip(), -2000)
            return
        }
    }

    state := WinGetMinMax()   ; -1=minimized, 0=normal, 1=maximized
    if (state = -1) {
        WinRestore()
        WinMaximize()
        WinActivate()
    } else {
        WinMinimize()
    }
}

; ============================================================
;  HOTKEYS
; ============================================================
F13:: CycleMonitor("F13", monitors["F13"])
F14:: CycleMonitor("F14", monitors["F14"])
F15:: CycleMonitor("F15", monitors["F15"])
F16:: CycleMonitor("F16", monitors["F16"])
F17:: ToggleRDP()
