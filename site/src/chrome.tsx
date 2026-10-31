/** What every page of the site shares: the bar at the top, section headings, the footer. */
import { useEffect, useState, type ReactNode } from 'react';
import { VERSION } from '#src/index.ts';

export const REPO = 'https://github.com/gkurt/fieldspec';

/** `links` are [href, text, kept on narrow screens]. */
export function Nav({ links, home = '#top' }: { links: readonly (readonly [string, string, boolean?])[]; home?: string }) {
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>(() => {
    try {
      return (localStorage.getItem('fs-theme') as 'light' | 'dark' | null) ?? undefined;
    } catch {
      return undefined;
    }
  });
  // The theme lives outside React: on the document's root and in storage.
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem('fs-theme', theme);
      else localStorage.removeItem('fs-theme');
    } catch {
      // Storage may be unavailable; the choice then lasts the visit.
    }
  }, [theme]);
  const dark = theme ? theme === 'dark' : typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  return (
    <nav className="nav">
      <a className="brand" href={home}>
        <Mark /> fieldspec
      </a>
      <div className="nav-links">
        {links.map(([href, text, keep]) => (
          <a key={href} href={href} data-keep={keep ? '' : undefined}>
            {text}
          </a>
        ))}
        <button
          type="button"
          className="icon-button"
          aria-label={dark ? 'Use light theme' : 'Use dark theme'}
          onClick={() => setTheme(dark ? 'light' : 'dark')}
        >
          {dark ? '☀' : '☾'}
        </button>
      </div>
    </nav>
  );
}

export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="3" width="20" height="5" rx="2" />
      <rect x="2" y="10" width="13" height="5" rx="2" />
      <rect x="2" y="17" width="17" height="5" rx="2" opacity="0.55" />
    </svg>
  );
}

export function Heading({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <div className="heading">
      <p className="eyebrow">{kicker}</p>
      <h2>{title}</h2>
      <p className="lede">{children}</p>
    </div>
  );
}

export function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="footer">
      <span>
        <strong>fieldspec</strong> {VERSION} · MIT
      </span>
      <span>{children}</span>
      <a href={REPO}>GitHub</a>
    </footer>
  );
}
