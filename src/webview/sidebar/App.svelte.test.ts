import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import App from './App.svelte';

describe('App.svelte', () => {
  it('renders the default greeting', () => {
    render(App);
    expect(screen.getByTestId('hello')).toHaveTextContent('Annotated is alive');
  });

  it('renders a custom name', () => {
    render(App, { name: 'Reviewer' });
    expect(screen.getByTestId('hello')).toHaveTextContent('Hello, Reviewer');
  });
});
