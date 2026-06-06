/** True for an http(s) URL. */
export function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Replace `doc[from..to]` with `[selected](url)`; returns the new doc + the link's range. */
export function linkSelection(
  doc: string,
  from: number,
  to: number,
  url: string,
): { doc: string; selectionFrom: number; selectionTo: number } {
  const selected = doc.slice(from, to);
  const replacement = `[${selected}](${url})`;
  return {
    doc: doc.slice(0, from) + replacement + doc.slice(to),
    selectionFrom: from,
    selectionTo: from + replacement.length,
  };
}

/** A toggle edit: change ops in ORIGINAL-doc coordinates + the resulting selection. */
export interface MarkerEdit {
  /** Non-overlapping change ops; `insert: ''` deletes `[from,to)`. */
  changes: { from: number; to: number; insert: string }[];
  /** New selection, in the coordinate space AFTER this edit's own changes apply. */
  selectionFrom: number;
  selectionTo: number;
}

/**
 * Toggle a symmetric inline marker (`**` bold, `*` italic, `` ` `` code) over `doc[from..to]`.
 *
 * Selection present: unwrap if the markers sit just outside the selection, else if the
 * selected slice itself is wrapped, else wrap (re-selecting the inner text). Bare cursor:
 * remove an empty marker pair around the caret, else insert one with the caret between.
 *
 * Disambiguation: because `*` is a prefix of `**`, an italic (`*`) marker only counts for
 * UNWRAP when the neighbouring char isn't another `*` (so it never strips the inner star of
 * a bold `**` boundary). Toggling italic over `**foo**` therefore wraps → `***foo***`.
 */
export function toggleMarker(doc: string, from: number, to: number, marker: string): MarkerEdit {
  const len = marker.length;
  const at = (pos: number): boolean =>
    pos >= 0 && pos + len <= doc.length && doc.slice(pos, pos + len) === marker;
  const italic = marker === '*';

  if (from < to) {
    // Markers immediately outside the selection?
    const left = from - len;
    // Don't strip the inner star of a **…** boundary when marker is *.
    if (at(left) && at(to) && (!italic || (doc[left - 1] !== '*' && doc[to + len] !== '*'))) {
      return {
        changes: [
          { from: left, to: from, insert: '' },
          { from: to, to: to + len, insert: '' },
        ],
        selectionFrom: from - len,
        selectionTo: to - len,
      };
    }
    // Selection itself wrapped?
    const slice = doc.slice(from, to);
    if (
      slice.length >= 2 * len &&
      slice.startsWith(marker) &&
      slice.endsWith(marker) &&
      // Same guard as the outer check: don't strip the inner star of a **…** boundary.
      (!italic || (slice[len] !== '*' && slice[slice.length - len - 1] !== '*'))
    ) {
      return {
        changes: [
          { from, to: from + len, insert: '' },
          { from: to - len, to, insert: '' },
        ],
        selectionFrom: from,
        selectionTo: to - 2 * len,
      };
    }
    // Otherwise wrap, re-selecting the inner text.
    return {
      changes: [
        { from, to: from, insert: marker },
        { from: to, to, insert: marker },
      ],
      selectionFrom: from + len,
      selectionTo: to + len,
    };
  }

  // Bare cursor.
  const left = from - len;
  if (at(left) && at(from) && (!italic || (doc[left - 1] !== '*' && doc[from + len] !== '*'))) {
    return {
      changes: [
        { from: left, to: from, insert: '' },
        { from, to: from + len, insert: '' },
      ],
      selectionFrom: left,
      selectionTo: left,
    };
  }
  return {
    changes: [{ from, to: from, insert: marker + marker }],
    selectionFrom: from + len,
    selectionTo: from + len,
  };
}
