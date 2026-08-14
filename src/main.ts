import { mount } from 'svelte';
import App from './App.svelte';
import './styles/global.css';
import { loadTheme, applyTheme } from './lib/storage/theme';
import { locale } from './lib/i18n/i18n.svelte';

// Apply saved theme before mount to prevent flash of wrong theme
applyTheme(loadTheme());

// Resolve the UI locale before mount and reflect it on <html lang> (chrome a11y)
document.documentElement.lang = locale();

// Keep 'auto' in sync when system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (loadTheme() === 'auto') applyTheme('auto');
});

// Offline support (public/sw.js). Not in dev, where a worker would serve the cached
// build over the one being edited.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

const app = mount(App, { target: document.getElementById('app')! });

export default app;
