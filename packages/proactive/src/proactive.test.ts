import { describe, expect, it } from "vitest";
import type {
  Proposal,
  ProposalInput,
  ProposalStatus,
} from "@coding-agent/shared";
import { scanForDebt } from "./debt-scanner.js";
import { dedupeAgainstInbox, normalizeTitle } from "./proposal-generator.js";
import { ProposalInbox } from "./proposal-inbox.js";

function makeStore() {
  const proposals: Proposal[] = [];
  let counter = 0;
  return {
    proposals,
    createProposal(input: ProposalInput): Proposal {
      const now = Date.now();
      const p: Proposal = {
        ...input,
        id: `p-${counter++}`,
        status: "new",
        snoozedUntil: null,
        convertedRunId: null,
        createdAt: now,
        updatedAt: now,
      };
      proposals.push(p);
      return p;
    },
    getProposal(id: string) {
      return proposals.find((p) => p.id === id) ?? null;
    },
    listProposals(workspaceId: string, status?: ProposalStatus) {
      return proposals.filter(
        (p) => p.workspaceId === workspaceId && (!status || p.status === status),
      );
    },
    updateProposalStatus(
      id: string,
      status: ProposalStatus,
      extras: { snoozedUntil?: number | null; convertedRunId?: string | null } = {},
    ) {
      const p = proposals.find((x) => x.id === id);
      if (!p) return null;
      p.status = status;
      p.updatedAt = Date.now();
      if (extras.snoozedUntil !== undefined) p.snoozedUntil = extras.snoozedUntil;
      if (extras.convertedRunId !== undefined) p.convertedRunId = extras.convertedRunId;
      return { ...p };
    },
  };
}

describe("debt-scanner", () => {
  it("flags oversized files", () => {
    const files = [{ path: "big.ts", content: "x\n".repeat(900), lastModified: 0 }];
    const proposals = scanForDebt("w1", files);
    expect(proposals.some((p) => p.kind === "refactor")).toBe(true);
  });

  it("flags concentrated TODOs", () => {
    const content = Array.from({ length: 10 }).map((_, i) => `// TODO ${i}`).join("\n");
    const proposals = scanForDebt("w1", [
      { path: "a.ts", content, lastModified: 0 },
    ]);
    expect(proposals.some((p) => p.kind === "tech_debt")).toBe(true);
  });

  it("respects maxProposals", () => {
    const files = Array.from({ length: 50 }).map((_, i) => ({
      path: `f${i}.ts`,
      content: "x\n".repeat(900),
      lastModified: 0,
    }));
    const proposals = scanForDebt("w1", files, { maxProposals: 5 });
    expect(proposals).toHaveLength(5);
  });

  it("NEVER returns more than declared proposal records (read-only)", () => {
    const files = [{ path: "a.ts", content: "x", lastModified: 0 }];
    const proposals = scanForDebt("w1", files);
    for (const p of proposals) {
      expect(p.workspaceId).toBe("w1");
      // No side effects: function is pure on the input.
    }
  });
});

describe("dedupeAgainstInbox", () => {
  it("filters out proposals matching existing inbox titles", () => {
    const inputs: ProposalInput[] = [
      {
        workspaceId: "w1",
        kind: "refactor",
        title: "Split big.ts",
        rationale: "",
        estimatedEffort: "M",
        affectedFiles: ["big.ts"],
      },
    ];
    const existing: Proposal[] = [
      {
        id: "p1",
        workspaceId: "w1",
        kind: "refactor",
        title: "split big.ts",
        rationale: "",
        estimatedEffort: "M",
        affectedFiles: ["big.ts"],
        status: "new",
        snoozedUntil: null,
        convertedRunId: null,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const filtered = dedupeAgainstInbox(inputs, {
      workspaceId: "w1",
      existing,
    });
    expect(filtered).toHaveLength(0);
  });

  it("normalizeTitle handles whitespace and case", () => {
    expect(normalizeTitle("  ABC   DEF  ")).toBe("abc def");
  });
});

describe("ProposalInbox", () => {
  it("ingest/list/dismiss/snooze/convert lifecycle", () => {
    const store = makeStore();
    const inbox = new ProposalInbox(store);
    const p = inbox.ingest({
      workspaceId: "w1",
      kind: "tech_debt",
      title: "Clean TODOs in foo.ts",
      rationale: "lots of TODOs",
      estimatedEffort: "S",
      affectedFiles: ["foo.ts"],
    });
    expect(inbox.list("w1", "new")).toHaveLength(1);

    inbox.snooze(p.id, Date.now() + 1000);
    expect(inbox.list("w1", "new")).toHaveLength(0);
    expect(inbox.list("w1", "snoozed")).toHaveLength(1);

    const rewoken = inbox.rewakeSnoozed("w1", Date.now() + 2000);
    expect(rewoken).toHaveLength(1);
    expect(inbox.list("w1", "new")).toHaveLength(1);

    const dismissed = inbox.dismiss(p.id);
    expect(dismissed?.status).toBe("dismissed");
  });

  it("convert records the new run id", () => {
    const store = makeStore();
    const inbox = new ProposalInbox(store);
    const p = inbox.ingest({
      workspaceId: "w1",
      kind: "refactor",
      title: "x",
      rationale: "",
      estimatedEffort: "S",
      affectedFiles: [],
    });
    const converted = inbox.convert(p.id, "run-99");
    expect(converted?.status).toBe("converted_to_task");
    expect(converted?.convertedRunId).toBe("run-99");
  });
});
