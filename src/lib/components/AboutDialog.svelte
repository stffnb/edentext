<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  // Placeholder until the project's repository is public; swap the URL when known.
  const REPO_URL = 'https://github.com/your-org/edentext';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let dialogEl: HTMLDialogElement | null = $state(null);

  // Drive the native <dialog> from the `open` prop so it brings backdrop,
  // Escape-to-close, focus trapping and background inert with it.
  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  // The native close event (Escape, .close()) is the single source of truth.
  function onClose() {
    open = false;
  }

  // A click that lands on the dialog element itself is on the backdrop.
  function onClick(e: MouseEvent) {
    if (e.target === dialogEl) open = false;
  }
</script>

<dialog
  class="about"
  bind:this={dialogEl}
  onclose={onClose}
  onclick={onClick}
  aria-label={t().about.label}
>
  <div class="card">
    <button class="close" onclick={() => (open = false)} aria-label={t().common.close} title={t().common.close}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>

    <img class="logo" src="/EdenText.png" alt="EdenText" />

    <p class="tagline">{t().about.tagline}</p>

    <p class="version">{t().about.version(__APP_VERSION__)}</p>

    <a class="repo" href={REPO_URL} target="_blank" rel="noopener">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.34c-2.23.49-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.72-.5.06-.49.06-.49.8.06 1.22.83 1.22.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.52.56.83 1.28.83 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.19c0 .21.15.46.55.38A8 8 0 0 0 8 .2z" />
      </svg>
      <span>{t().about.viewOnGitHub}</span>
    </a>
  </div>
</dialog>

<style>
  .about {
    margin: auto;
    padding: 0;
    border: none;
    background: transparent;
    max-width: none;
    max-height: none;
    overflow: visible;
  }

  .about::backdrop {
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(2px);
  }

  .about[open] {
    animation: card-in 0.15s cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  .about[open]::backdrop {
    animation: fade-in 0.15s ease;
  }

  @keyframes card-in {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .card {
    position: relative;
    width: 320px;
    box-sizing: border-box;
    padding: 28px 24px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
    font-family: var(--font-sans);
  }

  .close {
    position: absolute;
    top: 8px;
    right: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .close:hover {
    background: var(--color-btn-hover);
    color: var(--color-text);
  }

  .logo {
    height: 30px;
    width: auto;
    margin-top: 4px;
  }

  .tagline {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--color-text-muted);
  }

  .version {
    margin: 0;
    font-size: 0.78rem;
    color: var(--color-text-muted);
  }

  .repo {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-top: 4px;
    padding: 7px 14px;
    font-size: 0.82rem;
    font-weight: 500;
    text-decoration: none;
    color: var(--color-text);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    transition: border-color 0.12s, background 0.12s, color 0.12s;
  }
  .repo:hover {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: #fff;
  }
</style>
