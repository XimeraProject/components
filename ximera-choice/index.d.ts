export function shuffleIds(ids: string[], seed: number): string[];
export function generateSeed(): number;
export function shuffleInitReducer(): (model: Record<string, unknown>, msg: { problemId: string; seed: number }) => Record<string, unknown>;
export function initShuffleAtMount(
  container: Element | null,
  options?: { currentSeed?: number; dispatch?: (msg: unknown) => void; msgType?: string }
): { shuffled: boolean; seed?: number };
export function permuteChoicesInPlace(container: Element | null, seed: number): void;
