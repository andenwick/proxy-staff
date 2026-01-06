/**
 * Extract value from object using dot notation path.
 * 
 * @param obj - The object to extract from
 * @param path - Dot-separated path (e.g., "data.user.name")
 * @returns The extracted value or undefined if path doesn't exist
 * 
 * @example
 * extractValue({ data: { user: { name: "John" } } }, "data.user.name")
 * // Returns: "John"
 */
export function extractValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
