#!/bin/bash
set -e

CLAWDECKX_DATA_DIR="${OCD_DATA_DIR:-/data/clawdeckx}"
OPENCLAW_DATA_DIR="${OPENCLAW_DATA_DIR:-/data/openclaw}"
OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-${OPENCLAW_HOME:-$HOME}/.openclaw}"
OPENCLAW_CONFIG="${OPENCLAW_CONFIG_PATH:-$OPENCLAW_STATE_DIR/openclaw.json}"
NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$OPENCLAW_DATA_DIR/npm}"
GATEWAY_LOG="${OCD_GATEWAY_LOG:-$OPENCLAW_DATA_DIR/logs/gateway.log}"
GATEWAY_PORT="${OCD_OPENCLAW_GATEWAY_PORT:-18789}"
BOOTSTRAP_DIR="${OPENCLAW_DATA_DIR}/bootstrap"
BOOTSTRAP_FILE="${BOOTSTRAP_DIR}/gateway-bootstrap.json"
RUNTIME_DIR="${OCD_RUNTIME_DIR:-/data/runtime}"

mkdir -p "$CLAWDECKX_DATA_DIR" "$OPENCLAW_DATA_DIR" "$OPENCLAW_STATE_DIR" "$OPENCLAW_DATA_DIR/logs" "$NPM_CONFIG_PREFIX" "$BOOTSTRAP_DIR" \
         "$RUNTIME_DIR/clawdeckx" "$RUNTIME_DIR/openclaw"
export NPM_CONFIG_PREFIX
export PATH="$NPM_CONFIG_PREFIX/bin:$HOME/.local/bin:$HOME/bin:$PATH"
export OPENCLAW_STATE_DIR
export OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG"
export OCD_RUNTIME_DIR="$RUNTIME_DIR"

if [ -d /opt/openclaw ]; then
    # OpenClaw's plugin install safety scan only permits the exact
    # node_modules/openclaw peer symlink shape. Do not create
    # lib/node_modules/openclaw, and clean up older containers that did.
    rm -f "$NPM_CONFIG_PREFIX/lib/node_modules/openclaw" 2>/dev/null || true
    OPENCLAW_PLUGIN_NODE_MODULES="$NPM_CONFIG_PREFIX/node_modules"
    mkdir -p "$OPENCLAW_PLUGIN_NODE_MODULES"
    if [ ! -e "$OPENCLAW_PLUGIN_NODE_MODULES/openclaw" ]; then
        ln -s /opt/openclaw "$OPENCLAW_PLUGIN_NODE_MODULES/openclaw" || true
    fi
fi

# ── Runtime overlay: write image version stamps on first boot ──
if [ ! -f /app/.image-version ]; then
    /app/clawdeckx version 2>/dev/null | head -1 > /app/.image-version || echo "unknown" > /app/.image-version
fi
if [ ! -f /opt/openclaw/.image-version ] && command -v openclaw &>/dev/null; then
    openclaw --version 2>/dev/null | head -1 > /opt/openclaw/.image-version || echo "unknown" > /opt/openclaw/.image-version
fi

# write_bootstrap writes a JSON bootstrap status file for ClawDeckX to read
write_bootstrap() {
    local status="$1" reason="$2" pid="${3:-0}" openclaw_bin="${4:-}" openclaw_ver="${5:-}"
    BOOTSTRAP_FILE="$BOOTSTRAP_FILE" \
    BOOTSTRAP_STATUS="$status" \
    BOOTSTRAP_REASON="$reason" \
    BOOTSTRAP_PID="$pid" \
    BOOTSTRAP_OPENCLAW_BIN="$openclaw_bin" \
    BOOTSTRAP_OPENCLAW_VERSION="$openclaw_ver" \
    BOOTSTRAP_CONFIG_PATH="$OPENCLAW_CONFIG" \
    BOOTSTRAP_STATE_DIR="$OPENCLAW_STATE_DIR" \
    BOOTSTRAP_GATEWAY_LOG="$GATEWAY_LOG" \
    BOOTSTRAP_GATEWAY_PORT="$GATEWAY_PORT" \
    BOOTSTRAP_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    node -e 'const fs = require("fs"); const payload = { status: process.env.BOOTSTRAP_STATUS, reason: process.env.BOOTSTRAP_REASON, gatewayPid: Number(process.env.BOOTSTRAP_PID || "0"), gatewayPort: Number(process.env.BOOTSTRAP_GATEWAY_PORT || "0"), openclawBin: process.env.BOOTSTRAP_OPENCLAW_BIN || "", openclawVersion: process.env.BOOTSTRAP_OPENCLAW_VERSION || "", configPath: process.env.BOOTSTRAP_CONFIG_PATH || "", stateDir: process.env.BOOTSTRAP_STATE_DIR || "", gatewayLog: process.env.BOOTSTRAP_GATEWAY_LOG || "", timestamp: process.env.BOOTSTRAP_TIMESTAMP || "" }; fs.writeFileSync(process.env.BOOTSTRAP_FILE, JSON.stringify(payload, null, 2));'
}

sanitize_openclaw_plugin_config() {
    if [ ! -f "$OPENCLAW_CONFIG" ]; then
        return 0
    fi

    if ! command -v node &>/dev/null; then
        echo "[docker-entrypoint] node not found, skipping OpenClaw plugin config sanitization" >&2
        return 1
    fi

    if OPENCLAW_CONFIG="$OPENCLAW_CONFIG" node <<'NODE'
const fs = require('fs');

const configPath = process.env.OPENCLAW_CONFIG;
if (!configPath || !fs.existsSync(configPath)) {
  process.exit(0);
}

const raw = fs.readFileSync(configPath, 'utf8');
if (!raw.trim()) {
  process.exit(0);
}

let config;
try {
  config = JSON.parse(raw);
} catch (error) {
  console.error(`[docker-entrypoint] ERROR: OpenClaw config is corrupted: ${configPath}`);
  console.error(`[docker-entrypoint] ERROR: Please check ${configPath}`);
  console.error(`[docker-entrypoint] ERROR: ${error.message}`);
  process.exit(20);
}
const plugins = config.plugins;
const entries = plugins && typeof plugins === 'object' ? plugins.entries : undefined;

if (!entries || typeof entries !== 'object' || !Object.prototype.hasOwnProperty.call(entries, 'skillhub')) {
  process.exit(0);
}

delete entries.skillhub;

if (Object.keys(entries).length === 0) {
  delete plugins.entries;
}

if (plugins && typeof plugins === 'object' && Object.keys(plugins).length === 0) {
  delete config.plugins;
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
process.exit(10);
NODE
    then
        return 0
    else
        status=$?
        if [ "$status" -eq 10 ]; then
            echo "[docker-entrypoint] Removed stale plugins.entries.skillhub from $OPENCLAW_CONFIG"
            return 0
        fi
        if [ "$status" -eq 20 ]; then
            echo "[docker-entrypoint] WARNING: OpenClaw plugin config sanitization skipped because the config file is invalid JSON" >&2
            return 1
        fi
        echo "[docker-entrypoint] WARNING: Failed to sanitize OpenClaw plugin config (exit=$status)" >&2
        return 1
    fi
}

ensure_default_clawhub() {
    if command -v clawhub &>/dev/null; then
        return 0
    fi

    if ! command -v npm &>/dev/null; then
        echo "[docker-entrypoint] npm not found, skipping ClawHub CLI auto-install" >&2
        return 1
    fi

    echo "[docker-entrypoint] Installing ClawHub CLI..."
    local attempt
    for attempt in 1 2 3; do
        if npm install -g clawhub --prefix "$NPM_CONFIG_PREFIX" >/tmp/clawhub-install.log 2>&1; then
            echo "[docker-entrypoint] ClawHub CLI installed"
            return 0
        fi
        if [ "$attempt" -lt 3 ]; then
            echo "[docker-entrypoint] ClawHub install attempt ${attempt}/3 failed, retrying in 5s..." >&2
            sleep 5
        fi
    done

    echo "[docker-entrypoint] WARNING: Failed to install ClawHub CLI after 3 attempts" >&2
    tail -20 /tmp/clawhub-install.log 2>/dev/null >&2 || true
    return 1
}

ensure_default_skillhub() {
    if command -v skillhub &>/dev/null; then
        return 0
    fi

    if ! command -v curl &>/dev/null || ! command -v bash &>/dev/null; then
        echo "[docker-entrypoint] Missing curl/bash, skipping SkillHub CLI auto-install" >&2
        return 1
    fi

    echo "[docker-entrypoint] Installing SkillHub CLI..."
    local attempt
    for attempt in 1 2 3; do
        if bash -lc 'curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only' >/tmp/skillhub-install.log 2>&1; then
            echo "[docker-entrypoint] SkillHub CLI installed"
            return 0
        fi
        if [ "$attempt" -lt 3 ]; then
            echo "[docker-entrypoint] SkillHub install attempt ${attempt}/3 failed, retrying in 5s..." >&2
            sleep 5
        fi
    done

    echo "[docker-entrypoint] WARNING: Failed to install SkillHub CLI after 3 attempts" >&2
    tail -20 /tmp/skillhub-install.log 2>/dev/null >&2 || true
    return 1
}

ensure_default_openclaw_config() {
    if [ -f "$OPENCLAW_CONFIG" ]; then
        return 0
    fi

    echo "[docker-entrypoint] OpenClaw config not found, writing minimal config..."
    mkdir -p "$OPENCLAW_STATE_DIR"
    cat > "$OPENCLAW_CONFIG" <<OCEOF
{
  "gateway": {
    "mode": "local",
    "port": ${GATEWAY_PORT},
    "bind": "loopback"
  }
}
OCEOF
    chmod 600 "$OPENCLAW_CONFIG"
    echo "[docker-entrypoint] Minimal OpenClaw config written to $OPENCLAW_CONFIG"
    OPENCLAW_CONFIG_CREATED=1
    return 0
}

# Start OpenClaw Gateway in background if installed
OPENCLAW_BIN=""
OPENCLAW_VER=""
OPENCLAW_CONFIG_CREATED=0
if command -v openclaw &>/dev/null; then
    OPENCLAW_BIN="$(command -v openclaw)"
    OPENCLAW_VER="$(openclaw --version 2>/dev/null || echo 'unknown')"
    echo "[docker-entrypoint] OpenClaw detected: ${OPENCLAW_BIN} (${OPENCLAW_VER})"
    echo "[docker-entrypoint] State dir: $OPENCLAW_STATE_DIR"
    echo "[docker-entrypoint] Config path: $OPENCLAW_CONFIG"
    echo "[docker-entrypoint] Gateway log: $GATEWAY_LOG"

    if [ "${OCD_SKIP_EXTRAS:-0}" != "1" ]; then
        ensure_default_clawhub || true
        ensure_default_skillhub || true
    fi

    if ensure_default_openclaw_config; then
        sanitize_openclaw_plugin_config || true
        echo "[docker-entrypoint] Starting OpenClaw gateway..."
        nohup openclaw gateway run --port "$GATEWAY_PORT" > "$GATEWAY_LOG" 2>&1 &
        GATEWAY_PID=$!
        GATEWAY_WAIT_SECONDS=30
        if [ "$OPENCLAW_CONFIG_CREATED" = "1" ]; then
            GATEWAY_WAIT_SECONDS=120
        fi
        if [ -n "${OCD_GATEWAY_WAIT_SECONDS:-}" ]; then
            GATEWAY_WAIT_SECONDS="$OCD_GATEWAY_WAIT_SECONDS"
        fi
        echo "[docker-entrypoint] Waiting up to ${GATEWAY_WAIT_SECONDS}s for OpenClaw gateway readiness..."
        # Wait for gateway to be ready
        GATEWAY_STARTED=false
        for i in $(seq 1 "$GATEWAY_WAIT_SECONDS"); do
            if curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" &>/dev/null; then
                echo ""
                echo "[docker-entrypoint] OpenClaw gateway started successfully (pid=$GATEWAY_PID, ${i}s)"
                GATEWAY_STARTED=true
                break
            fi
            # Check if process exited early
            if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
                echo ""
                echo "[docker-entrypoint] ERROR: OpenClaw gateway process exited prematurely" >&2
                tail -10 "$GATEWAY_LOG" 2>/dev/null >&2 || true
                write_bootstrap "failed" "gateway process exited prematurely" 0 "$OPENCLAW_BIN" "$OPENCLAW_VER"
                break
            fi
            # Print progress every 10 seconds
            if [ $((i % 10)) -eq 0 ]; then
                printf "[docker-entrypoint] Still waiting... (%ds/%ds)\n" "$i" "$GATEWAY_WAIT_SECONDS"
            fi
            sleep 1
        done
        if [ "$GATEWAY_STARTED" = true ]; then
            write_bootstrap "running" "gateway started successfully" "$GATEWAY_PID" "$OPENCLAW_BIN" "$OPENCLAW_VER"
        elif kill -0 "$GATEWAY_PID" 2>/dev/null; then
            echo "[docker-entrypoint] WARNING: OpenClaw gateway not ready within ${GATEWAY_WAIT_SECONDS}s (pid=$GATEWAY_PID)" >&2
            echo "[docker-entrypoint] Gateway is still running — it may need more time on first boot." >&2
            echo "[docker-entrypoint] Check gateway logs: docker compose exec clawdeckx tail -30 $GATEWAY_LOG" >&2
            write_bootstrap "timeout" "gateway not ready within ${GATEWAY_WAIT_SECONDS}s" "$GATEWAY_PID" "$OPENCLAW_BIN" "$OPENCLAW_VER"
        fi
    else
        write_bootstrap "failed" "failed to generate initial config at ${OPENCLAW_CONFIG}" 0 "$OPENCLAW_BIN" "$OPENCLAW_VER"
    fi
else
    echo "[docker-entrypoint] OpenClaw not found in PATH, skipping gateway auto-start"
    echo "[docker-entrypoint] npm prefix: $NPM_CONFIG_PREFIX"
    write_bootstrap "not_installed" "openclaw command not found in PATH" 0 "" ""
fi

# ── Runtime overlay: prefer updated binary from persistent volume ──
CLAWDECKX_BIN="/app/clawdeckx"
if [ -x "$RUNTIME_DIR/clawdeckx/clawdeckx" ] && [ -f "$RUNTIME_DIR/clawdeckx/manifest.json" ]; then
    echo "[docker-entrypoint] Using runtime overlay ClawDeckX from $RUNTIME_DIR/clawdeckx/clawdeckx"
    CLAWDECKX_BIN="$RUNTIME_DIR/clawdeckx/clawdeckx"
fi

# Ensure ClawDeckX picks up the correct OpenClaw config path regardless of binary version
export OCD_OPENCLAW_CONFIG_PATH="${OCD_OPENCLAW_CONFIG_PATH:-$OPENCLAW_STATE_DIR}"

# Start ClawDeckX (exec replaces shell so tini can manage signals)
exec "$CLAWDECKX_BIN" serve "$@"
