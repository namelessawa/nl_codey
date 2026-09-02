# Explicit live LLM smoke

The default, integration, recovery and TUI gates are deterministic and do not
read model credentials or make model/network calls. The supported explicit
live gates are:

```powershell
pnpm test:llm:live
pnpm test:eval:live
```

This command deliberately reads the ignored repository-root `custom.txt`:

```text
CUSTOM_API_KEY=<secret>
CUSTOM_BASE_URL=https://provider.example/v1
CUSTOM_MODEL=<model-id>
```

The parser accepts blank lines, `#` comments and matching single/double quotes.
It rejects unknown/duplicate/missing fields, non-HTTP URLs, embedded URL
credentials, control characters and files over 64 KiB. Diagnostics contain
only field names and line numbers; they never include configured values.

`test:llm:live` uses the `custom` OpenAI-compatible provider in read-only mode. It
asks the model to call a deterministic `read_memory` fixture and proves the
schema, streamed tool call and dispatcher round-trip without writing the
workspace, SQLite or JSONL. Provider failures pass through the shared
secret-redaction boundary before Vitest displays them.

`test:eval:live` runs the frozen 13-category Headless benchmark serially in
disposable workspaces. Approved patches can mutate only those temporary roots;
the crash fixture uses a temporary SQLite database and the Git fixture uses a
temporary local repository with no remote. Its console output contains only
category names, pass/fail booleans and controlled reason codes. Raw assistant
text, tool arguments and provider error bodies are not logged or persisted.
The command restores the Electron `better-sqlite3` ABI in a `finally` path.

Do not add either command to default PR or release jobs. Live gates spend tokens
and depend on an external service; operators must opt in deliberately.
