const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export function sliceGraphemesByUnits(text: string, maxUnits: number): string {
  if (maxUnits <= 0) return "";
  if (text.length <= maxUnits) return text;
  if (!segmenter) {
    let end = 0;
    const stable = /^[\x20-\x7e\u4e00-\u9fff]$/u;
    for (let index = 1; index <= maxUnits && index < text.length; index++) {
      if (stable.test(text[index - 1]!) && stable.test(text[index]!)) end = index;
    }
    return text.slice(0, end);
  }
  let end = 0;
  for (const { segment, index } of segmenter.segment(text)) {
    const next = index + segment.length;
    if (next > maxUnits) break;
    end = next;
  }
  return text.slice(0, end);
}
