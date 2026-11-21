import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export type Theme = 'dark' | 'light';
const KEY = 'rrms_theme';

/** The theme is the data-theme attribute of <html>. index.html sets it before the first paint. */
function readTheme(): Theme {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' ? 'light' : 'dark';
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(readTheme);

  const apply = useCallback((t: Theme) => {
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#070c18' : '#f4f7fb');
    setTheme(t);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = readTheme() === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem(KEY, next); } catch { /* storage off: the choice lasts until the tab closes */ }
  }, [apply]);

  // Follow the system preference until the visitor has chosen themselves
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(KEY); } catch { /* storage off */ }
      if (saved !== 'light' && saved !== 'dark') apply(mq.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [apply]);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
};

/** The sun / moon button. Same place in every header (next to the profile menu). */
export const ThemeToggle: React.FC = () => {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="rrms-icon-btn" onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
};
