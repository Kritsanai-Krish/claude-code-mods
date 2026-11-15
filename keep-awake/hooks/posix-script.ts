// The keeper for Linux and the BSDs, run as `sh -c POSIX_KEEPER_SCRIPT
// keep-awake <python holder source>`.
//
// Desktops disagree on how an app asks to keep the screen on, so the script
// starts every way the machine has (GNOME's session manager, KDE, logind,
// the freedesktop D-Bus ScreenSaver/PowerManagement services) and keeps the
// ones that are still running two seconds later. With none of them, under
// X11 it falls back to resetting the idle timer every 30 seconds.
//
// $PPID is the process that started this shell: Claude Code. Each layer is
// given a guard that exits once Claude Code or this shell is gone, so even a
// SIGKILL to either never leaves a stray inhibitor holding the screen on.
//
// The first line written to stdout is `active: <layer> <layer> ...`, or
// `active: none`; register.ts reads it for /keep-awake.
export const POSIX_KEEPER_SCRIPT = `
claude_pid=$PPID
keeper_pid=$$
python_holder=$1
app_name='Claude Code'
reason='Claude Code is open'
check_interval_seconds=5
x11_reset_interval_seconds=30
layer_settle_seconds=2

started_layers=''
active_layers=''
sleeper_pid=''

# What each layer holds its inhibitor around: a loop that lives while both
# Claude Code and this shell do, checked every few seconds.
guard_loop='while kill -0 "$1" 2>/dev/null && kill -0 "$2" 2>/dev/null; do sleep "$3"; done'

has_command() {
  command -v "$1" >/dev/null 2>&1
}

# Runs "$@" in the background as the layer named $1.
start_layer() {
  layer_name=$1
  shift
  "$@" >/dev/null 2>&1 &
  started_layers="$started_layers $layer_name:$!"
}

stop_layers() {
  for layer in $started_layers; do
    kill "\${layer#*:}" 2>/dev/null
  done
  if [ -n "$sleeper_pid" ]; then
    kill "$sleeper_pid" 2>/dev/null
  fi
}


trap 'stop_layers; exit 0' TERM INT HUP

# Every loop below waits with sleep; without it they would spin the CPU.
if ! has_command sleep; then
  echo 'active: none'
  exit 1
fi

if has_command gnome-session-inhibit; then
  start_layer gnome-session gnome-session-inhibit --app-id=claude-code --reason="$reason" --inhibit=idle \\
    sh -c "$guard_loop" guard "$claude_pid" "$keeper_pid" "$check_interval_seconds"
fi

if has_command kde-inhibit; then
  start_layer kde kde-inhibit --power --screenSaver \\
    sh -c "$guard_loop" guard "$claude_pid" "$keeper_pid" "$check_interval_seconds"
fi

# logind only answers on a systemd boot; the directory is how sd_booted() checks.
if has_command systemd-inhibit && [ -d /run/systemd/system ]; then
  start_layer logind systemd-inhibit --what=idle --who="$app_name" --why="$reason" --mode=block \\
    sh -c "$guard_loop" guard "$claude_pid" "$keeper_pid" "$check_interval_seconds"
fi

if has_command python3; then
  start_layer freedesktop-dbus python3 -I -c "$python_holder" "$claude_pid" "$keeper_pid" "$check_interval_seconds"
fi

sleep "$layer_settle_seconds"

for layer in $started_layers; do
  if kill -0 "\${layer#*:}" 2>/dev/null; then
    active_layers="$active_layers \${layer%%:*}"
  fi
done

x11_reset_command=''
if [ -z "$active_layers" ] && [ -n "$DISPLAY" ]; then
  if has_command xdg-screensaver; then
    x11_reset_command='xdg-screensaver reset'
  elif has_command xset; then
    x11_reset_command='xset s reset'
  fi
  if [ -n "$x11_reset_command" ]; then
    active_layers=' x11-idle-reset'
  fi
fi

if [ -z "$active_layers" ]; then
  echo 'active: none'
else
  echo "active:$active_layers"
fi

seconds_since_reset=$x11_reset_interval_seconds
while kill -0 "$claude_pid" 2>/dev/null; do
  if [ -n "$x11_reset_command" ] && [ "$seconds_since_reset" -ge "$x11_reset_interval_seconds" ]; then
    $x11_reset_command >/dev/null 2>&1
    seconds_since_reset=0
  fi
  # Sleeping in the background and waiting lets the TERM trap run at once.
  sleep "$check_interval_seconds" &
  sleeper_pid=$!
  wait "$sleeper_pid"
  sleeper_pid=''
  seconds_since_reset=$((seconds_since_reset + check_interval_seconds))
done

stop_layers
`

// Holds a freedesktop.org inhibit over D-Bus, which XFCE, MATE, Cinnamon,
// LXQt, KDE and others honor. An inhibit lasts as long as the D-Bus
// connection that asked for it, so this process stays connected until one of
// the watched pids (argv: pids..., then the check interval) is gone. Exits 1
// when no service on the bus took the inhibit.
export const PYTHON_DBUS_HOLDER = `
import os
import sys
import time

APP_NAME = 'Claude Code'
REASON = 'Claude Code is open'
INHIBIT_TARGETS = [
    ('org.freedesktop.ScreenSaver', '/org/freedesktop/ScreenSaver', 'org.freedesktop.ScreenSaver'),
    ('org.freedesktop.ScreenSaver', '/ScreenSaver', 'org.freedesktop.ScreenSaver'),
    ('org.freedesktop.PowerManagement', '/org/freedesktop/PowerManagement/Inhibit', 'org.freedesktop.PowerManagement.Inhibit'),
]

watched_pids = [int(value) for value in sys.argv[1:-1]]
check_interval_seconds = int(sys.argv[-1])


def inhibit_with_gio():
    from gi.repository import Gio, GLib
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    inhibit_count = 0
    for service, path, interface in INHIBIT_TARGETS:
        try:
            bus.call_sync(service, path, interface, 'Inhibit',
                          GLib.Variant('(ss)', (APP_NAME, REASON)),
                          GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, 5000, None)
            inhibit_count += 1
        except GLib.Error:
            pass
    return bus, inhibit_count


def inhibit_with_dbus_python():
    import dbus
    bus = dbus.SessionBus()
    inhibit_count = 0
    for service, path, interface in INHIBIT_TARGETS:
        try:
            inhibit = bus.get_object(service, path).get_dbus_method('Inhibit', interface)
            inhibit(APP_NAME, REASON)
            inhibit_count += 1
        except dbus.DBusException:
            pass
    return bus, inhibit_count


def are_watched_alive():
    for pid in watched_pids:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            pass
    return True


bus = None
inhibit_count = 0
for inhibit in (inhibit_with_gio, inhibit_with_dbus_python):
    try:
        bus, inhibit_count = inhibit()
    except Exception:
        continue
    if inhibit_count > 0:
        break

if inhibit_count == 0:
    sys.exit(1)

while are_watched_alive():
    time.sleep(check_interval_seconds)
`
