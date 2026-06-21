import { useEffect, useMemo, useRef, useState } from "react";
import type { LLMProviderId } from "@nlc/shared";
import { PROVIDER_PRESETS } from "@nlc/shared";
import { Icon } from "./Icons.js";

type Tier = "max" | "pref" | "fast" | "local";

interface ModelEntry {
  id: string;
  label: string;
  ctx: string;
  tier: Tier;
  note?: string;
}

interface ProviderGroup {
  id: LLMProviderId;
  name: string;
  badge: string;
  models: ModelEntry[];
}

/**
 * Curated quick-pick catalog. Deep config (custom models, temperature, etc.)
 * still lives in Settings → LLM. The "Open full settings" foot link routes
 * there for anything not in this list.
 */
const CATALOG: ProviderGroup[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    badge: "A",
    models: [
      { id: "claude-opus-4", label: "Opus 4", ctx: "200K", tier: "max", note: "deep reasoning" },
      {
        id: "claude-sonnet-4-5",
        label: "Sonnet 4.5",
        ctx: "200K",
        tier: "pref",
        note: "balanced · default",
      },
      {
        id: "claude-3-5-sonnet-latest",
        label: "Sonnet 3.5",
        ctx: "200K",
        tier: "pref",
        note: "stable",
      },
      { id: "claude-haiku-4", label: "Haiku 4", ctx: "200K", tier: "fast", note: "fastest · cheapest" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    badge: "O",
    models: [
      { id: "gpt-4o", label: "GPT-4o", ctx: "128K", tier: "pref" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", ctx: "128K", tier: "fast" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    badge: "D",
    models: [
      { id: "deepseek-chat", label: "deepseek-chat", ctx: "64K", tier: "fast", note: "balanced · default" },
      { id: "deepseek-reasoner", label: "deepseek-reasoner", ctx: "64K", tier: "max" },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    badge: "G",
    models: [
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", ctx: "1M", tier: "pref" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", ctx: "1M", tier: "fast" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    badge: "R",
    models: [
      { id: "openai/gpt-4o", label: "OpenAI · GPT-4o", ctx: "128K", tier: "pref" },
      {
        id: "anthropic/claude-3.5-sonnet",
        label: "Anthropic · Sonnet 3.5",
        ctx: "200K",
        tier: "pref",
      },
    ],
  },
];

interface ModelSwitcherProps {
  open: boolean;
  anchorRect: DOMRect | null;
  currentModel: string;
  currentProvider: LLMProviderId;
  onPick: (model: string, provider: LLMProviderId) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

export function ModelSwitcher({
  open,
  anchorRect,
  currentModel,
  currentProvider,
  onPick,
  onOpenSettings,
  onClose,
}: ModelSwitcherProps): JSX.Element | null {
  const popRef = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (!popRef.current) return;
      if (!popRef.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return (): void => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) setFilter("");
  }, [open]);

  const filtered = useMemo<ProviderGroup[]>(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return CATALOG;
    return CATALOG.map((group) => ({
      ...group,
      models: group.models.filter(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          group.name.toLowerCase().includes(q),
      ),
    })).filter((g) => g.models.length > 0);
  }, [filter]);

  if (!open) return null;

  // Position popover under the chip, right-aligned to it.
  const top = (anchorRect?.bottom ?? 48) + 6;
  const right = Math.max(
    8,
    window.innerWidth - (anchorRect?.right ?? window.innerWidth - 8),
  );

  const handlePick = (model: string, provider: LLMProviderId): void => {
    onPick(model, provider);
    onClose();
  };

  return (
    <div
      ref={popRef}
      className="ms-popover"
      style={{ top, right }}
      role="dialog"
      aria-label="Switch model"
    >
      <div className="ms-head">
        <div className="ms-head-row">
          <span className="ms-label">model</span>
          <span className="ms-current" title={currentModel}>
            {currentModel || "—"}
          </span>
        </div>
        <input
          className="ms-search"
          autoFocus
          placeholder="Filter models…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="ms-list">
        {filtered.length === 0 && (
          <div className="ms-empty">No models match &quot;{filter}&quot;</div>
        )}
        {filtered.map((group) => (
          <div key={group.id} className="ms-group">
            <div className="ms-group-head">
              <span className={`ms-badge prov-${group.id}`}>{group.badge}</span>
              <span className="ms-group-name">{group.name}</span>
              <span className="ms-group-count">{group.models.length}</span>
            </div>
            {group.models.map((m) => {
              const active = m.id === currentModel && group.id === currentProvider;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`ms-row${active ? " active" : ""}`}
                  onClick={() => handlePick(m.id, group.id)}
                >
                  <span className="ms-check">
                    {active ? <Icon name="check" size={11} stroke={2.4} /> : null}
                  </span>
                  <span className="ms-row-main">
                    <span className="ms-row-label">{m.label}</span>
                    {m.note && <span className="ms-row-note">{m.note}</span>}
                  </span>
                  <span className={`ms-tier tier-${m.tier}`}>{m.tier}</span>
                  <span className="ms-ctx">{m.ctx}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="ms-foot">
        <button
          type="button"
          className="ms-foot-link"
          onClick={() => {
            onClose();
            onOpenSettings();
          }}
        >
          <Icon name="gear" size={11} />
          <span>Open full settings</span>
          <span className="kbdkey-sm">Ctrl+;</span>
        </button>
      </div>
    </div>
  );
}

/** Preset baseUrl + defaultModel for a provider, used when the picker swaps
 *  providers and we need to refresh the LLM config so the backend can talk to
 *  the new endpoint. */
export function presetForProvider(id: LLMProviderId): { baseUrl: string; defaultModel: string } {
  return PROVIDER_PRESETS[id];
}
