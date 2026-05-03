import type { Effect, EvalResult } from "./types";

export function withCleanup<V>(value: V, cleanup: () => void): Effect<V> {
  return { value, cleanup };
}

export function isEffect<V>(x: EvalResult<V>): x is Effect<V> {
  return (
    typeof x === "object" &&
    x !== null &&
    "value" in x &&
    "cleanup" in (x as Record<string, unknown>) &&
    typeof (x as Effect<V>).cleanup === "function"
  );
}
