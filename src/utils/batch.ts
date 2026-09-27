export const MAX_BATCH_PROMPTS = 100;

/** One prompt per line. Handles \r\n. Trims each line; drops blank lines. Keeps duplicates and order. */
export function parsePromptList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/**
 * Appends clip modifiers to a prompt as ", mod1, mod2".
 * Skips empty modifiers and any modifier already contained in the prompt (exact substring).
 * Returns the trimmed prompt unchanged when there is nothing to add.
 */
export function applyClipModifiers(prompt: string, modifiers: string[]): string {
  const trimmedPrompt = prompt.trim();
  const validModifiers = modifiers
    .map(m => m.trim())
    .filter(m => m.length > 0)
    .filter(m => !trimmedPrompt.includes(m));

  if (validModifiers.length === 0) {
    return trimmedPrompt;
  }

  return `${trimmedPrompt}, ${validModifiers.join(', ')}`;
}

/** promptCount * numberOfImages * costPerImage */
export function estimateBatchCost(promptCount: number, numberOfImages: number, costPerImage: number): number {
  return promptCount * numberOfImages * costPerImage;
}

/**
 * Backoff for a retryable Gemini failure. attempt is 0-based.
 * If retryAfterHeader parses as a number of seconds >= 0, return that * 1000, capped at 60000.
 * Otherwise return 2000 * 2 ** attempt (2000, 4000, 8000...), capped at 60000.
 */
export function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader !== null) {
    const seconds = Number(retryAfterHeader);
    if (!isNaN(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 60000);
    }
  }
  return Math.min(2000 * Math.pow(2, attempt), 60000);
}
