import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Logo } from './Logo';

function setTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

const src = (container: HTMLElement) => container.querySelector('img')?.getAttribute('src');

describe('Logo', () => {
  it('uses the black mark on light surfaces and the white mark on dark ones', () => {
    setTheme('light');
    const light = render(<Logo />);
    expect(src(light.container)).toBe('/brand/logo-black.png');
    light.unmount();

    setTheme('dark');
    const dark = render(<Logo />);
    expect(src(dark.container)).toBe('/brand/logo-white.png');
    dark.unmount();
  });

  it('forces the white mark on surfaces that stay dark in both themes', () => {
    setTheme('light');
    const { container, unmount } = render(<Logo tone="dark" />);
    expect(src(container)).toBe('/brand/logo-white.png');
    unmount();
  });

  it('follows a theme change without a reload', async () => {
    setTheme('light');
    const { container, unmount } = render(<Logo />);
    expect(src(container)).toBe('/brand/logo-black.png');

    await act(async () => { setTheme('dark'); });
    expect(src(container)).toBe('/brand/logo-white.png');
    unmount();
  });
});
