import { useState, useEffect } from 'react';

export function useSettings() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('deyad-theme') as 'dark' | 'light') || 'dark';
  });
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);
  const [completionModel, setCompletionModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');

  // Apply theme class to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('deyad-theme', theme);
  }, [theme]);

  const loadSettings = async () => {
    try {
      const s = await window.deyad.getSettings();
      setAutocompleteEnabled(s.autocompleteEnabled ?? false);
      setCompletionModel(s.completionModel ?? '');
      setDefaultModel(s.defaultModel ?? '');
      if (s.theme) {
        setTheme(s.theme);
        localStorage.setItem('deyad-theme', s.theme);
      }
      return s;
    } catch (err) {
      console.warn('Failed to load settings:', err);
      return null;
    }
  };

  return {
    theme, setTheme,
    autocompleteEnabled, setAutocompleteEnabled,
    completionModel, setCompletionModel,
    defaultModel, setDefaultModel,
    loadSettings,
  };
}
