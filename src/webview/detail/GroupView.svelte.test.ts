import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import GroupView from './GroupView.svelte';
import { type AnnotationGroup } from '../../shared/model';
import { type TagColor } from '../../shared/protocol';

function group(): AnnotationGroup {
  return {
    id: 'g1', title: 'Login review', author: 'Ezequiel', tags: ['security'], gitRef: 'main', status: 'open',
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
});
