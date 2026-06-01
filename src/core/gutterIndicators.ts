import { type AnnotationGroup, type Annotation } from '../shared/model';
import { type TagColor } from '../shared/protocol';
import { tagColor } from './sidebarState';
import { svgDataUri } from '../shared/svgIcon';

const DEFAULT_BAR_COLOR = '#888888';

/** Max bars drawn in one line's gutter icon; extra annotations still appear in the hover. */
export const MAX_BARS = 4;

/** A group's bar color: its first tag's palette color, or a neutral default if untagged. */
function groupBarColor(group: AnnotationGroup, palette: TagColor[]): string {
  return group.tags.length > 0 ? tagColor(palette, group.tags[0]) : DEFAULT_BAR_COLOR;
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
