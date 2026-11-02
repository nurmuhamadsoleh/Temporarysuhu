export function wrapReportText(
  text: string,
  width: number,
  size = 8,
  minimumCharacters = 8,
) {
  const limit = Math.max(minimumCharacters, Math.floor(width / (size * 0.56))),
    lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (line && line.length + word.length + 1 > limit) {
        lines.push(line);
        line = "";
      }
      let tail = word;
      while (tail.length > limit) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(tail.slice(0, limit));
        tail = tail.slice(limit);
      }
      line += (line ? " " : "") + tail;
    }
    lines.push(line);
  }
  return lines;
}
