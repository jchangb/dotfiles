# rdp

Saved Remote Desktop (`.rdp`) connection profiles for projecting a single remote
session across different subsets of a multi-monitor desk.

Every profile connects to the **same host** — only the set of physical monitors
the session spans changes. Each one is wired to a [Stream Deck](https://www.elgato.com/stream-deck)
key so the remote desktop can be re-laid-out across the monitors with a single press.

## Profiles

Folder: [`ams_laptop/`](./ams_laptop) — connects to host `DESKTOP-417Q585`.

| File | `selectedmonitors` | Monitors the session covers |
|------|--------------------|-----------------------------|
| [`Default.rdp`](./ams_laptop/Default.rdp) | `1,3,0` | left + top + primary (everything but the right) |
| [`all_left.rdp`](./ams_laptop/all_left.rdp) | `1,3,0` | same as Default — left + top + primary |
| [`1top.rdp`](./ams_laptop/1top.rdp) | `3` | top only |
| [`1right.rdp`](./ams_laptop/1right.rdp) | `2` | right only |
| [`middle.rdp`](./ams_laptop/middle.rdp) | `0,3` | primary + top (central column) |
| [`secondaries.rdp`](./ams_laptop/secondaries.rdp) | `1,3,2` | left + top + right (everything but the primary) |

All profiles use `screen mode id:2` (full screen) and `use multimon:1` (multi-monitor),
so the remote session genuinely spans the selected physical displays rather than
scaling into one window.

## Monitor layout

The monitor IDs above are the IDs the **RDP client** assigns, which do *not* match
the Windows `DISPLAY` numbers used by [`../ahk/monitor_cycle.ahk`](../ahk/monitor_cycle.ahk).
This desk's mapping:

| RDP ID | Physical position | Windows device | Resolution |
|--------|-------------------|----------------|------------|
| 0 | primary | DISPLAY1 | 2560×1440 |
| 1 | vertical, left | DISPLAY2 | 1080×1920 |
| 2 | right | DISPLAY3 | 2560×1440 |
| 3 | top | DISPLAY4 | 3072×1728 |

## Stream Deck icons

[`imgs/`](./imgs) holds the button faces. Each icon is a schematic of the four
monitors; **white tiles** are the displays the matching profile projects onto,
black tiles are left untouched.

| Icon | Profile |
|------|---------|
| `streamdeck_key_left.png` | `all_left.rdp` |
| `streamdeck_key_1top.png` | `1top.rdp` |
| `streamdeck_key_1_right.png` | `1right.rdp` |
| `streamdeck_key_secondaries.png` | `secondaries.rdp` |
| `streamdeck_key_sides.png` | side monitors |

## Usage

- **Double-click** an `.rdp` file, or
- Bind it to a Stream Deck key as a **System → Open** action pointing at the file,
  and set the key image to the matching icon in [`imgs/`](./imgs).

---

## LLM context — rebuilding or adapting this setup

This section is for an AI assistant helping to recreate, modify, or debug these profiles.

### What these files are

`.rdp` files are plain UTF-16 (LE, with BOM) key/value text. Each line is
`key:type:value`, where `type` is `i` (int), `s` (string), or `b` (binary). They
can be edited in any text editor or regenerated from the Remote Desktop Connection
GUI (`mstsc`) via *Show Options → Save As*.

### The only field that varies between these profiles

`selectedmonitors:s:<comma-separated IDs>` — the list of RDP monitor IDs the
session is stretched across. Everything else (host, resolution, redirection,
security) is identical across all six files. To make a new layout, copy any
profile and change only this line.

Supporting fields that make multi-monitor work:

- `use multimon:i:1` — enable true multi-monitor spanning (required for
  `selectedmonitors` to take effect).
- `screen mode id:i:2` — full screen (vs. `1` = windowed).

### How to find the monitor IDs on a given machine

The IDs in `selectedmonitors` are assigned by the RDP client and are **not** the
Windows `DISPLAY1..N` numbers. List them with:

```powershell
mstsc /l
```

This pops a dialog showing each monitor with its RDP ID and bounds. Note the IDs,
then build the `selectedmonitors` list. On a different desk the same physical
monitor will likely get a different ID.

### Relationship to the AHK setup

[`../ahk/monitor_cycle.ahk`](../ahk/monitor_cycle.ahk) drives window cycling on the
**local** machine and includes an RDP-window toggle (by class
`TscShellContainerClass`). These `.rdp` profiles are the complementary piece: they
decide *which monitors* the remote session occupies when launched. The two are
independent — neither depends on the other — but they share the same four-monitor
desk, so the layout tables should be kept consistent.

### Adapting for a different host or desk

1. Open any profile in the GUI (`mstsc`), change **Computer** to the new host,
   *Save As* a new file — or edit `full address:s:<host>` directly.
2. Run `mstsc /l` on the local machine to learn its monitor IDs.
3. Set `selectedmonitors` per layout you want; keep `use multimon:i:1` and
   `screen mode id:i:2`.
4. Update the tables above and re-export Stream Deck icons if the monitor count or
   arrangement changed.
