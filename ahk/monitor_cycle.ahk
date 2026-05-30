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
;  CYCLE WINDOWS ON A MONITOR
; ============================================================
CycleMonitor(bounds) {
    mx := bounds[1], my := bounds[2], mw := bounds[3], mh := bounds[4]

    ; Collect all visible, non-minimized windows whose centre falls on this monitor
    wins := []
    for hwnd in WinGetList() {
        if !WinExist("ahk_id " hwnd)
            continue
        if WinGetMinMax("ahk_id " hwnd) = -1   ; skip minimized
            continue
        title := WinGetTitle("ahk_id " hwnd)
        if (title = "" || title = "Program Manager")
            continue

        WinGetPos(&wx, &wy, &ww, &wh, "ahk_id " hwnd)
        ; Use window centre to decide which monitor it belongs to
        cx := wx + ww // 2
        cy := wy + wh // 2
        if (cx >= mx && cx < mx + mw && cy >= my && cy < my + mh)
            wins.Push(hwnd)
    }

    count := wins.Length
    if (count = 0)
        return
    if (count = 1) {
        WinActivate("ahk_id " wins[1])
        return
    }

    ; Find which window in the list is currently active
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
    WinActivate("ahk_id " wins[nextIdx])
}

; ============================================================
;  RDP TOGGLE  (minimize ↔ maximize/restore)
; ============================================================
ToggleRDP() {
    ; Matches the standard mstsc window class
    if !WinExist("ahk_class TscShellContainerClass") {
        ; Try by title fragment as fallback
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
F13:: CycleMonitor(monitors["F13"])
F14:: CycleMonitor(monitors["F14"])
F15:: CycleMonitor(monitors["F15"])
F16:: CycleMonitor(monitors["F16"])
F17:: ToggleRDP()
