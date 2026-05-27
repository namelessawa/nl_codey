import { useEffect, useRef } from "react";
import type { AgentStep } from "@coding-agent/shared";
import { DiffView } from "./DiffView.js";

type Props = { steps: AgentStep[] };

/** How close to the bottom (px) still counts as "stuck", so we keep auto-scrolling. */
const STICK_THRESHOLD_PX = 48;

/** Nearest scrollable ancestor, so auto-scroll works regardless of which panel scrolls. */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/** Renders the full AgentRun step stream and follows the latest output to the bottom. */
export function StepStream({ steps }: Props): JSX.Element {
  const endRef = useRef<HTMLDivElement | null>(null);
  // Whether the user is parked near the bottom; only then do we follow new output.
  const stickToBottom = useRef(true);

  useEffect(() => {
    const scroller = findScrollParent(endRef.current);
    if (!scroller) return;
    const onScroll = (): void => {
      const distanceFromBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      stickToBottom.current = distanceFromBottom <= STICK_THRESHOLD_PX;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  // Follow new steps as the LLM streams output, unless the user scrolled up.
  useEffect(() => {
    if (stickToBottom.current) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [steps]);

  return (
    <ul className="steps">
      {steps.length === 0 ? (
        <li className="empty">No steps yet. Enter a task and click Run.</li>
      ) : (
        steps.map((step) => (
          <li key={step.id} className={`step ${step.type}`}>
            <span className="badge">{step.type}</span>
            {step.type === "diff" ? (
              <DiffView patch={step.content} />
            ) : (
              <pre>{step.content}</pre>
            )}
          </li>
        ))
      )}
      <div ref={endRef} aria-hidden="true" />
    </ul>
  );
}
