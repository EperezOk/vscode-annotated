import { type AnnotationGroup, type Annotation, DEFAULT_TAG_COLOR } from '../shared/model';
import { type TagColor } from '../shared/protocol';
import { tagColor } from './sidebarState';
import { oneLine } from './detailState';
import { svgDataUri } from '../shared/svgIcon';

/** Max bars drawn in one line's gutter icon; extra annotations still appear in the hover. */
export const MAX_BARS = 4;

/** A group's bar color: its first tag's palette color, or a neutral default if untagged. */
function groupBarColor(group: AnnotationGroup, palette: TagColor[]): string {
  return group.tags.length > 0 ? tagColor(palette, group.tags[0].name) : DEFAULT_TAG_COLOR;
}

/**
 * Map of 1-based line number → ordered bar colors for `file`: one bar per annotation (in a
 * non-resolved group) whose range covers that line. Order follows group, then annotation,
 * then line order, so colors are stable across renders.
 */
export function gutterBarsByLine(
  groups: AnnotationGroup[],
  file: string,
  palette: TagColor[],
): Map<number, string[]> {
  const byLine = new Map<number, string[]>();
  for (const group of groups) {
    if (group.status === 'resolved') {
      continue;
    }
    const color = groupBarColor(group, palette);
    for (const annotation of group.annotations) {
      if (annotation.file !== file) {
        continue;
      }
      for (let line = annotation.range.startLine; line <= annotation.range.endLine; line++) {
        const bars = byLine.get(line);
        if (bars) {
          bars.push(color);
        } else {
          byLine.set(line, [color]);
        }
      }
    }
  }
  return byLine;
}

/**
 * A `data:` SVG of thin vertical bars (one per color, capped at MAX_BARS) for use as a
 * gutter icon. Colors beyond the cap are dropped (the sidebar/hover still surface them).
 */
export function buildGutterSvg(colors: string[]): string {
  const shown = colors.slice(0, MAX_BARS);
  const unit = 4; // 3px bar + 1px gap
  const width = Math.max(unit, shown.length * unit);
  const rects = shown
    .map((color, i) => `<rect x="${i * unit}" y="0" width="3" height="16" fill="${color}"/>`)
    .join('');
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="16" viewBox="0 0 ${width} 16">${rects}</svg>`,
  );
}

/** Non-resolved annotations whose range covers `line` in `file`, each with its group. */
export function annotationsAtLine(
  groups: AnnotationGroup[],
  file: string,
  line: number,
): { group: AnnotationGroup; annotation: Annotation }[] {
  const out: { group: AnnotationGroup; annotation: Annotation }[] = [];
  for (const group of groups) {
    if (group.status === 'resolved') {
      continue;
    }
    for (const annotation of group.annotations) {
      if (annotation.file === file && annotation.range.startLine <= line && line <= annotation.range.endLine) {
        out.push({ group, annotation });
      }
    }
  }
  return out;
}

/**
 * Group a file's per-line bars by color signature: each distinct signature (the colors
 * joined by `|`) maps to those colors plus the sorted lines that have exactly that
 * signature. The VSCode layer creates one decoration type per signature.
 */
export function decorationGroups(
  barsByLine: Map<number, string[]>,
): { signature: string; colors: string[]; lines: number[] }[] {
  const bySignature = new Map<string, { colors: string[]; lines: number[] }>();
  for (const [line, colors] of barsByLine) {
    const signature = colors.join('|');
    const entry = bySignature.get(signature);
    if (entry) {
      entry.lines.push(line);
    } else {
      bySignature.set(signature, { colors, lines: [line] });
    }
  }
  return [...bySignature.entries()].map(([signature, { colors, lines }]) => ({
    signature,
    colors,
    lines: lines.sort((a, b) => a - b),
  }));
}

/**
 * The 1-based line numbers eligible for the generic whole-line highlight: every line that
 * has at least one gutter bar, sorted ascending. Resolved groups are already excluded by
 * `gutterBarsByLine`, so they never appear here.
 */
export function highlightableLines(barsByLine: Map<number, string[]>): number[] {
  return [...barsByLine.keys()].sort((a, b) => a - b);
}

/**
 * A trusted-MarkdownString body: one `command:` link per annotation covering a line,
 * each invoking `annotated.openAnnotation` with its `{ groupId, annotationId }` args.
 */
export function hoverMarkdown(
  items: { label: string; groupId: string; annotationId: string }[],
): string {
  return items
    .map((it) => {
      const args = encodeURIComponent(JSON.stringify({ groupId: it.groupId, annotationId: it.annotationId }));
      return `[📝 ${it.label}](command:annotated.openAnnotation?${args})`;
    })
    .join('\n\n');
}

/**
 * Build the hover command-link items for a line's annotations: each label is the group
 * title plus a one-line snippet of the annotation content (or '(empty)').
 */
export function hoverItems(
  matches: { group: AnnotationGroup; annotation: Annotation }[],
): { label: string; groupId: string; annotationId: string }[] {
  return matches.map(({ group, annotation }) => ({
    label: `${group.title} · ${oneLine(annotation.content) || '(empty)'}`,
    groupId: group.id,
    annotationId: annotation.id,
  }));
}
