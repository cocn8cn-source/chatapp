import { resolveTheme, useTheme } from './theme';

describe('theme', () => {
  it('resolves system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
  it('applies and persists the chosen theme', () => {
    useTheme.getState().setPreference('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('chatspace-theme')).toBe('dark');
  });
});
