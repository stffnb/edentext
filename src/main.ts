import { mount } from 'svelte';
import App from './App.svelte';
import './styles/global.css';
import { loadTheme, applyTheme } from './lib/storage/theme';

// Apply saved theme before mount to prevent flash of wrong theme
applyTheme(loadTheme());

// Keep 'auto' in sync when system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (loadTheme() === 'auto') applyTheme('auto');
});

const app = mount(App, { target: document.getElementById('app')! });

export default app;
