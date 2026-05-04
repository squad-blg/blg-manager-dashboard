import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
});

// Cookie helpers (no localStorage)
function getCookieTheme(): Theme {
  try {
    const match = document.cookie.match(/(?:^|; )blg-theme=([^;]*)/);
    const val = match ? match[1] : null;
    return val === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function setCookieTheme(theme: Theme) {
  try {
    document.cookie = `blg-theme=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  // Read saved preference once on mount
  useEffect(() => {
    setTheme(getCookieTheme());
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    if (theme === "light") {
      html.classList.add("light");
    } else {
      html.classList.remove("light");
    }
    setCookieTheme(theme);
  }, [theme]);

  const toggleTheme = () =>
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
