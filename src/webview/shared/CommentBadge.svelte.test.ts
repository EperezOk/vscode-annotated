import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import CommentBadge from './CommentBadge.svelte';

describe('CommentBadge', () => {
  it('renders the count with a message icon', () => {
    render(CommentBadge, { count: 3 });
    const badge = screen.getByTestId('comment-badge');
    expect(badge).toHaveTextContent('3');
    expect(badge.querySelector('svg')).not.toBeNull();
  });
  it('renders nothing when the count is zero', () => {
    render(CommentBadge, { count: 0 });
    expect(screen.queryByTestId('comment-badge')).toBeNull();
  });
});
