import { describe, expect, it } from 'vitest';
import { messageSummary } from './format';

describe('messageSummary', () => {
  it('prefers the text body', () => {
    expect(messageSummary('say hello')).toBe('say hello');
    expect(messageSummary('  padded  ')).toBe('padded');
  });

  it('labels attachment-only messages by kind instead of calling everything an attachment', () => {
    expect(messageSummary('', [{ kind: 'audio' }])).toBe('Voice note');
    expect(messageSummary('', [{ kind: 'image' }])).toBe('Photo');
    expect(messageSummary('', [{ kind: 'video' }])).toBe('Video');
    expect(messageSummary('', [{ kind: 'file' }])).toBe('File');
  });

  it('marks deleted messages and never renders an empty line', () => {
    expect(messageSummary('old text', [], '2026-01-01T00:00:00Z')).toBe('Message deleted');
    expect(messageSummary('', [])).toBe('Message');
    expect(messageSummary(null, null)).toBe('Message');
  });
});
