/**
 * readline-based interactive prompts. Used by the placeholder TUI for task
 * input and approval gates. Intentionally tiny — no third-party deps.
 */
import readline from "node:readline";

/** Read a single line of free-form input from stdin. */
export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Yes/No prompt. Empty input falls back to `defaultYes`. Ctrl+C rejects. */
export async function yesNo(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await ask(`${question} ${hint} `)).trim().toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

/** Wait until the user presses Enter. */
export async function pause(message = "Press Enter to continue..."): Promise<void> {
  await ask(message);
}
