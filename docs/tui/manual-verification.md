# TUI release-candidate manual verification

Current status: **NOT RUN for a release candidate**

Automated ConPTY, render and recovery gates do not replace the human terminal
check required by Goal v2. Copy this checklist for each release candidate,
complete every field, and retain only sanitized screenshots or recordings.

## Environment record

| Field | Required value |
| --- | --- |
| Tester | |
| Commit | |
| Date/time and timezone | |
| OS | Windows 11 version/build |
| Terminal | Windows Terminal version |
| Shell | PowerShell version |
| Node minimum supported | Version and result |
| Node current stable | Version and result |
| Window sizes | At least 120x40, 100x30, 80x24, 60x20 and below minimum |
| Provider fixture | Mock or sanitized test provider; never record a real key |

## Required operations

Record `Pass`, `Fail` or `Blocked` and a concrete observation. “Looks normal”
is not an acceptable result.

| Check | Observation | Result |
| --- | --- | --- |
| First launch shows workspace, provider, policy, prompt and footer | | |
| Chinese input, cursor editing and multiline paste | | |
| CJK/emoji width and long-path layout | | |
| Dark and light themes | | |
| Hundreds of history rows and wheel scrollback | | |
| Mouse classification is visible; clicks do not masquerade as supported UI | | |
| Resize through every required size; draft/focus survives | | |
| Provider picker invalid config, correction, save and new Run | | |
| Session list/tree/resume/branch and restart | | |
| Patch and command approval/rejection | | |
| Stop/Ctrl+C during streaming | | |
| Rollback restores exact workspace content | | |
| Forced exit at approval and restart recovery | | |
| Cursor, alternate-screen and mouse mode are normal after exit/crash | | |
| No orphan child process remains | | |

## Safety confirmation

| Question | Answer and evidence |
| --- | --- |
| Did TUI bypass any approval gate? | |
| Did TUI execute commands outside policy? | |
| Did TUI print credentials or user-home paths? | |
| Did TUI leave mouse mode enabled? | |
| Did TUI leave the cursor hidden? | |
| Did TUI leave child processes running? | |
| Did TUI corrupt a Session after forced exit? | |

## Failures and artifacts

- Failures:
- Reproduction steps:
- Sanitized screenshots or recording:
- Related issue/PR:
- Residual risk:

Do not attach credentials, full terminal recordings containing private code,
user-home paths, provider bodies or unsanitized Session/SQLite content.

## Verdict

- Result: `PASS` / `FAIL` / `BLOCKED`
- Operations tested:
- Reviewer:

`PASS` requires every required row on both supported Node versions. Until a
release-candidate copy of this report is completed, final release acceptance
and `NLC-PRODUCTION-COMPLETE` remain open.
