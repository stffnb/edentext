<script lang="ts">
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import { anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import { MIN_ZOOM, MAX_ZOOM } from '../../../utils/zoom';
  import { MAX_PAGE_COLUMNS } from '../../../storage/theme';
  import { t } from '../../../i18n/i18n.svelte';
  import { shortcutHint } from '../../../editor/shortcuts';
  import { collabView } from '../../../collab/appSession.svelte';
  import { chatOpen, chatUnread, setChatOpen } from '../../../collab/chat.svelte';

  let {
    showRuler = $bindable(true),
    splitView = $bindable(false),
    pageColumns = $bindable(1),
    showFormattingMarks = $bindable(false),
    showFieldShading = $bindable(true),
    zoom = 100,
    onZoom,
    onDebugDump,
    navigatorOpen = false,
    onToggleNavigator,
  }: {
    showRuler?: boolean;
    splitView?: boolean;
    pageColumns?: number;
    showFormattingMarks?: boolean;
    showFieldShading?: boolean;
    zoom?: number;
    onZoom?: (value: number) => void;
    onDebugDump?: () => void;
    navigatorOpen?: boolean;
    onToggleNavigator?: () => void;
  } = $props();

  const COLUMN_CHOICES = Array.from({ length: MAX_PAGE_COLUMNS }, (_, i) => i + 1);

  // The panes are one layout, in one direction: turning either on ends the other.
  function setColumns(n: number) {
    pageColumns = n;
    if (n > 1) splitView = false;
  }

  function toggleSplit() {
    splitView = !splitView;
    if (splitView) pageColumns = 1;
  }
</script>

<RibbonGroup label={t().ribbon.groups.show} reads>
  <RibbonButton variant="big" icon="toc" cmd="navigator" label={t().navigator.title} title={`${t().navigator.title} (${shortcutHint('navigator')})`} active={navigatorOpen} onclick={() => onToggleNavigator?.()} />
  {#if collabView() && collabView()!.status !== 'closed'}
    <RibbonButton variant="big" icon="chat" cmd="chat" label={t().collab.chat.title} title={chatUnread() ? `${t().collab.chat.title} · ${t().collab.chat.unread(chatUnread())}` : t().collab.chat.title} active={chatOpen()} onclick={() => setChatOpen(!chatOpen())} />
  {/if}
  <div class="rb-col">
    <RibbonButton variant="small" icon="ruler" cmd="ruler" label={t().ruler.show} active={showRuler} onclick={() => (showRuler = !showRuler)} />
    <RibbonButton variant="small" icon="pilcrow" label={t().toolbarExpanded.formattingMarks} title={`${t().toolbarExpanded.formattingMarks} (${shortcutHint('formattingMarks')})`} active={showFormattingMarks} onclick={() => (showFormattingMarks = !showFormattingMarks)} />
    <RibbonButton variant="small" icon="shading" cmd="fieldShadings" label={t().view.fieldShadings} title={t().view.fieldShadingsTitle} active={showFieldShading} onclick={() => (showFieldShading = !showFieldShading)} />
  </div>
  <RibbonButton variant="big" icon="splitView" cmd="splitView" label={t().view.split} title={`${t().view.splitTitle} (${shortcutHint('splitView')})`} active={splitView} onclick={toggleSplit} />
  <div class="rb-menu-wrap" use:clickOutside={'pageColumns'}>
    <RibbonButton
      variant="big"
      icon="pagesAcross"
      cmd="pagesAcross"
      label={t().view.pagesAcross}
      title={t().view.pagesAcrossTitle}
      caret
      active={pageColumns > 1}
      onclick={() => toggleMenu('pageColumns')}
    />
    {#if isMenuOpen('pageColumns')}
      <div class="ribbon-menu" use:anchored role="menu">
        {#each COLUMN_CHOICES as n}
          <button class:selected={pageColumns === n} onclick={() => { closeMenu(); setColumns(n); }}>
            {t().view.pagesCount(n)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().status.zoom} reads>
  <RibbonButton variant="big" icon="zoomOut" cmd="zoomOut" label={t().status.zoomOut} title={`${t().status.zoomOut} (${shortcutHint('zoomOut')})`} disabled={zoom <= MIN_ZOOM} onclick={() => onZoom?.(zoom - 10)} />
  <RibbonButton variant="big" icon="zoomReset" cmd="zoomReset" label={`${zoom}%`} title={`${t().status.resetZoom} (${shortcutHint('zoomReset')})`} onclick={() => onZoom?.(100)} />
  <RibbonButton variant="big" icon="zoomIn" cmd="zoomIn" label={t().status.zoomIn} title={`${t().status.zoomIn} (${shortcutHint('zoomIn')})`} disabled={zoom >= MAX_ZOOM} onclick={() => onZoom?.(zoom + 10)} />
</RibbonGroup>

{#if onDebugDump}
  <div class="ribbon-sep"></div>
  <RibbonGroup label={t().ribbon.groups.debug} reads>
    <RibbonButton variant="big" icon="export" label={t().ribbon.debugDump} onclick={onDebugDump} />
  </RibbonGroup>
{/if}

<style>
  .rb-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    height: 100%;
  }

  .rb-menu-wrap { position: relative; }
</style>
