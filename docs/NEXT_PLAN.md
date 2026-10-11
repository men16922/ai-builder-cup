# Next plan

Open work only. Live status: `docs/STATUS.md`. Submission checklist: `submission/SUBMISSION.md`.

**Owner (deadline 18 Oct 2026; team registration closed 11 Oct):**
1. Confirm the team registration (2–4 members).
2. Watch `submission/aide-demo-final.mp4` once (avatar initial, closing card), upload it, and keep the link.
3. Fill `<VIDEO_URL>`, `<DEPLOYED_URL>`, `<REPO_URL>`, `<CONTACT>` in `submission/DEVPOST.md` and `submission/MEDIUM.md`, then ask for the push; submit the Devpost entry with the deck PDF (`docs/deck/deck.pdf`).
4. Decide judge access: add judge Google accounts to the allow list, or leave rehearsal mode only.

**Engineering, optional:**
- Web Agent Chat does not follow tasks started on another device until reload; poll the task list.
- Treat the omitted `reconciling` boolean from Cloud Run v2 (open finding in `docs/STATUS.md`); live reads stay "incomplete" until decided.
- Notifications are off in the deployment (needs min instances 1 and always-on CPU, then a real FCM send).
- Connect any project instead of the registered services; a held-out evaluation set; single-use approvals.
