export function splitDiscordMessage(content: string, maxLength = 1_900): string[] {
  const normalized = content.trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const breakpoint = findBreakpoint(slice);
    chunks.push(remaining.slice(0, breakpoint).trim());
    remaining = remaining.slice(breakpoint).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.filter(Boolean);
}

function findBreakpoint(slice: string): number {
  const separators = ['\n\n', '\n', '. ', '。', '！', '？', ' '];

  for (const separator of separators) {
    const index = slice.lastIndexOf(separator);
    if (index > Math.floor(slice.length * 0.6)) {
      return index + separator.length;
    }
  }

  return slice.length;
}
