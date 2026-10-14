# Demo review — 14 October 2026

Reviewed the local `submission/aide-demo-final.mp4` with ffprobe and extracted frames at 20 and 50 seconds. This is a spot check, not a frame-by-frame privacy or narration review. The original file is preserved.

- Duration: 85.624688 seconds. Video: 1920 × 1080, with an audio stream. It meets the under-three-minute duration requirement.
- At 20 seconds, the assistant shows an earlier completed rollback report above the active investigation. A first-time viewer may confuse the old result with the new task.
- At 50 seconds, raw execution output includes the approver's internal account-derived identifier in both Android and web. Do not publish this capture as-is. No identifier is copied into this note.
- At 50 seconds, Ops' read-back text reports the approved target, while the dashboard still shows 100% traffic on the previous serving revision. This is a presentation inconsistency, not proof that the operation failed. The final take should wait for the dashboard refresh and agree with the read-back.
- The raw result uses the earlier execution wording. Re-record after the candidate deployment to show the current `applied` state and its verification limits.

## Ready-to-record take

1. Use a signed-in account on the authorized demo service, and generated traffic only. Clear the visible old-task history without deleting stored cloud evidence: open the intended current task and keep unrelated reports out of the frame.
2. Show one task across web and Android: instruction, bounded reads, hypotheses, policy verdict, exact approval, human tap, applied traffic read-back, final report. Identify the emulator accurately unless a physical-device trial has been completed.
3. The approval card may remain open for eight minutes; the signed execution authorization lasts five minutes after the tap. These are different windows. Explain only the one needed on screen.
4. Capture the new state chip and wait for the dashboard's current traffic split. Show readiness separately from health, and preserve the "health not confirmed" qualification where appropriate.
5. Show no raw actor/account ID, email, resource/project identifier, service URL, token, configuration or debug sign-in details. The current state-summary code suppresses `approved_by` in typed execution summaries, but inspect free-text reports and the Android screen too.
6. Use the recorded first held-out result, not the tuned score, for an unseen-case claim. The 14 October qualification uses real Gemini and synthetic tool data; it is separate from the live video.
7. Keep the video under three minutes, with English narration/captions. Review the entire final file for privacy, old tasks, traffic consistency and unsupported promises of continued monitoring.
8. Upload only on the owner's instruction. Verify that a clean browser can view the resulting link and then update the entry and README.

No upload, publication or replacement of the original video was performed during this review.
