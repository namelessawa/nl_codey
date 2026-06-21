/**
 * CLI-managed provider config: lives at `<dataRoot>/cli-providers.json`
 * and is owned entirely by the TUI's `/provider` flow. The GUI's own
 * `settings.json` + encrypted `apikey.bin` are NOT touched — we keep
 * the GUI's secret store sacred and just maintain a parallel CLI store.
 *
 * The file holds the active provider id and one config per configured
 * provider (preset id like `openai`/`zhipu`, or a custom slot key like
 * `custom:1`). API keys are stored *plaintext* — the CLI has no
 * equivalent of Electron's `safeStorage`, so the file is created with
 * `0o600` perms on POSIX. On Windows the user's home directory is
 * already user-scoped; for tighter ACLs the user should rely on
 * `NLC_API_KEY` / provider env vars instead.
 *
 * When the file is missing the loader returns the empty-store shape;
 * callers never have to special-case "first run".
 */
import fs from "node:fs";
import path from "node:path";
import {
  CUSTOM_PROVIDER_SLOT_COUNT,
  findPresetProvider,
  parseCustomSlotKey,
  type ProviderProtocol,
} from "@nlc/shared";

/** A configured provider (preset or custom slot) ready for use. */
export type StoredProvider = {
  /** Stable storage key (preset id or `custom:N`). */
  key: string;
  /** Display name. Editable for custom slots; locked to the preset's name for presets. */
  name: string;
  baseUrl: string;
  /** Plaintext API key. May be empty when relying on env vars. */
  apiKey: string;
  /** Default model id. */
  model: string;
  /** Transport family. */
  protocol: ProviderProtocol;
  /** Unix ms the row was last written. */
  updatedAt: number;
};

export type ProviderStore = {
  version: 1;
  /** Storage key of the active provider, or null when none picked yet. */
  active: string | null;
  /** Map from storage key → config. Missing entries mean "not configured". */
  providers: Record<string, StoredProvider>;
};

const EMPTY_STORE: ProviderStore = { version: 1, active: null, providers: {} };

/** Absolute path to the on-disk file under a given data root. */
export function providerStorePath(dataRoot: string): string {
  return path.join(dataRoot, "cli-providers.json");
}

/** Load the file or return the empty shape; never throws on a missing file. */
export function loadProviderStore(dataRoot: string): ProviderStore {
  const file = providerStorePath(dataRoot);
  try {
    if (!fs.existsSync(file)) return { ...EMPTY_STORE, providers: {} };
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProviderStore>;
    return {
      version: 1,
      active: typeof parsed.active === "string" ? parsed.active : null,
      providers: typeof parsed.providers === "object" && parsed.providers !== null
        ? (parsed.providers as Record<string, StoredProvider>)
        : {},
    };
  } catch {
    return { ...EMPTY_STORE, providers: {} };
  }
}

/** Persist the store, creating the data root on demand with 0o600 perms. */
export function saveProviderStore(dataRoot: string, store: ProviderStore): void {
  fs.mkdirSync(dataRoot, { recursive: true });
  const file = providerStorePath(dataRoot);
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best-effort */
    }
  }
}

/** Upsert one provider entry; set it as active. Returns the updated store. */
export function upsertProvider(
  dataRoot: string,
  entry: Omit<StoredProvider, "updatedAt">,
): ProviderStore {
  const store = loadProviderStore(dataRoot);
  const updated: ProviderStore = {
    ...store,
    active: entry.key,
    providers: {
      ...store.providers,
      [entry.key]: { ...entry, updatedAt: Date.now() },
    },
  };
  saveProviderStore(dataRoot, updated);
  return updated;
}

/** Switch the active provider (without rewriting its config). */
export function setActiveProvider(dataRoot: string, key: string | null): ProviderStore {
  const store = loadProviderStore(dataRoot);
  if (key !== null && !store.providers[key]) {
    throw new Error(`setActiveProvider: "${key}" is not configured`);
  }
  const updated: ProviderStore = { ...store, active: key };
  saveProviderStore(dataRoot, updated);
  return updated;
}

/** Lookup the active provider config, or null when none. */
export function activeProvider(store: ProviderStore): StoredProvider | null {
  if (!store.active) return null;
  return store.providers[store.active] ?? null;
}

/**
 * Validate a storage key — must be a known preset id or a valid
 * `custom:N` slot (1..{@link CUSTOM_PROVIDER_SLOT_COUNT}).
 */
export function isValidProviderKey(key: string): boolean {
  if (findPresetProvider(key)) return true;
  return parseCustomSlotKey(key) !== null;
}

/** Hard-coded clamp the picker uses; re-exported for convenience. */
export const SLOT_COUNT = CUSTOM_PROVIDER_SLOT_COUNT;
