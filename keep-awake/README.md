# ☕ keep-awake

Keeps your screen on and your computer out of idle sleep while Claude Code is open. Close Claude Code and your normal power settings apply again.

```text
/plugin install keep-awake --marketplace Kritsanai-Krish/claude-code-mods
```

`/keep-awake` turns it off or on for the current session. `/keep-awake status` shows which method is in use.

| System | How |
| --- | --- |
| Windows | `SetThreadExecutionState` through the built-in Windows PowerShell |
| macOS | `caffeinate -d -i`, built in |
| WSL | Windows' idle timer, reset every 30 seconds through `powershell.exe` |
| Linux, BSD | Every method the desktop supports: GNOME, KDE, logind, the freedesktop D-Bus inhibit (XFCE, MATE, Cinnamon, LXQt) and, under X11 with none of those, `xdg-screensaver reset` |

Locking the screen yourself, closing the lid and choosing Suspend still work. Full guide: see the [main README](../README.md#-keep-awake).

MIT © Krish
