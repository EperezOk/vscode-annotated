import { render, screen, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import GroupView from './GroupView.svelte';
import { type AnnotationGroup } from '../../shared/model';
import { type TagColor } from '../../shared/protocol';

function group(): AnnotationGroup {
  return {
    id: 'g1', title: 'Login review', author: 'Ezequiel', tags: [{ name: 'security', color: '#888888' }], gitRef: 'main', status: 'open',
    createdAt: 1, updatedAt: 1,
    annotations: [{ id: 'a1', file: 'a.ts', range: { startLine: 1, endLine: 2 }, content: '', contentHash: 'h' }],
  };
}
const palette: TagColor[] = [{ name: 'security', color: '#c0392b' }];

describe('GroupView', () => {
  it('renders title, author/status, tag chips, gitRef, and annotation rows', () => {
    render(GroupView, { group: group(), palette });
    expect(screen.getByTestId('detail-title')).toHaveTextContent('Login review');
    expect(screen.getByTestId('group-view')).toHaveTextContent('Ezequiel');
    expect(screen.getByTestId('group-view')).toHaveTextContent('security');
    expect(screen.getByTestId('group-view')).toHaveTextContent('main');
    expect(screen.getAllByTestId('annotation-row')).toHaveLength(1);
  });

  it('edits the title inline and calls onrename on commit', async () => {
    const onrename = vi.fn();
    render(GroupView, { group: group(), palette, onrename });
    await userEvent.click(screen.getByTestId('title-edit-btn'));
    const input = screen.getByTestId('title-input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');
    expect(onrename).toHaveBeenCalledWith('Renamed');
  });

  it('calls oneditgitref / onedittags when those buttons are clicked', async () => {
    const oneditgitref = vi.fn();
    const onedittags = vi.fn();
    render(GroupView, { group: group(), palette, oneditgitref, onedittags });
    await userEvent.click(screen.getByTestId('edit-gitref-btn'));
    await userEvent.click(screen.getByTestId('edit-tags-btn'));
    expect(oneditgitref).toHaveBeenCalled();
    expect(onedittags).toHaveBeenCalled();
  });

  it('calls onselectrow when an annotation row is clicked', async () => {
    const onselectrow = vi.fn();
    render(GroupView, { group: group(), palette, onselectrow });
    await userEvent.click(screen.getByTestId('annotation-row'));
    expect(onselectrow).toHaveBeenCalledWith('a1');
  });

  it('marks a row stale when its id is in staleIds', () => {
    render(GroupView, { group: group(), palette, staleIds: ['a1'] });
    expect(screen.getByTestId('stale-dot')).toBeInTheDocument();
  });

  function group3(): AnnotationGroup {
    return {
      id: 'g1', title: 'G', author: 'A', tags: [], gitRef: null, status: 'open', createdAt: 1, updatedAt: 1,
      annotations: [
        { id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: 'one', contentHash: 'h' },
        { id: 'a2', file: 'x.ts', range: { startLine: 2, endLine: 2 }, content: 'two', contentHash: 'h' },
        { id: 'a3', file: 'x.ts', range: { startLine: 3, endLine: 3 }, content: 'three', contentHash: 'h' },
      ],
    };
  }

  it('reorders via drag-and-drop and calls onreorder with the new id order', async () => {
    const onreorder = vi.fn();
    render(GroupView, { group: group3(), palette, onreorder });
    const handles = screen.getAllByTestId('annotation-drag');
    await fireEvent.dragStart(handles[2]); // drag a3
    await fireEvent.drop(handles[0]);      // drop before a1
    expect(onreorder).toHaveBeenCalledWith(['a3', 'a1', 'a2']);
  });
  it('does not call onreorder when dropped on itself', async () => {
    const onreorder = vi.fn();
    render(GroupView, { group: group3(), palette, onreorder });
    const handles = screen.getAllByTestId('annotation-drag');
    await fireEvent.dragStart(handles[1]);
    await fireEvent.drop(handles[1]);
    expect(onreorder).not.toHaveBeenCalled();
  });

  it('uses readable (auto-contrast) text color on tag chips', () => {
    const dark = render(GroupView, { group: group(), palette: [{ name: 'security', color: '#c0392b' }] });
    expect(screen.getByTestId('tag-chip')).toHaveStyle('color: rgb(255, 255, 255)'); // dark bg → white
    dark.unmount();
    render(GroupView, { group: group(), palette: [{ name: 'security', color: '#ffff00' }] });
    expect(screen.getByTestId('tag-chip')).toHaveStyle('color: rgb(0, 0, 0)'); // light bg → black
  });

  it('shows a Resolve button for an open group and requests resolved on click', async () => {
    const onsetstatus = vi.fn();
    render(GroupView, { group: group(), palette, onsetstatus });
    const btn = screen.getByTestId('resolve-btn');
    expect(btn).toHaveTextContent('Resolve');
    await userEvent.click(btn);
    expect(onsetstatus).toHaveBeenCalledWith('resolved');
  });
  it('shows a Restore button for a resolved group and requests open on click', async () => {
    const onsetstatus = vi.fn();
    render(GroupView, { group: { ...group(), status: 'resolved' }, palette, onsetstatus });
    const btn = screen.getByTestId('resolve-btn');
    expect(btn).toHaveTextContent('Restore');
    await userEvent.click(btn);
    expect(onsetstatus).toHaveBeenCalledWith('open');
  });

  it('autofocuses the title input with the cursor at the end when editing', async () => {
    render(GroupView, { group: group(), palette });
    await userEvent.click(screen.getByTestId('title-edit-btn'));
    const input = screen.getByTestId('title-input') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe('Login review'.length);
    expect(input.selectionEnd).toBe('Login review'.length);
  });
});
