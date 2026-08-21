import { useCallback, useState } from "react";

/** In-app routing with Capacities-style back/forward history. */

export type Route =
  | { kind: "home" }
  | { kind: "calendar"; date?: string }          // YYYY-MM-DD
  | { kind: "type"; typeKey: string }
  | { kind: "object"; path: string }
  | { kind: "tag"; tag: string }
  | { kind: "habits" }
  | { kind: "brief" }
  | { kind: "local" }
  | { kind: "pomodoro" }
  | { kind: "settings" };

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

export function useHistory(initial: Route) {
  const [stack, setStack] = useState<Route[]>([initial]);
  const [idx, setIdx] = useState(0);

  const push = useCallback((r: Route) => {
    setStack((s) => {
      const cur = s[idx];
      if (cur && same(cur, r)) return s;
      const next = [...s.slice(0, idx + 1), r];
      setIdx(next.length - 1);
      return next;
    });
  }, [idx]);

  const back = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);
  const forward = useCallback(() => setIdx((i) => Math.min(stack.length - 1, i + 1)), [stack.length]);

  return {
    route: stack[idx],
    push,
    back,
    forward,
    canBack: idx > 0,
    canForward: idx < stack.length - 1,
  };
}
