<script module lang="ts">
  export type Section = 'general' | 'editing' | 'view' | 'review' | 'ai' | 'privacy';
</script>

<script lang="ts">
  import { loadRetention, saveRetention, volatile, type Retention } from '../storage/docScope';
  import { embedded } from '../embed/mode';
  import { wordCompletion, setWordCompletion } from '../storage/wordCompletion.svelte';
  import { grammarEnabled, setGrammarEnabled } from '../spell/grammar.svelte';
  import { autoLanguage, setAutoLanguage } from '../spell/detect.svelte';
  import { numberRecognition, setNumberRecognition } from '../storage/tableOptions.svelte';
  import {
    showComments, setShowComments, showChanges, setShowChanges,
    commentPlace, setCommentPlace, changePlace, setChangePlace, MARKUP_PLACES, type MarkupPlace,
    showResolved, setShowResolved,
  } from '../storage/markup.svelte';
  import { ACCENTS, loadAccent, saveAccent, applyAccent, isCustomAccent, parseAccentHex, type Accent, type ChromeMode, type ThemeMode } from '../storage/theme';
  import { LOCALES, LOCALE_LABELS, isLocale } from '../i18n/config';
  import { t, locale, setLocale } from '../i18n/i18n.svelte';
  import { DATE_FORMATS, dateFormat, formatMoment, setDateFormat, type DateFormat } from '../storage/dateFormat.svelte';
  import { localeTag } from '../utils/dateTime';
  import { userName, setUserName } from '../storage/userName.svelte';
  import Icon from './ribbon/Icon.svelte';
  import Toggle from './Toggle.svelte';
  import { LANGUAGES, NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';
  import { aiSettings, setAi, aiConfig, aiHostOff, AI_PRESETS, presetOf, DEFAULT_CONTEXT_TOKENS, type CustomCommand } from '../storage/ai.svelte';
  import { COMMANDS, commandName } from '../ai/commands';
  import { streamChat, aiErrorText } from '../ai/client';

  // Spaces stay while typing, or the one between two names would go; the store trims.
  let nameField = $state(userName());

  // App-wide settings, one section per side-bar entry. Each control writes through the
  // store that already owns the setting, so the ribbon and the dialogs stay in step.
  let {
    open = $bindable(false),
    section = $bindable('general'),
    themeMode,
    onSelectTheme,
    showRuler = $bindable(),
    showFormattingMarks = $bindable(),
    showFieldShading = $bindable(),
    showPageLabels = $bindable(),
    chromeMode = $bindable(),
    recentCount,
    onClearRecent,
    onAutoCorrect,
    documentLanguage,
    onLanguage,
  }: {
    open?: boolean;
    /** The side-bar entry shown; the AI pane opens the dialog on 'ai'. */
    section?: Section;
    themeMode: ThemeMode;
    onSelectTheme: (mode: ThemeMode) => void;
    showRuler: boolean;
    showFormattingMarks: boolean;
    showFieldShading: boolean;
    showPageLabels: boolean;
    chromeMode: ChromeMode;
    recentCount: number;
    onClearRecent: () => void;
    onAutoCorrect: () => void;
    documentLanguage: DocumentLanguage;
    onLanguage: (code: DocumentLanguage) => void;
  } = $props();

  // Each choice named by its region and shown on a day past the 12th, so the order of day
  // and month reads at a glance.
  const SAMPLE_MOMENT = new Date(2026, 11, 31, 14, 30);
  function dateFormatLabel(f: DateFormat): string {
    const sample = formatMoment(SAMPLE_MOMENT, f);
    if (f === 'auto') return `${t().settings.dateFormatAuto} – ${sample}`;
    if (f === 'iso') return `ISO 8601 – ${sample}`;
    let name: string = f;
    try { name = new Intl.DisplayNames([localeTag(locale())], { type: 'language' }).of(f) ?? f; } catch { /* the tag itself */ }
    return `${name} – ${sample}`;
  }

  const SECTIONS: { id: Section; icon: 'settings' | 'autoCorrect' | 'ruler' | 'comment' | 'sparkle' | 'lock' }[] = [
    { id: 'general', icon: 'settings' },
    { id: 'editing', icon: 'autoCorrect' },
    { id: 'view', icon: 'ruler' },
    { id: 'review', icon: 'comment' },
    { id: 'ai', icon: 'sparkle' },
    { id: 'privacy', icon: 'lock' },
  ];
  // Embedded, the host keeps the document, so the browser-storage choices say nothing true;
  // a host that switched the assistant off leaves nothing to set up.
  const shown = (id: Section) => !(id === 'privacy' && embedded) && !(id === 'ai' && aiHostOff());
  const THEMES: ThemeMode[] = ['light', 'dark', 'allBlack', 'auto'];
  const LEVELS: Retention[] = ['keep', 'closed', 'none'];

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let retention = $state<Retention>(loadRetention());
  let accent = $state<Accent>(loadAccent());

  function pickAccent(a: Accent) {
    accent = a;
    saveAccent(a);
    applyAccent(a);
  }
  // The colour input starts from the accent on screen, so a preset can be fine-tuned.
  const shownAccent = () => parseAccentHex(getComputedStyle(document.documentElement).getPropertyValue('--brand-slate')) ?? '#4c6c8a';
  function typeAccentHex(e: Event & { currentTarget: HTMLInputElement }) {
    const hex = parseAccentHex(e.currentTarget.value);
    if (hex) pickAccent(hex);
  }
  let wc = $derived(wordCompletion());
  let ai = $derived(aiSettings());

  // One short request, so a wrong address, key or a CORS refusal shows here and not
  // in the middle of a chat.
  let aiTest = $state<{ busy: boolean; ok: boolean; text: string } | null>(null);
  async function testAi() {
    const cfg = aiConfig();
    if (!cfg) { aiTest = { busy: false, ok: false, text: t().ai.notConfigured }; return; }
    aiTest = { busy: true, ok: false, text: t().ai.testing };
    try {
      await streamChat(cfg, { system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'OK?' }] }, () => {});
      aiTest = { busy: false, ok: true, text: t().ai.testOk };
    } catch (e) {
      aiTest = { busy: false, ok: false, text: aiErrorText(e, t().ai.errors, cfg.endpoint) };
    }
  }

  const editCommand = (i: number, patch: Partial<CustomCommand>) => setAi({ commands: ai.commands.map((c, k) => (k === i ? { ...c, ...patch } : c)) });

  function pickPreset(id: string) {
    const p = AI_PRESETS.find((x) => x.id === id);
    if (p) setAi({ provider: p.provider, endpoint: p.endpoint });
    else setAi({ provider: 'openai' });
    aiTest = null;
  }

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    // An embedding host may have set the accent since: the dialog stays mounted.
    if (open && !el.open) { retention = loadRetention(); accent = loadAccent(); el.showModal(); }
    else if (!open && el.open) el.close();
  });
</script>

<!-- Where one kind's cards go, beside the page or in the pane. -->
{#snippet placeRow(name: string, at: MarkupPlace, setAt: (p: MarkupPlace) => void)}
  <div class="row stack">
    <div class="info"><div class="name">{name}</div><div class="desc">{t().settings.placeHint}</div></div>
    <div class="segmented two" role="radiogroup" aria-label={name}>
      {#each MARKUP_PLACES as p (p)}
        <button role="radio" aria-checked={at === p} class:on={at === p} onclick={() => setAt(p)}>
          {p === 'balloons' ? t().revisions.placeBalloons : t().revisions.placePane}
        </button>
      {/each}
    </div>
  </div>
{/snippet}

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().settings.title}
>
  <!-- On the dialog, not in the scrolling pane, so it stays in view. -->
  <button class="close" onclick={() => (open = false)} aria-label={t().common.close} title={t().common.close}>
    <Icon name="close" size={16} />
  </button>
  <div class="shell">
    <nav aria-label={t().settings.title}>
      <h2>{t().settings.title}</h2>
      {#each SECTIONS.filter((s) => shown(s.id)) as s (s.id)}
        <button class="nav-item" class:active={section === s.id} aria-current={section === s.id} onclick={() => (section = s.id)}>
          <Icon name={s.icon} size={16} />
          <span>{t().settings.sections[s.id]}</span>
        </button>
      {/each}
    </nav>

    <div class="pane">
      <h3>{t().settings.sections[section]}</h3>
      <div class="scroll">

        {#if section === 'general'}
          <div class="row">
            <div class="info"><div class="name">{t().appearance.language}</div><div class="desc">{t().settings.languageHint}</div></div>
            <select value={locale()} onchange={(e) => isLocale(e.currentTarget.value) && setLocale(e.currentTarget.value)}>
              {#each LOCALES as l (l)}<option value={l}>{LOCALE_LABELS[l]}</option>{/each}
            </select>
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().settings.dateFormat}</div><div class="desc">{t().settings.dateFormatHint}</div></div>
            <select value={dateFormat()} onchange={(e) => setDateFormat(e.currentTarget.value as DateFormat)}>
              {#each DATE_FORMATS as f (f)}<option value={f}>{dateFormatLabel(f)}</option>{/each}
            </select>
          </div>
          <div class="row stack">
            <div class="info"><div class="name">{t().appearance.title}</div><div class="desc">{t().settings.themeHint}</div></div>
            <div class="segmented" role="radiogroup" aria-label={t().appearance.title}>
              {#each THEMES as m (m)}
                <button role="radio" aria-checked={themeMode === m} class:on={themeMode === m} onclick={() => onSelectTheme(m)}>
                  {#if m === 'dark'}<Icon name="themeDark" size={14} />{:else if m === 'light'}<Icon name="themeLight" size={14} />{:else}<span class="swatch {m}" aria-hidden="true"></span>{/if}{t().appearance[m]}
                </button>
              {/each}
            </div>
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().settings.accent}</div><div class="desc">{t().settings.accentHint}</div></div>
            <div class="accents" role="radiogroup" aria-label={t().settings.accent}>
              {#each ACCENTS as a (a)}
                <button role="radio" aria-checked={accent === a} class:on={accent === a} data-accent={a} title={t().settings.accents[a]} aria-label={t().settings.accents[a]} onclick={() => pickAccent(a)}></button>
              {/each}
              <input type="color" class="custom" class:on={isCustomAccent(accent)} value={isCustomAccent(accent) ? accent : shownAccent()} title={t().settings.accents.custom} aria-label={t().settings.accents.custom} oninput={(e) => pickAccent(parseAccentHex(e.currentTarget.value) ?? accent)} />
              {#if isCustomAccent(accent)}
                <input class="field accent-hex" type="text" maxlength="7" spellcheck="false" value={accent} aria-label={t().settings.accentHex} oninput={typeAccentHex} onblur={(e) => (e.currentTarget.value = accent)} />
              {/if}
            </div>
          </div>
          <!-- The modern chrome is still a beta, so only a development build offers the choice. -->
          {#if import.meta.env.DEV}
            <div class="row stack">
              <div class="info"><div class="name">{t().ribbon.chrome.title}</div></div>
              <div class="segmented two" role="radiogroup" aria-label={t().ribbon.chrome.title}>
                {#each (['ribbon', 'modern'] as const) as c (c)}
                  <button role="radio" aria-checked={chromeMode === c} class:on={chromeMode === c} onclick={() => (chromeMode = c)}>
                    <span class="chrome-opt">{t().ribbon.chrome[c]}<small>{t().ribbon.chrome[`${c}Hint`]}</small></span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}

        {:else if section === 'editing'}
          <div class="row">
            <div class="info">
              <div class="name">{t().wordCompletion.enabled}</div>
              <div class="desc">{volatile ? t().wordCompletion.offUnstored : t().wordCompletion.hint}</div>
            </div>
            <Toggle label={t().wordCompletion.enabled} checked={wc.enabled && !volatile} disabled={volatile}
              onchange={(on) => setWordCompletion({ ...wc, enabled: on })} />
          </div>
          <div class="row sub" class:dim={!wc.enabled || volatile}>
            <div class="info"><div class="name">{t().wordCompletion.appendSpace}</div><div class="desc">{t().wordCompletion.appendSpaceHint}</div></div>
            <Toggle label={t().wordCompletion.appendSpace} checked={wc.appendSpace} disabled={!wc.enabled || volatile}
              onchange={(on) => setWordCompletion({ ...wc, appendSpace: on })} />
          </div>
          <div class="row sub" class:dim={!wc.enabled || volatile}>
            <div class="info"><div class="name">{t().wordCompletion.minLength}</div><div class="desc">{t().wordCompletion.minLengthHint}</div></div>
            <input class="num" type="number" min="5" max="20" value={wc.minLength} disabled={!wc.enabled || volatile}
              onchange={(e) => setWordCompletion({ ...wc, minLength: Math.min(20, Math.max(5, Number(e.currentTarget.value) || wc.minLength)) })} />
          </div>
          <div class="row sub">
            <div class="info"><div class="name">{t().wordCompletion.clear}</div><div class="desc">{t().wordCompletion.collected(wc.words.length)}</div></div>
            <button class="btn" disabled={!wc.words.length} onclick={() => setWordCompletion({ ...wc, words: [] })}>{t().browserDocs.delete}</button>
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().spellPicker.label}</div><div class="desc">{t().settings.spellLanguageHint}</div></div>
            <!-- Sets only the document's default; paragraphs and runs with their own language keep it. -->
            <select value={documentLanguage} onchange={(e) => onLanguage(e.currentTarget.value)}>
              {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.noDict ? `${l.label} ${t().spellPicker.noDictionary}` : l.label}</option>{/each}
              <option value={NO_LANGUAGE}>{t().spellPicker.noSpellCheck}</option>
            </select>
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().spellPicker.autoDetect}</div><div class="desc">{t().spellPicker.autoDetectHint}</div></div>
            <Toggle label={t().spellPicker.autoDetect} checked={autoLanguage()} onchange={setAutoLanguage} />
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().settings.grammar}</div><div class="desc">{t().grammar.hint} {t().grammar.unavailable}</div></div>
            <Toggle label={t().settings.grammar} checked={grammarEnabled()} onchange={setGrammarEnabled} />
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().table.numberRecognition}</div><div class="desc">{t().table.numberRecognitionHint}</div></div>
            <Toggle label={t().table.numberRecognition} checked={numberRecognition()} onchange={setNumberRecognition} />
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().ribbon.autoCorrect}</div><div class="desc">{t().settings.autoCorrectHint}</div></div>
            <button class="btn" onclick={() => { open = false; onAutoCorrect(); }}>{t().settings.open}</button>
          </div>

        {:else if section === 'view'}
          <div class="row">
            <div class="info"><div class="name">{t().ruler.show}</div><div class="desc">{t().settings.rulerHint}</div></div>
            <Toggle label={t().ruler.show} checked={showRuler} onchange={(on) => (showRuler = on)} />
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().toolbarExpanded.formattingMarks}</div><div class="desc">{t().settings.formattingMarksHint}</div></div>
            <Toggle label={t().toolbarExpanded.formattingMarks} checked={showFormattingMarks} onchange={(on) => (showFormattingMarks = on)} />
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().view.fieldShadings}</div><div class="desc">{t().view.fieldShadingsTitle}</div></div>
            <Toggle label={t().view.fieldShadings} checked={showFieldShading} onchange={(on) => (showFieldShading = on)} />
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().settings.pageLabels}</div><div class="desc">{t().settings.pageLabelsHint}</div></div>
            <Toggle label={t().settings.pageLabels} checked={showPageLabels} onchange={(on) => (showPageLabels = on)} />
          </div>

        {:else if section === 'review'}
          <div class="row">
            <div class="info"><div class="name">{t().settings.userName}</div><div class="desc">{t().settings.userNameHint}</div></div>
            <input class="field" type="text" autocomplete="name" spellcheck="false" aria-label={t().settings.userName} bind:value={nameField} oninput={() => setUserName(nameField)} />
          </div>
          <!-- The Review tab's show buttons and their carets, as settings; the same store. -->
          <div class="row">
            <div class="info"><div class="name">{t().comments.showPane}</div><div class="desc">{t().settings.commentsHint}</div></div>
            <Toggle label={t().comments.showPane} checked={showComments()} onchange={setShowComments} />
          </div>
          {@render placeRow(t().settings.commentPlace, commentPlace(), setCommentPlace)}
          <div class="row">
            <div class="info"><div class="name">{t().comments.showResolved}</div><div class="desc">{t().settings.resolvedHint}</div></div>
            <Toggle label={t().comments.showResolved} checked={showResolved()} onchange={setShowResolved} />
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().revisions.showPane}</div><div class="desc">{t().settings.changesHint}</div></div>
            <Toggle label={t().revisions.showPane} checked={showChanges()} onchange={setShowChanges} />
          </div>
          {@render placeRow(t().settings.changePlace, changePlace(), setChangePlace)}

        {:else if section === 'ai' && shown('ai')}
          <div class="row">
            <div class="info"><div class="name">{t().ai.enable}</div><div class="desc">{t().ai.enableHint}</div></div>
            <Toggle label={t().ai.enable} checked={ai.enabled} onchange={(on) => setAi({ enabled: on })} />
          </div>
          <div class="row sub" class:dim={!ai.enabled}>
            <div class="info"><div class="name">{t().ai.side}</div><div class="desc">{t().ai.sideHint}</div></div>
            <select value={ai.side} disabled={!ai.enabled} onchange={(e) => setAi({ side: e.currentTarget.value === 'left' ? 'left' : 'right' })}>
              <option value="right">{t().ai.sideRight}</option>
              <option value="left">{t().ai.sideLeft}</option>
            </select>
          </div>
          <div class="row sub" class:dim={!ai.enabled}>
            <div class="info"><div class="name">{t().ai.provider}</div><div class="desc">{t().ai.providerHint}</div></div>
            <select value={presetOf(ai)} disabled={!ai.enabled} onchange={(e) => pickPreset(e.currentTarget.value)}>
              {#each AI_PRESETS as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
              <option value="custom">{t().ai.custom}</option>
            </select>
          </div>
          <div class="row sub" class:dim={!ai.enabled}>
            <div class="info"><div class="name">{t().ai.endpoint}</div><div class="desc">{t().ai.endpointHint}</div></div>
            <input class="field" type="url" spellcheck="false" value={ai.endpoint} disabled={!ai.enabled}
              placeholder="https://…/v1" onchange={(e) => { setAi({ endpoint: e.currentTarget.value.trim() }); aiTest = null; }} />
          </div>
          <div class="row sub" class:dim={!ai.enabled}>
            <div class="info"><div class="name">{t().ai.model}</div><div class="desc">{t().ai.modelHint}</div></div>
            <input class="field" type="text" spellcheck="false" value={ai.model} disabled={!ai.enabled}
              onchange={(e) => { setAi({ model: e.currentTarget.value.trim() }); aiTest = null; }} />
          </div>
          <div class="row sub" class:dim={!ai.enabled}>
            <div class="info"><div class="name">{t().ai.contextSize}</div><div class="desc">{t().ai.contextSizeHint}</div></div>
            <input class="field short" type="number" min="2048" step="1024" value={ai.contextTokens} disabled={!ai.enabled}
              onchange={(e) => { const n = Math.round(Number(e.currentTarget.value)); setAi({ contextTokens: n >= 2048 ? n : DEFAULT_CONTEXT_TOKENS }); }} />
          </div>
          <div class="row sub" class:dim={!ai.enabled}>
            <div class="info"><div class="name">{t().ai.apiKey}</div><div class="desc">{t().ai.apiKeyHint}</div></div>
            <input class="field" type="password" autocomplete="off" spellcheck="false" value={ai.apiKey} disabled={!ai.enabled}
              onchange={(e) => { setAi({ apiKey: e.currentTarget.value.trim() }); aiTest = null; }} />
          </div>
          <div class="row sub" class:dim={!ai.enabled}>
            <div class="info">
              <div class="desc" class:ok={aiTest?.ok} role="status">{aiTest?.text ?? ''}</div>
            </div>
            <button class="btn" disabled={!ai.enabled || aiTest?.busy} onclick={testAi}>{t().ai.test}</button>
          </div>
          <div class="row stack sub" class:dim={!ai.enabled}>
            <div class="info"><div class="name">{t().ai.customCommands}</div><div class="desc">{t().ai.customCommandsHint}</div></div>
            {#each ai.commands as c, i (i)}
              {@const name = commandName(c.name)}
              <div class="command">
                <input class="field" type="text" spellcheck="false" placeholder={t().ai.commandName} aria-label={t().ai.commandName}
                  value={c.name ? `/${name}` : ''} disabled={!ai.enabled} onchange={(e) => editCommand(i, { name: commandName(e.currentTarget.value) })} />
                <textarea class="field" rows="2" placeholder={t().ai.commandPrompt} aria-label={t().ai.commandPrompt}
                  value={c.prompt} disabled={!ai.enabled} onchange={(e) => editCommand(i, { prompt: e.currentTarget.value })}></textarea>
                <button class="btn icon" disabled={!ai.enabled} onclick={() => setAi({ commands: ai.commands.filter((_, k) => k !== i) })}
                  title={t().ai.removeCommand} aria-label={t().ai.removeCommand}><Icon name="close" size={12} /></button>
                {#if COMMANDS.some((b) => b.name === name)}<div class="desc taken">{t().ai.commandTaken(name)}</div>{/if}
              </div>
            {/each}
            <div><button class="btn" disabled={!ai.enabled} onclick={() => setAi({ commands: [...ai.commands, { name: '', prompt: '' }] })}>{t().ai.addCommand}</button></div>
          </div>

        {:else if shown('privacy')}
          <div class="row stack">
            <div class="info"><div class="name">{t().settings.documents}</div><div class="desc">{t().settings.autosaveHint}</div></div>
            <div class="choices" role="radiogroup" aria-label={t().settings.documents}>
              {#each LEVELS as level (level)}
                <label class="choice" class:on={retention === level}>
                  <input type="radio" name="retention" checked={retention === level} onchange={() => saveRetention((retention = level))} />
                  <span><span class="name">{t().settings.retention[level]}</span><em>{t().settings.retentionHint[level]}</em></span>
                </label>
              {/each}
            </div>
            <div class="desc">{t().settings.protectedHint}</div>
            {#if (retention === 'none') !== volatile}<div class="notice">{t().settings.restartNeeded}</div>{/if}
          </div>
          <div class="row">
            <div class="info"><div class="name">{t().app.recentFiles}</div><div class="desc">{t().settings.recentFilesHint}</div></div>
            <button class="btn" disabled={!recentCount} onclick={onClearRecent}>{t().app.clearRecentFiles}</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
</dialog>

<style>
  dialog {
    overflow: hidden;
    font-size: 0.85rem;
  }

  .shell {
    display: flex;
    width: min(760px, calc(100vw - 32px));
    height: min(560px, calc(100vh - 64px));
  }

  nav {
    flex: none;
    width: 190px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 18px 10px;
    background: var(--w-hover);
    border-right: 1px solid var(--w-border);
  }
  h2 { font-size: 1rem; padding: 0 10px 12px; }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--w-text-dim);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .nav-item:hover { background: var(--w-pressed); color: var(--color-text); }
  .nav-item.active { background: var(--w-accent-soft); color: var(--w-accent); font-weight: 600; }

  /* Only the content scrolls; the title stays put with the close button, overscroll too. */
  .pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 28px 24px;
  }
  h3 {
    margin: 0 28px;
    font-size: 1.15rem;
    padding: 18px 40px 10px 0;
    border-bottom: 1px solid var(--w-border);
  }
  .close {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--w-text-dim);
    cursor: pointer;
  }
  .close:hover { background: var(--w-hover); color: var(--color-text); }

  .row {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 14px 0;
    border-bottom: 1px solid var(--w-border);
  }
  .row:last-child { border-bottom: 0; }
  .row.stack { flex-direction: column; align-items: stretch; gap: 10px; }
  .row.sub { padding-left: 16px; }
  .row.dim .name { color: var(--w-text-tertiary); }
  .info { flex: 1; min-width: 0; }
  .name { font-weight: 500; }
  .desc, em { color: var(--color-text-muted); font-size: 0.78rem; line-height: 1.4; margin-top: 2px; }
  em { display: block; font-style: normal; }
  .notice {
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--w-accent-soft);
    color: var(--w-accent);
    font-size: 0.78rem;
    font-weight: 600;
  }

  .btn, select, .num, .field {
    flex: none;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-surface);
    color: var(--color-text);
    padding: 5px 12px;
    font: inherit;
  }
  .btn { cursor: pointer; }
  .btn:hover:not(:disabled) { background: var(--color-btn-hover); }
  .btn:disabled, .num:disabled { opacity: 0.45; cursor: default; }
  select { max-width: 200px; cursor: pointer; }
  .num { width: 64px; padding: 5px 8px; }
  .field { width: 230px; padding: 5px 8px; }
  .field.short { width: 100px; }
  .field:disabled, select:disabled { opacity: 0.45; cursor: default; }
  .desc.ok { color: var(--w-accent); font-weight: 600; }
  .command { display: grid; grid-template-columns: 150px 1fr auto; gap: 6px; align-items: start; }
  .command .field { width: auto; min-width: 0; font: inherit; }
  .command textarea { resize: vertical; }
  .command .taken { grid-column: 1 / -1; color: #e5534b; }

  .segmented {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    padding: 3px;
    border-radius: 8px;
    background: var(--w-hover);
  }
  .segmented button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--w-text-dim);
    font: inherit;
    cursor: pointer;
  }
  .segmented button:hover { color: var(--color-text); }
  .segmented button.on { background: var(--color-surface); color: var(--color-text); box-shadow: 0 1px 3px rgb(0 0 0 / 15%); }
  .segmented.two { grid-template-columns: repeat(2, 1fr); }
  .chrome-opt { display: flex; flex-direction: column; align-items: center; }
  .chrome-opt small { font-size: 0.72rem; color: var(--color-text-muted); }
  .swatch { width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--w-border-strong); }
  .swatch.allBlack { background: #000; }
  .swatch.auto { background: linear-gradient(135deg, #fff 50%, #2b2f36 50%); }
  .accents { display: flex; flex-wrap: wrap; gap: 6px; }
  .accents button { width: 22px; height: 22px; padding: 0; border: 2px solid var(--color-surface); border-radius: 50%; outline: 1px solid var(--w-border-strong); background: var(--brand-slate); cursor: pointer; }
  .accents { align-items: center; }
  .accents button.on, .accents .custom.on { outline: 2px solid var(--color-text); }
  .accents .custom { appearance: none; width: 22px; height: 22px; padding: 0; border: 2px solid var(--color-surface); border-radius: 50%; outline: 1px solid var(--w-border-strong); background: conic-gradient(#e0483e, #e0b43e, #4caf50, #3ea6e0, #6a5ae0, #e03ea6, #e0483e); cursor: pointer; }
  .accents .custom::-webkit-color-swatch-wrapper { padding: 0; }
  .accents .custom::-webkit-color-swatch { border: none; border-radius: 50%; }
  .accents .custom::-moz-color-swatch { border: none; border-radius: 50%; }
  .accents .custom:not(.on)::-webkit-color-swatch { opacity: 0; }
  .accents .custom:not(.on)::-moz-color-swatch { opacity: 0; }
  .field.accent-hex { width: 6.5em; font-family: ui-monospace, monospace; }

  .choices { display: flex; flex-direction: column; gap: 6px; }
  .choice {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 9px 12px;
    border: 1px solid var(--w-border);
    border-radius: 8px;
    cursor: pointer;
  }
  .choice:hover { background: var(--w-hover); }
  .choice.on { border-color: var(--w-accent-fill); background: var(--w-accent-soft); }
  .choice input { accent-color: var(--w-accent-fill); }

  /* A phone: the side bar becomes a row of tabs above the pane. */
  @media (max-width: 600px) {
    .shell { flex-direction: column; }
    nav { width: auto; flex-direction: row; overflow-x: auto; padding: 10px; margin-right: 48px; border-right: 0; border-bottom: 1px solid var(--w-border); }
    h2 { display: none; }
    .nav-item { flex: none; }
    .scroll { padding: 0 16px 20px; }
    h3 { margin: 0 16px; padding-top: 14px; }
    .segmented { grid-template-columns: repeat(2, 1fr); }
  }
</style>
