import { describe, it, expect } from 'vitest';
import { parseWebviewMessage, parseDetailMessage } from './protocol';

describe('parseWebviewMessage', () => {
  it('accepts a ready message', () => {
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
  });

  it('accepts a selectGroup message with a string groupId', () => {
    expect(parseWebviewMessage({ type: 'selectGroup', groupId: 'g1' })).toEqual({ type: 'selectGroup', groupId: 'g1' });
  });

  it('rejects selectGroup without a string groupId', () => {
    expect(parseWebviewMessage({ type: 'selectGroup' })).toBeNull();
    expect(parseWebviewMessage({ type: 'selectGroup', groupId: 5 })).toBeNull();
  });

  it('rejects unknown types and non-objects', () => {
    expect(parseWebviewMessage({ type: 'nope' })).toBeNull();
    expect(parseWebviewMessage(null)).toBeNull();
    expect(parseWebviewMessage('ready')).toBeNull();
  });
});

describe('parseDetailMessage', () => {
  it('accepts a ready message', () => {
    expect(parseDetailMessage({ type: 'ready' })).toEqual({ type: 'ready' });
  });

  it('accepts a selectAnnotation message with a string annotationId', () => {
    expect(parseDetailMessage({ type: 'selectAnnotation', annotationId: 'a1' })).toEqual({
      type: 'selectAnnotation',
      annotationId: 'a1',
    });
  });

  it('rejects selectAnnotation without a string annotationId', () => {
    expect(parseDetailMessage({ type: 'selectAnnotation' })).toBeNull();
    expect(parseDetailMessage({ type: 'selectAnnotation', annotationId: 7 })).toBeNull();
  });

  it('rejects unknown types and non-objects', () => {
    expect(parseDetailMessage({ type: 'nope' })).toBeNull();
    expect(parseDetailMessage(null)).toBeNull();
  });

  it('accepts updateAnnotation with string id + content', () => {
    expect(parseDetailMessage({ type: 'updateAnnotation', annotationId: 'a1', content: 'hi' })).toEqual({
      type: 'updateAnnotation',
      annotationId: 'a1',
      content: 'hi',
    });
  });

  it('accepts copyText with a string', () => {
    expect(parseDetailMessage({ type: 'copyText', text: 'x' })).toEqual({ type: 'copyText', text: 'x' });
  });

  it('rejects updateAnnotation with non-string fields', () => {
    expect(parseDetailMessage({ type: 'updateAnnotation', annotationId: 'a1', content: 5 })).toBeNull();
    expect(parseDetailMessage({ type: 'copyText', text: 5 })).toBeNull();
  });
});
