import { mount } from 'svelte';
import App from './App.svelte';
import './styles/global.css';
import { loadTheme, applyTheme, loadAccent, applyAccent } from './lib/storage/theme';
import { locale } from './lib/i18n/i18n.svelte';
import { startTabPresence, pruneOldDocuments } from './lib/storage/docScope';
import { dragDialogs } from './lib/utils/dragWindow';
import { embedded } from './lib/embed/mode';

// This tab holds its document while it lives; the ones no tab has held for a while
// and that fell out of the newest few are dropped here. An embedded editor holds none.
if (!embedded) {
    startTabPresence();
    void pruneOldDocuments();
}

dragDialogs();

// Apply saved theme before mount to prevent flash of wrong theme
applyTheme(loadTheme());
applyAccent(loadAccent());

// Resolve the UI locale before mount and reflect it on <html lang> (chrome a11y)
document.documentElement.lang = locale();

// Keep 'auto' in sync when system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (loadTheme() === 'auto') applyTheme('auto');
});

// Offline support (public/sw.js). Not in dev, where a worker would serve the cached
// build over the one being edited. The host application decides on an embedded one's.
if (import.meta.env.PROD && !embedded && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
    });
}

// Drop the static crawler copy (index.html) — mount() appends instead of replacing
document.getElementById('static-intro')?.remove();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
