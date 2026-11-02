import { pageSize, type ControlPage, type TemperatureReport } from "./model";
import { humanReportName } from "./presentation";
import { wrapReportText } from "./text";

export type OperatorNameCell = {
  start: number;
  end: number;
  names: string[];
  lines: string[];
  continued: boolean;
};
export type FullNamePage = {
  page: ControlPage;
  nameCells: OperatorNameCell[];
  nameHeight: number;
};
const MAX_NAME_HEIGHT = 96,
  NAME_SIZE = 8,
  LINE_HEIGHT = 10;
/** Display-only pagination; snapshots, source hashes and measurement values stay unchanged. */
export function buildFullNamePages(report: TemperatureReport): FullNamePage[] {
  const width = pageSize(report.settings.paper).width - 100;
  const byId = new Map(report.readings.map((r) => [r.recordId, r]));
  const namesFor = (ids: string[]) => {
    const names = new Map<string, string>();
    for (const id of ids) {
      const r = byId.get(id);
      if (r)
        names.set(
          r.operatorId || r.recordId,
          humanReportName(r.operatorFullName) ||
            humanReportName(r.operatorName) ||
            "Tidak diketahui",
        );
    }
    const entries = [...names.entries()].sort(([a], [b]) => a.localeCompare(b));
    return {
      key: entries.length ? JSON.stringify(entries) : "",
      names: entries.map(([, name]) => name),
    };
  };
  const layout = (page: ControlPage): FullNamePage => {
    const cw = width / page.columns.length,
      cells: OperatorNameCell[] = [];
    for (let i = 0; i < page.columns.length;) {
      const owner = namesFor(page.columns[i].readingIds);
      let end = i + 1;
      if (owner.key)
        while (
          end < page.columns.length &&
          namesFor(page.columns[end].readingIds).key === owner.key
        )
          end++;
      const lines = owner.names.flatMap((name) =>
        wrapReportText(name, (end - i) * cw - 8, NAME_SIZE / 0.56, 1),
      );
      cells.push({
        start: i,
        end,
        names: owner.names,
        lines,
        continued: false,
      });
      i = end;
    }
    return {
      page,
      nameCells: cells,
      nameHeight: Math.max(
        26,
        ...cells.map((c) => c.lines.length * LINE_HEIGHT + 10),
      ),
    };
  };
  const split = (source: ControlPage, capacity: number) => {
    const pages: FullNamePage[] = [];
    for (let start = 0; start < source.columns.length;) {
      let end = Math.min(start + capacity, source.columns.length);
      if (
        end < source.columns.length &&
        source.columns[end - 1].date === source.columns[end].date
      ) {
        let dayStart = end - 1;
        while (
          dayStart > start &&
          source.columns[dayStart - 1].date === source.columns[end].date
        )
          dayStart--;
        if (dayStart > start) end = dayStart;
      }
      const columns = source.columns.slice(start, end),
        ids = new Set(columns.flatMap((c) => c.readingIds));
      const points = source.points
        .filter((p) => p.readingIds.some((id) => ids.has(id)))
        .map((p) => ({
          ...p,
          x: (p.x * source.columns.length - start) / columns.length,
        }));
      pages.push(layout({ columns, points }));
      start = end;
    }
    return pages;
  };
  return report.pages.flatMap((source) => {
    const original = layout(source);
    if (original.nameCells.every((cell) => cell.lines.length <= 3))
      return [original];
    let capacity = Math.max(
        1,
        Math.min(source.columns.length, Math.floor(width / 100)),
      ),
      pages = split(source, capacity);
    while (capacity > 1 && pages.some((p) => p.nameHeight > MAX_NAME_HEIGHT))
      pages = split(source, --capacity);
    for (const page of pages)
      if (page.nameHeight > MAX_NAME_HEIGHT) {
        for (const cell of page.nameCells)
          if (cell.lines.length > 8) {
            const visible: string[] = [];
            for (const name of cell.names) {
              const lines = wrapReportText(
                name,
                width - 8,
                NAME_SIZE / 0.56,
                1,
              );
              if (visible.length + lines.length > 7) break;
              visible.push(...lines);
            }
            cell.lines = [...visible, "Nama berlanjut"];
            cell.continued = true;
          }
        page.nameHeight = MAX_NAME_HEIGHT;
      }
    return pages;
  });
}
