# Template deck images

- `aide-ev.png`: original Aide EV concept art (`apps/web/public/vehicles/aide-ev.png`, attribution in `design/assets/aide-ev.md`), trimmed and resized.
- `native-*.jpg`: offline synthetic captures from the Android instrumented tests (`apps/android/app/src/androidTest`) on the owned API 36 emulator, build `22fa44c`, 16 October 2026. Fictional callers, places and vehicle state; no account, server address or provider content.
- `web-places.jpg`, `web-call-summary.jpg`: crops of the offline browser fixture `tests/browser/my-aide.mjs` (synthetic identity, model and places), same date.

The filled `Aide-AI-Builder-Cup.pptx`/`.pdf` are ignored by Git because they carry the private product URL and repository owner from `.data/releases/submission-links-private.json`. Rebuild with `python build.py`, then export the PDF from Keynote and review every page.
