#!/usr/bin/env bash
# Pinned local formatter. This command never downloads tools or Android dependencies.
set -euo pipefail
android_root=$(cd "$(dirname "$0")/.." && pwd)
repository_root=$(cd "$android_root/../.." && pwd)
formatter="$repository_root/.tools/formatters/ktfmt-0.65-with-dependencies.jar"
expected_sha=aba9753b6ab387926179ab7318ba8e0c33dad483ebc72f633e79522265b15214
if [[ ! -f "$formatter" ]]; then
    echo 'Prepare ktfmt 0.65 with-dependencies from https://github.com/Kotlin/ktfmt/releases/tag/v0.65 in .tools/formatters first.' >&2
    exit 1
fi
actual_sha=$(shasum -a 256 "$formatter" | cut -d ' ' -f 1)
[[ "$actual_sha" == "$expected_sha" ]] || { echo 'ktfmt checksum mismatch.' >&2; exit 1; }
arguments=(--kotlinlang-style)
if [[ "${1:-}" == --check ]]; then arguments+=(--dry-run --set-exit-if-changed); fi
files=()
while IFS= read -r -d '' file; do files+=("$file"); done < <(
    find "$android_root" \( -name build -o -name .gradle \) -prune -o \
        \( -name '*.kt' -o -name '*.kts' \) ! -name Theme.kt -print0
)
# Theme.kt is generated from design/tokens.json and must retain generator output byte-for-byte.
java -jar "$formatter" "${arguments[@]}" "${files[@]}"
