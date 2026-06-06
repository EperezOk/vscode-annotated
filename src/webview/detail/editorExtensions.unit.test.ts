import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { toggleMarkerSpec } from './editorExtensions';

/** Build a state with the given selection ranges, apply the toggle, return doc + selected slices. */
function run(doc: string, ranges: [number, number][], marker: string): { doc: string; sels: string[] } {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([a, b]) => EditorSelection.range(a, b))),
    // allowMultipleSelections: otherwise CodeMirror collapses multiple ranges to one, making the multi-cursor case vacuous.
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  const next = state.update(toggleMarkerSpec(state, marker)).state;
  const text = next.doc.toString();
  return { doc: text, sels: next.selection.ranges.map((r) => text.slice(r.from, r.to)) };
}

describe('toggleMarkerSpec', () => {
  it('toggles bold for a single selection', () => {
    const r = run('foo bar', [[0, 3]], '**');
    expect(r.doc).toBe('**foo** bar');
    expect(r.sels).toEqual(['foo']);
  });
  it('un-toggles bold on a second application', () => {
    const r = run('**foo** bar', [[2, 5]], '**');
    expect(r.doc).toBe('foo bar');
    expect(r.sels).toEqual(['foo']);
  });
  it('processes all selection ranges via changeByRange', () => {
    const r = run('foo bar', [[0, 3], [4, 7]], '**');
    expect(r.doc).toBe('**foo** **bar**');
    expect(r.sels).toEqual(['foo', 'bar']);
  });
  it('inserts an empty code pair at a bare cursor', () => {
    const state = EditorState.create({ doc: 'ab', selection: EditorSelection.cursor(1) });
    const next = state.update(toggleMarkerSpec(state, '`')).state;
    expect(next.doc.toString()).toBe('a``b');
    expect(next.selection.main.head).toBe(2);
  });
});
