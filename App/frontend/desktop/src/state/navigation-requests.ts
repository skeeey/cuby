/** Cross-page navigation request types shared by the app state and page components. */
export type MemoryReferencePage = "memories" | "tasks" | "policies" | "world-model" | "skills";

export type NavigationRequest =
  | {
      kind: "memory-reference";
      id: string;
      fallbackPage: MemoryReferencePage;
      requestId: number;
    }
  | {
      kind: "tool-skill";
      skillId: string | null;
      requestId: number;
    };

let navigationRequestCounter = 0;

export function nextNavigationRequestId(): number {
  navigationRequestCounter += 1;
  return navigationRequestCounter;
}
