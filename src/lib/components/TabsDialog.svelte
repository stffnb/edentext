<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { activeTabStops, LEADER_CHARS, type TabAlign, type TabStop } from '../editor/extensions/tabStops';
  import { DEFAULT_TAB_INTERVAL_CM } from '../storage/tabInterval';
  import { t } from '../i18n/i18n.svelte';

  // Word's Tabs dialog. The ruler can already place and drag a stop; only here can
  // one be typed exactly, and only here can it be given a leader.
  let { open = $bindable(false), editor, tick, tabIntervalCm = $bindable(DEFAULT_TAB_INTERVAL_CM) }: {
    open?: boolean;
    editor: Editor | null;
    tick: number;
    tabIntervalCm?: number;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let newPos = $state('');
  let newAlign = $state<TabAlign>('left');
  let newLeader = $state<string>('');

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  let stops = $derived.by<TabStop[]>(() => {
    if (tick < 0 || !editor) return [];
    return activeTabStops(editor.state)?.stops ?? [];
  });

  const ALIGNS: TabAlign[] = ['left', 'center', 'right', 'decimal'];

  function write(next: TabStop[]) {
    editor?.chain().focus().setTabStops([...next].sort((a, b) => a.pos - b.pos)).run();
  }

  function add() {
    const pos = parseFloat(newPos.replace(',', '.'));
    if (isNaN(pos) || pos <= 0) return;
    write([...stops.filter((s) => s.pos !== pos), { pos, align: newAlign, leader: newLeader || null }]);
    newPos = '';
  }

  const fmt = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', ',');
</script>

<dialog bind:this={dialogEl} onclose={() => (open = false)} onclick={(e) => e.target === dialogEl && (open = false)} aria-label={t().tabsDialog.title}>
  <div class="body">
    <h2>{t().tabsDialog.title}</h2>

    <div class="list" role="list">
      {#if stops.length === 0}
        <p class="empty">{t().tabsDialog.none}</p>
      {/if}
      {#each stops as s (s.pos)}
        <div class="stop" role="listitem">
          <span class="pos">{fmt(s.pos)} cm</span>
          <select value={s.align} onchange={(e) => write(stops.map((x) => (x.pos === s.pos ? { ...x, align: (e.currentTarget as HTMLSelectElement).value as TabAlign } : x)))}>
            {#each ALIGNS as a}<option value={a}>{t().ruler.tabType[a]}</option>{/each}
          </select>
          <select value={s.leader ?? ''} onchange={(e) => write(stops.map((x) => (x.pos === s.pos ? { ...x, leader: (e.currentTarget as HTMLSelectElement).value || null } : x)))}>
            <option value="">{t().tabsDialog.noLeader}</option>
            {#each LEADER_CHARS as c}<option value={c}>{c.repeat(6)}</option>{/each}
          </select>
          <button class="remove" onclick={() => write(stops.filter((x) => x.pos !== s.pos))} title={t().common.remove} aria-label={t().common.remove}>×</button>
        </div>
      {/each}
    </div>

    <div class="stop new">
      <input type="text" inputmode="decimal" bind:value={newPos} placeholder={t().tabsDialog.position} onkeydown={(e) => e.key === 'Enter' && add()} />
      <select bind:value={newAlign}>{#each ALIGNS as a}<option value={a}>{t().ruler.tabType[a]}</option>{/each}</select>
      <select bind:value={newLeader}>
        <option value="">{t().tabsDialog.noLeader}</option>
        {#each LEADER_CHARS as c}<option value={c}>{c.repeat(6)}</option>{/each}
      </select>
      <button class="add" onclick={add}>{t().common.insert}</button>
    </div>

    <label class="row">
      <span>{t().tabsDialog.defaultInterval}</span>
      <input
        type="text"
        inputmode="decimal"
        value={fmt(tabIntervalCm)}
        onchange={(e) => {
          const v = parseFloat((e.currentTarget as HTMLInputElement).value.replace(',', '.'));
          if (!isNaN(v) && v >= 0.05 && v <= 10) tabIntervalCm = v;
        }}
      />
      <em>cm</em>
    </label>

    <div class="actions">
      <span class="spacer"></span>
      <button class="primary" onclick={() => (open = false)}>{t().common.close}</button>
    </div>
  </div>
</dialog>

<style>
  dialog {
    /* The global reset zeroes every margin, which also takes the auto centring a
       modal <dialog> gets by default. */
    margin: auto;
    border: none;
    border-radius: 8px;
    padding: 0;
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  dialog::backdrop { background: rgba(0, 0, 0, 0.35); }

  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 440px;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; }

  .list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
  .empty { color: var(--color-text-muted); }

  .stop { display: flex; align-items: center; gap: 8px; }
  .stop .pos { width: 72px; text-align: right; }

  .new { border-top: 1px solid var(--color-border); padding-top: 10px; }

  .row { display: flex; align-items: center; gap: 8px; }
  .row > span { flex: 1; color: var(--color-text-muted); }
  .row em { font-style: normal; color: var(--color-text-muted); }

  input, select, .add, .remove {
    height: 26px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 0 6px;
    font: inherit;
  }

  input { width: 72px; text-align: right; }
  select { flex: 1; min-width: 0; }
  .add, .remove { cursor: pointer; }
  .remove { width: 26px; padding: 0; color: var(--color-text-muted); }
  .add:hover, .remove:hover { background: var(--color-btn-hover); }

  .actions { display: flex; align-items: center; gap: 8px; }
  .spacer { flex: 1; }

  .actions button {
    border: 1px solid var(--color-primary);
    border-radius: var(--radius);
    background: var(--color-primary);
    color: #fff;
    padding: 5px 14px;
    font: inherit;
    cursor: pointer;
  }
</style>
