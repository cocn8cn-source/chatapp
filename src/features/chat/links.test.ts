import { allUrls, safeExternalUrl, tokenizeMessage } from './links';

describe('shared links', () => {
  it('extracts unique safe URLs and trims trailing punctuation', () => {
    const text = 'Read https://example.com/a?x=1, then https://example.com/a?x=1 and http://docs.test/page).';
    expect(allUrls(text)).toEqual(['https://example.com/a?x=1', 'http://docs.test/page']);
  });

  it('rejects non-http schemes and embedded credentials', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('https://user:pass@example.com/')).toBeNull();
    expect(safeExternalUrl('https://example.com/ok')).toBe('https://example.com/ok');
  });

  it('renders unsafe schemes as plain text, not links', () => {
    const segments = tokenizeMessage('see javascript:alert(1) now');
    expect(segments.some((s) => s.type === 'url')).toBe(false);
  });
});
