# Explicit live LLM smoke

The default, integration, recovery and TUI gates are deterministic and do not
read model credentials or make model/network calls. The only supported live
model gate is:

```powershell
pnpm test:llm:live
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

The smoke uses the `custom` OpenAI-compatible provider in read-only mode. It
asks the model to call a deterministic `read_memory` fixture and proves the
schema, streamed tool call and dispatcher round-trip without writing the
workspace, SQLite or JSONL. Provider failures pass through the shared
secret-redaction boundary before Vitest displays them.

Do not add this command to default PR or release jobs. A live gate spends tokens
and depends on an external service; operators must opt in deliberately.
