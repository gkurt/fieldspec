/** What every page of the site shares: the bar at the top, the table of contents, section headings, the footer. */
import { useEffect, useState, type ReactNode } from 'react';
import { VERSION } from '#src/index.ts';

export const REPO = 'https://github.com/gkurt/fieldspec';
const TWITTER = 'gkurttech';

const PAGES = [
  ['tutorial.html', 'Tutorial'],
  ['examples.html', 'Examples'],
  ['models.html', 'AI models'],
] as const;

/** `current` is the page's own href; the homepage has none. */
export function Nav({ current }: { current?: (typeof PAGES)[number][0] }) {
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
      <div className="nav-start">
        <a className="brand" href={current ? './' : '#top'}>
          <Mark /> fieldspec
        </a>
        <div className="nav-links">
          {PAGES.map(([href, text]) => (
            <a key={href} href={href} aria-current={href === current ? 'page' : undefined}>
              {text}
            </a>
          ))}
        </div>
      </div>
      <div className="nav-end">
        <a className="icon-button" href={REPO} aria-label="fieldspec on GitHub">
          <GitHub />
        </a>
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

/** The page's content beside its table of contents: `toc` is [section id, text]. */
export function Page({ toc, children }: { toc: readonly (readonly [string, string])[]; children: ReactNode }) {
  return (
    <div className="page">
      <main>{children}</main>
      <Toc items={toc} />
    </div>
  );
}

function Toc({ items }: { items: readonly (readonly [string, string])[] }) {
  const active = useActiveSection(items);
  return (
    <aside className="toc-aside" aria-labelledby="toc-title">
      <p id="toc-title">On this page</p>
      <ul>
        {items.map(([id, text]) => (
          <li key={id}>
            <a href={`#${id}`} aria-current={id === active ? 'location' : undefined}>
              {text}
            </a>
          </li>
        ))}
      </ul>
      <a className="toc-top" href="#top">
        Back to top ↑
      </a>
    </aside>
  );
}

/** The last section whose top has scrolled past a third of the window, or the last one once the page ends. */
function useActiveSection(items: readonly (readonly [string, string])[]) {
  const [active, setActive] = useState<string>();
  useEffect(
    function followScroll() {
      const sections = items.flatMap(([id]) => document.getElementById(id) ?? []);
      let frame = 0;
      const update = () => {
        frame = 0;
        const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
        const passed = sections.filter((s) => s.getBoundingClientRect().top <= innerHeight / 3);
        setActive((atEnd ? sections : passed).at(-1)?.id);
      };
      const schedule = () => {
        frame ||= requestAnimationFrame(update);
      };
      update();
      addEventListener('scroll', schedule, { passive: true });
      addEventListener('resize', schedule);
      return () => {
        cancelAnimationFrame(frame);
        removeEventListener('scroll', schedule);
        removeEventListener('resize', schedule);
      };
    },
    [items],
  );
  return active;
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

function GitHub() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function X() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64Z" />
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
      <span className="footer-links">
        <a href={REPO}>
          <GitHub /> GitHub
        </a>
        <a href={`https://x.com/${TWITTER}`}>
          <X /> @{TWITTER}
        </a>
      </span>
    </footer>
  );
}
