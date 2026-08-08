<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  import { formulaMathml } from '../editor/extensions/formula';
  // LibreOffice's Formula Editor, one dialog: typeset preview on top, LaTeX source
  // below, an element palette between them. The parent owns `open` and decides whether
  // Apply inserts a new formula or updates the one being edited.
  let {
    open = $bindable(false),
    initialLatex = '',
    initialDisplay = false,
    onApply,
  }: {
    open?: boolean;
    initialLatex?: string;
    initialDisplay?: boolean;
    onApply: (latex: string, display: boolean) => void;
  } = $props();

  let latex = $state('');
  let display = $state(false);
  let dialogEl: HTMLDialogElement | null = $state(null);
  let input: HTMLTextAreaElement | null = $state(null);

  // Label glyphs for the greek palette; the snippet carries the macro name.
  const GREEK: Record<string, string> = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', theta: 'θ',
    lambda: 'λ', mu: 'μ', nu: 'ν', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
    phi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
    Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  };

  // Each palette entry inserts its snippet; `@` marks the placeholder the current
  // selection fills and where the caret lands.
  type Item = { label: string; snip: string };
  const GROUPS: { key: keyof ReturnType<typeof t>['formula']['groups']; items: Item[] }[] = [
    { key: 'structures', items: [
      { label: '⅟', snip: '\\frac{@}{}' },
      { label: '√', snip: '\\sqrt{@}' },
      { label: 'ⁿ√', snip: '\\sqrt[@]{}' },
      { label: 'x²', snip: '^{@}' },
      { label: 'xᵢ', snip: '_{@}' },
      { label: 'x̄', snip: '\\bar{@}' },
      { label: 'v⃗', snip: '\\vec{@}' },
      { label: '(⋯)', snip: '\\left(@\\right)' },
      { label: '[⋯]', snip: '\\left[@\\right]' },
      { label: '|⋯|', snip: '\\left|@\\right|' },
      { label: '⎡⎤', snip: '\\begin{pmatrix}@ & \\\\ & \\end{pmatrix}' },
      { label: '⎧', snip: '\\begin{cases}@ & \\\\ & \\end{cases}' },
    ] },
    { key: 'operators', items: [
      { label: '∑', snip: '\\sum_{@}^{} ' },
      { label: '∏', snip: '\\prod_{@}^{} ' },
      { label: '∫', snip: '\\int_{@}^{} ' },
      { label: '∮', snip: '\\oint_{@}^{} ' },
      { label: '⋃', snip: '\\bigcup_{@}^{} ' },
      { label: 'lim', snip: '\\lim_{@} ' },
      { label: 'sin', snip: '\\sin @' },
      { label: 'cos', snip: '\\cos @' },
      { label: 'log', snip: '\\log @' },
      { label: 'ln', snip: '\\ln @' },
      { label: '∂', snip: '\\partial ' },
      { label: '∇', snip: '\\nabla ' },
    ] },
    { key: 'relations', items: [
      { label: '≤', snip: '\\le ' }, { label: '≥', snip: '\\ge ' },
      { label: '≠', snip: '\\ne ' }, { label: '≈', snip: '\\approx ' },
      { label: '≡', snip: '\\equiv ' }, { label: '∝', snip: '\\propto ' },
      { label: '±', snip: '\\pm ' }, { label: '×', snip: '\\times ' },
      { label: '÷', snip: '\\div ' }, { label: '⋅', snip: '\\cdot ' },
      { label: '∈', snip: '\\in ' }, { label: '⊂', snip: '\\subset ' },
      { label: '∪', snip: '\\cup ' }, { label: '∩', snip: '\\cap ' },
      { label: '→', snip: '\\rightarrow ' }, { label: '⇒', snip: '\\Rightarrow ' },
      { label: '∞', snip: '\\infty ' }, { label: '…', snip: '\\dots ' },
    ] },
    { key: 'greek', items: [
      'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'nu',
      'pi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega',
      'Gamma', 'Delta', 'Theta', 'Lambda', 'Pi', 'Sigma', 'Phi', 'Omega',
    ].map((n) => ({ label: GREEK[n], snip: `\\${n} ` })) },
  ];

  // Reset to the formula being edited each time the dialog opens, then focus the source.
  $effect(() => {
    if (open) {
      latex = initialLatex;
      display = initialDisplay;
      queueMicrotask(() => { input?.focus(); input?.select(); });
    }
  });

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  const preview = $derived(formulaMathml(latex || '\\square ', display));

  function insert(snip: string) {
    const el = input;
    const at = el ? el.selectionStart : latex.length;
    const to = el ? el.selectionEnd : latex.length;
    const selected = latex.slice(at, to);
    const body = snip.replace('@', selected);
    // The caret goes where the placeholder was, so the next keystroke fills the slot.
    const caret = at + (snip.indexOf('@') >= 0 ? snip.indexOf('@') + selected.length : body.length);
    latex = latex.slice(0, at) + body + latex.slice(to);
    queueMicrotask(() => { el?.focus(); el?.setSelectionRange(caret, caret); });
  }

  function apply() {
    const src = latex.trim();
    if (!src) return;
    onApply(src, display);
    open = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); }
  }
</script>

<dialog
  class="formula-dialog"
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => { if (e.target === dialogEl) open = false; }}
  aria-label={t().formula.title}
>
  <div class="card">
    <header>
      <h2>{t().formula.title}</h2>
      <button class="close" onclick={() => (open = false)} aria-label={t().common.close}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </header>

    <div class="formula-preview">{@html preview}</div>

    <div class="palette">
      {#each GROUPS as group (group.key)}
        <div class="palette-group">
          <span class="palette-label">{t().formula.groups[group.key]}</span>
          <div class="palette-items">
            {#each group.items as item (item.snip)}
              <button type="button" title={item.snip.trim()} onclick={() => insert(item.snip)}>{item.label}</button>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <label class="source">
      <span>{t().formula.source}</span>
      <textarea
        bind:this={input}
        bind:value={latex}
        rows="3"
        spellcheck="false"
        autocomplete="off"
        placeholder={'\\frac{a+b}{2}'}
        onkeydown={onKeydown}
      ></textarea>
    </label>

    <footer>
      <label class="display-toggle">
        <input type="checkbox" bind:checked={display} />
        <span>{t().formula.displayFormula}</span>
      </label>
      <span class="spacer"></span>
      <button onclick={() => (open = false)}>{t().common.cancel}</button>
      <button class="primary" onclick={apply} disabled={!latex.trim()}>{t().common.apply}</button>
    </footer>
  </div>
</dialog>

<style>
  .formula-dialog {
    margin: auto;
    padding: 0;
    border: none;
    background: transparent;
    max-width: none;
  }
  .formula-dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
  }

  .card {
    width: min(40rem, 94vw);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0 1rem 1rem;
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--island-radius);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    font-family: var(--font-sans);
  }

  header {
    display: flex;
    align-items: center;
    padding: 0.75rem 0 0;
  }
  h2 { flex: 1; font-size: 0.95rem; font-weight: 600; }
  .close {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0.2rem;
  }

  .formula-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 5rem;
    padding: 0.5rem;
    font-size: 1.4rem;
    background: var(--color-page-bg, #fff);
    color: var(--color-page-text, #000);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    overflow: auto;
  }
  /* On <math> itself: the UA sheet's `math { font-family: math }` beats inheritance. */
  .formula-preview :global(math) {
    font-family: 'STIX Two Math', math, serif;
  }

  .palette {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 13rem;
    overflow-y: auto;
  }
  .palette-group { display: flex; align-items: baseline; gap: 0.5rem; }
  .palette-label {
    flex: 0 0 5rem;
    font-size: 0.7rem;
    color: var(--color-text-muted, #888);
  }
  .palette-items { display: flex; flex-wrap: wrap; gap: 0.2rem; }
  .palette-items button {
    min-width: 1.9rem;
    height: 1.7rem;
    padding: 0 0.3rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-family: 'STIX Two Math', math, serif;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .palette-items button:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }

  .source { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; }
  textarea {
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.85rem;
    resize: vertical;
  }

  footer { display: flex; align-items: center; gap: 0.4rem; }
  .spacer { flex: 1; }
  .display-toggle { display: flex; align-items: center; gap: 0.35rem; font-size: 0.78rem; }
  footer button {
    height: 1.9rem;
    padding: 0 0.8rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    cursor: pointer;
  }
  footer button:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }
  footer button.primary {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: #fff;
  }
  footer button:disabled { opacity: 0.5; cursor: default; }
</style>
