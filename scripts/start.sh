#!/usr/bin/env bash
#
# One command to get from a cold repo to a session in the browser.
#
#   ./scripts/start.sh          production mode, rebuilds only when stale
#   ./scripts/start.sh --dev    hot reload, no build step
#   ./scripts/start.sh --no-open
#
# Safe to run repeatedly: every step checks before it acts.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE=prod
OPEN_BROWSER=1
for arg in "$@"; do
  case "$arg" in
    --dev) MODE=dev ;;
    --no-open) OPEN_BROWSER=0 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'
YELLOW=$'\033[33m'; ACCENT=$'\033[38;5;154m'; RESET=$'\033[0m'

step() { printf '%s▸%s %s\n' "$ACCENT" "$RESET" "$1"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; exit 1; }

LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"

printf '\n%s  nod3%s  %sthink out loud, then see what you actually said%s\n\n' \
  "$BOLD" "$RESET" "$DIM" "$RESET"

# --- Node -------------------------------------------------------------------
# A double-clicked .command does not read your shell profile, so nvm's node is
# not on PATH. Load it the way nvm's own installer does.
if ! command -v node >/dev/null 2>&1; then
  for nvm_sh in "${NVM_DIR:-$HOME/.nvm}/nvm.sh" /usr/local/opt/nvm/nvm.sh /opt/homebrew/opt/nvm/nvm.sh; do
    if [ -s "$nvm_sh" ]; then
      # shellcheck disable=SC1090
      . "$nvm_sh" >/dev/null 2>&1 || true
      break
    fi
  done
fi
command -v node >/dev/null 2>&1 || die "Node is not installed. Get it from https://nodejs.org (20 or newer)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node $(node -v) is too old — this needs 20 or newer."

# --- System tools -----------------------------------------------------------
step "Checking what the app shells out to"

missing_brew=()
command -v ffmpeg      >/dev/null 2>&1 || missing_brew+=(ffmpeg)
command -v whisper-cli >/dev/null 2>&1 || missing_brew+=(whisper-cpp)

if [ ${#missing_brew[@]} -gt 0 ]; then
  if command -v brew >/dev/null 2>&1; then
    warn "Missing: ${missing_brew[*]}"
    printf '    Install them now with Homebrew? [Y/n] '
    read -r reply </dev/tty || reply=n
    case "$reply" in
      [Nn]*) die "Cannot run without ${missing_brew[*]}." ;;
      *) brew install "${missing_brew[@]}" ;;
    esac
  else
    die "Missing ${missing_brew[*]} and Homebrew is not installed. See the README for manual setup."
  fi
fi
ok "ffmpeg, whisper-cli"

# --- Dependencies -----------------------------------------------------------
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  step "Installing npm dependencies"
  npm install --silent
  ok "dependencies installed"
else
  ok "npm dependencies"
fi

# --- Speech model -----------------------------------------------------------
if ! ls models/*.bin >/dev/null 2>&1; then
  step "Downloading the speech model (~488 MB, one time)"
  npm run --silent setup:model
else
  ok "speech model"
fi

# --- Ports ------------------------------------------------------------------
port_pid() { lsof -ti :"$1" -sTCP:LISTEN 2>/dev/null | head -1; }

for port in 4000 3000; do
  pid="$(port_pid "$port" || true)"
  if [ -n "$pid" ]; then
    name="$(ps -p "$pid" -o comm= 2>/dev/null || echo unknown)"
    warn "Port $port is already in use by pid $pid ($name)"
    printf '    Stop it and continue? [Y/n] '
    read -r reply </dev/tty || reply=n
    case "$reply" in
      [Nn]*) die "Port $port must be free." ;;
      *) kill "$pid" 2>/dev/null || true; sleep 1 ;;
    esac
  fi
done

# --- Build ------------------------------------------------------------------
# Production start is noticeably snappier for daily use, so only fall back to a
# rebuild when something under apps/web actually changed.
if [ "$MODE" = prod ]; then
  needs_build=0
  if [ ! -f apps/web/.next/BUILD_ID ]; then
    needs_build=1
  elif [ -n "$(find apps/web -newer apps/web/.next/BUILD_ID \
      -not -path '*/.next/*' -not -path '*/node_modules/*' -type f -print -quit 2>/dev/null)" ]; then
    needs_build=1
  fi

  if [ "$needs_build" = 1 ]; then
    step "Building the web app"
    if npm run --silent build > "$LOG_DIR/build.log" 2>&1; then
      ok "build complete"
    else
      tail -30 "$LOG_DIR/build.log"
      die "Build failed — full log at .logs/build.log"
    fi
  else
    ok "build up to date"
  fi
fi

# --- Boot -------------------------------------------------------------------
SERVER_PID=""
WEB_PID=""

SHUTTING_DOWN=0

shutdown() {
  # INT/TERM run this and then fall through to EXIT, which would run it twice.
  [ "$SHUTTING_DOWN" = 0 ] || return 0
  SHUTTING_DOWN=1

  printf '\n%s▸%s Shutting down\n' "$ACCENT" "$RESET"

  # Signal the whole process group of each child: `npm run` spawns the real
  # server underneath, so killing npm alone can leave the port bound.
  for pid in "$WEB_PID" "$SERVER_PID"; do
    [ -n "$pid" ] || continue
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done

  # Then verify rather than assume. Signal delivery through two layers of npm
  # is not something to take on trust — a stale listener means the next start
  # stops to ask about a busy port, or silently talks to yesterday's server.
  local waited=0
  while [ "$waited" -lt 16 ]; do
    if [ -z "$(lsof -ti :3000 -sTCP:LISTEN 2>/dev/null)" ] &&
       [ -z "$(lsof -ti :4000 -sTCP:LISTEN 2>/dev/null)" ]; then
      break
    fi
    sleep 0.5
    waited=$((waited + 1))
  done

  local stubborn
  stubborn="$(lsof -ti :3000 -sTCP:LISTEN 2>/dev/null; lsof -ti :4000 -sTCP:LISTEN 2>/dev/null)"
  if [ -n "$stubborn" ]; then
    warn "Some processes ignored SIGTERM; forcing them down"
    echo "$stubborn" | while read -r p; do [ -n "$p" ] && kill -9 "$p" 2>/dev/null || true; done
    sleep 1
  fi

  printf '  %s✓%s Stopped. Your sessions are in data/sessions/\n\n' "$GREEN" "$RESET"
}
trap shutdown EXIT INT TERM

step "Starting"

if [ "$MODE" = dev ]; then
  set -m
  npm run dev:server > "$LOG_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  npm run dev:web > "$LOG_DIR/web.log" 2>&1 &
  WEB_PID=$!
  set +m
else
  set -m
  npm run start:server > "$LOG_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  npm run start:web > "$LOG_DIR/web.log" 2>&1 &
  WEB_PID=$!
  set +m
fi

wait_for() {
  local url="$1" label="$2" logfile="$3" tries=0
  until curl -sf -o /dev/null "$url"; do
    tries=$((tries + 1))
    if [ "$tries" -gt 120 ]; then
      printf '\n'
      tail -25 "$logfile"
      die "$label did not come up — full log at ${logfile#"$ROOT"/}"
    fi
    # If the process already died there is no point waiting out the timeout.
    if ! kill -0 "$SERVER_PID" 2>/dev/null || ! kill -0 "$WEB_PID" 2>/dev/null; then
      printf '\n'
      tail -25 "$logfile"
      die "$label exited during startup — full log at ${logfile#"$ROOT"/}"
    fi
    sleep 0.5
  done
  ok "$label"
}

wait_for http://localhost:4000/api/health "API on :4000" "$LOG_DIR/server.log"
wait_for http://localhost:3000 "Web on :3000" "$LOG_DIR/web.log"

ENGINE="$(curl -sf http://localhost:4000/api/health | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);process.stdout.write(h.analysisEngine+(h.whisperReady?"":" · whisper model MISSING"))})' \
  2>/dev/null || echo unknown)"

printf '\n  %sReady%s   %shttp://localhost:3000%s\n' "$GREEN$BOLD" "$RESET" "$BOLD" "$RESET"
printf '  %swrite-up engine: %s · mode: %s · logs: .logs/%s\n' "$DIM" "$ENGINE" "$MODE" "$RESET"
printf '  %sPress Ctrl-C to stop.%s\n\n' "$DIM" "$RESET"

# An `a && b` chain that ends false would trip `set -e` and exit here.
if [ "$OPEN_BROWSER" = 1 ] && command -v open >/dev/null 2>&1; then
  open http://localhost:3000
fi

# Hold the terminal open until one of the two dies, or the user interrupts.
# A polling loop rather than `wait -n`: macOS still ships bash 3.2, which has
# no such option, and plain `wait` would block until *both* had exited.
while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  warn "The API exited unexpectedly — last lines of .logs/server.log:"
  tail -15 "$LOG_DIR/server.log"
elif ! kill -0 "$WEB_PID" 2>/dev/null; then
  warn "The web app exited unexpectedly — last lines of .logs/web.log:"
  tail -15 "$LOG_DIR/web.log"
fi
