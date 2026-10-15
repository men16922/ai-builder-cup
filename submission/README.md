# Submission

AI Builder Cup owner-review materials. Current product evidence stays in `docs/STATUS.md`; open work stays in `docs/NEXT_PLAN.md`. Theme: **Future of Work & Enterprise Productivity**. Submission materials are English; the product supports Korean/English.

| File | Purpose and current state |
| --- | --- |
| [SUBMISSION](SUBMISSION.md) | Organizer checklist, evidence gaps and owner actions |
| [DEVPOST](DEVPOST.md) | Current My Aide entry draft; fill actual links and review before submission |
| [MEDIUM](MEDIUM.md) | Historical engineering narrative; not the current feature/acceptance inventory |
| [DEMO_SCRIPT](DEMO_SCRIPT.md) | Current actual-product recording plan, target 2:45; no new take implied |
| `deck/build.mjs` | Reproducible ten-page English My Aide deck using shared tokens and original EV art |
| `deck/evidence.json` | Manually reviewed aggregate evidence snapshot; dated/source-scoped, no raw identities |
| `deck/capture.mjs`, `deck/img/` | Selected offline synthetic product components, capture wrapper and provenance |
| Local `deck/deck.html`, `deck/deck.pdf` | Generated owner-review exports; held back from this commit. An older tracked export in Git may be stale: rebuild it |
| Local `aide-demo-final.mp4` | Historical 85.6-second actual video with known privacy/staleness issues; preserve, do not upload as-is |

With prepared Node/Chromium dependencies, rebuild locally:

```sh
node --import tsx submission/deck/build.mjs
```

Open the resulting HTML with arrow keys or 1-9/0, or inspect all ten rendered PDF pages. Optional recapture is `node --import tsx submission/deck/capture.mjs`; it runs the existing offline fixture and makes no live provider call. Every product capture is labeled synthetic. A PDF build or a synthetic screenshot is not deployed-app or physical-phone proof.

The existing 150.063-second narrated slide video was generated from the **previous** PDF. It is a synthetic presentation, is now visually stale and is not a continuous current-product demonstration. Do not pair its old source hash with the refreshed PDF or present it as the current actual demo.

Fill `<VIDEO_URL>`, `<DEPLOYED_URL>`, `<REPO_URL>` and `<CONTACT>` in the owner-reviewed entry. Code commit/push is authorized; video/private-APK publication and competition submission need separate owner instruction. Git publication alone proves neither deployment nor a submitted entry.
