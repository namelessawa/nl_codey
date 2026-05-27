import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";

/**
 * Stores a single secret (the LLM API key) encrypted at rest. Uses Electron
 * `safeStorage`, which is backed by the OS keychain/credential store where
 * available (Windows DPAPI, macOS Keychain, Linux Secret Service).
 *
 * This class is the ONLY place that reads/writes the raw key on disk. Swapping
 * in a different backend (e.g. a keyring module) later means changing only this
 * file. If encryption is unavailable the key is NOT persisted in plaintext —
 * `set` becomes a no-op and `isPersistent()` returns false so the UI can warn.
 */
export class SecretStore {
  private readonly filePath: string;

  constructor(dir: string, fileName = "apikey.bin") {
    this.filePath = path.join(dir, fileName);
  }

  /** True when secrets can be encrypted and durably stored on this machine. */
  isPersistent(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  get(): string {
    if (!this.isPersistent()) return "";
    try {
      if (!fs.existsSync(this.filePath)) return "";
      const buf = fs.readFileSync(this.filePath);
      if (buf.length === 0) return "";
      return safeStorage.decryptString(buf);
    } catch {
      // Corrupt/undecryptable blob: treat as no key rather than crashing.
      return "";
    }
  }

  set(value: string): void {
    if (!this.isPersistent()) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!value) {
      this.clear();
      return;
    }
    const encrypted = safeStorage.encryptString(value);
    fs.writeFileSync(this.filePath, encrypted, { mode: 0o600 });
  }

  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) fs.rmSync(this.filePath);
    } catch {
      // best-effort
    }
  }
}
