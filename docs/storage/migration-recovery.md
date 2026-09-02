# SQLite migration backup and recovery

NL_Codey creates a transactionally consistent backup before it changes any
existing database that needs an additive or structural schema migration. Fresh
databases and files already at the current schema do not create a backup.

The backup is written beside the database:

```text
workspace-state.db.pre-migration-v<from>-to-v<to>-<timestamp>-<id>.sqlite
```

SQLite `VACUUM INTO` creates the snapshot before `journal_mode`, schema,
column, table-rebuild or index writes. It includes committed WAL content. A
successful migration retains the backup as a manual rollback point. If a
migration fails, construction closes the database, leaves both the failed
working file and backup untouched, and reports the backup path.

## Recovery procedure

1. Exit every NL_Codey Desktop and CLI process using the database.
2. Locate the newest matching `pre-migration` file beside
   `<data-root>/data/workspace-state.db`.
3. Copy both the failed database (plus any `-wal`/`-shm` sidecars) and the
   backup to a separate support directory before changing either copy.
4. Run SQLite `PRAGMA quick_check` against the backup. The automated migration
   gate performs this check for every failure fixture.
5. Preserve the failed file under a different name, then copy the verified
   backup to `workspace-state.db`.
6. Start NL_Codey once. The backup still carries its original schema version,
   so the normal forward migration runs again. If the same deterministic schema
   error repeats, stop and inspect the preserved copies rather than retrying.

Example PowerShell discovery and non-destructive copies:

```powershell
$db = "<data-root>\data\workspace-state.db"
$support = "<separate-support-directory>"
New-Item -ItemType Directory -Force -Path $support
Get-ChildItem -LiteralPath (Split-Path $db) -Filter "workspace-state.db.pre-migration-*.sqlite"
Copy-Item -LiteralPath $db -Destination (Join-Path $support "workspace-state.failed.db")
Copy-Item -LiteralPath "<selected-backup>" -Destination (Join-Path $support "workspace-state.backup.sqlite")
```

The database and its backups can contain project paths, prompts, run metadata
and model output. Treat every copy as sensitive local data; do not attach it to
an issue without reviewing and sanitizing its contents.
