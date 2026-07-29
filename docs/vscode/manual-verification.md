# VS Code release-candidate manual verification

Current status: **NOT RUN for a release candidate**

Automated evidence already proves the extension host adapter, approval protocol,
versioned VSIX archive shape and an isolated CLI install. The latest local
artifact installed as `nl-codey.nl-codey@0.1.0` through VS Code 1.127 without
touching the user's normal extensions or user-data directories. That does not
replace exercising commands inside a real Extension Host.

## Environment

| Field | Required value |
| --- | --- |
| Tester | |
| Commit / VSIX SHA-256 | |
| VS Code version | |
| Windows version | |
| NL Codey CLI artifact/version | |
| Workspace fixture | Disposable, single-root repository |
| Provider fixture | Mock or sanitized provider; never record a real key |

## Required operations

| Check | Observation | Result |
| --- | --- | --- |
| Install the exact VSIX and confirm `nl-codey.nl-codey` version | | |
| Command Palette shows **NL Codey: Run Task** and **Stop Task** | | |
| Empty and multi-root workspaces are rejected visibly | | |
| A read-only task streams bounded output into the NL Codey channel | | |
| A proposed patch remains unchanged before the modal decision | | |
| Closing/Reject denies the patch and Apply sends one decision | | |
| Stop terminates an active child and a later launch reconciles the Run | | |
| CLI path rejects `.cmd`/`.bat` shims and accepts the documented native/JS form | | |
| Provider/tool errors expose no key, bearer token or user-home path | | |
| Disable/uninstall leaves no child process | | |

## Verdict

- Result: `PASS` / `FAIL` / `BLOCKED`
- Failures and reproduction:
- Sanitized artifacts:
- Reviewer:

`PASS` requires every row and does not expand the current scope: multi-root
execution, Session browsing and rollback UI remain explicit unsupported gaps.
