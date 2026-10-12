#!/usr/bin/env bash
# Checks that this machine can build and run Aide for Android, and prints what to send the owner.
# Read-only: it installs nothing and accepts no licenses.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ok=0; bad=0
pass() { echo "  OK   $1"; ok=$((ok+1)); }
fail() { echo "  FAIL $1"; echo "       -> $2"; bad=$((bad+1)); }

echo "Aide Android doctor ($ROOT)"
ANDROID_HOME="${ANDROID_HOME:-$ROOT/.tools/android-sdk}"

if command -v java >/dev/null && java -version 2>&1 | grep -q '"21\.'; then pass "JDK 21"; else fail "JDK 21" "install a JDK 21 and put it first on PATH (java -version must say 21)"; fi
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]; then pass "Node 24+"; else fail "Node 24+" "install Node.js 24 or newer"; fi
[ -d "$ROOT/node_modules" ] && pass "npm dependencies" || fail "npm dependencies" "run: npm ci"
[ -d "$ANDROID_HOME/platforms/android-36" ] && pass "Android platform 36 in $ANDROID_HOME" || fail "Android SDK platform 36" "see ONBOARDING.md step 3 (install SDK yourself, accept the licenses yourself)"
[ -d "$ANDROID_HOME/build-tools/35.0.0" ] && pass "Build Tools 35.0.0" || fail "Build Tools 35.0.0" "see ONBOARDING.md step 3"
[ -x "$ANDROID_HOME/platform-tools/adb" ] && pass "adb" || fail "platform-tools (adb)" "see ONBOARDING.md step 3"

CFG="$ROOT/apps/android/app/src/main/assets/mobileops-agent.json"
if [ -f "$CFG" ]; then
  if grep -q '"configured": *true' "$CFG" && ! grep -q 'REPLACE_WITH' "$CFG"; then pass "private config present (real values)"; else fail "private config still a placeholder" "ask the owner for the real mobileops-agent.json"; fi
else
  echo "  INFO no private config: the app runs in synthetic rehearsal only (no Google sign-in, no live server)."
fi

KS="$HOME/.android/debug.keystore"
if [ -f "$KS" ] && command -v keytool >/dev/null; then
  echo "  SEND THIS TO THE OWNER (it is a public certificate fingerprint, not a secret):"
  keytool -list -v -keystore "$KS" -alias androiddebugkey -storepass android -keypass android 2>/dev/null | grep -E 'SHA1:|SHA-1:|SHA256:' | sed 's/^ */       /'
else
  echo "  INFO no debug keystore yet; it is created by the first ./gradlew :app:assembleDebug. Re-run doctor afterwards."
fi

if [ -x "$ANDROID_HOME/platform-tools/adb" ]; then
  n=$("$ANDROID_HOME/platform-tools/adb" devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && pass "$n device(s) connected" || echo "  INFO no device connected (USB debugging on, then re-run)."
fi
echo "Result: $ok ok, $bad to fix."
[ "$bad" -eq 0 ]
