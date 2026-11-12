<script lang="ts">
  import IslandButton from './IslandButton.svelte';
  import IslandMenu from './IslandMenu.svelte';
  import { closeMenu } from '../ribbon/menu.svelte';
  import { MIN_ZOOM, MAX_ZOOM } from '../../utils/zoom';
  import { MAX_PAGE_COLUMNS } from '../../storage/theme';
  import { t } from '../../i18n/i18n.svelte';
  import { shortcutHint } from '../../editor/shortcuts';
  import { collabView } from '../../collab/appSession.svelte';
  import { chatOpen, chatUnread, setChatOpen } from '../../collab/chat.svelte';

  // The View category, as the ribbon's View tab.
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

<div class="toolbar-group">
  <IslandButton icon="toc" cmd="navigator" title={`${t().navigator.title} (${shortcutHint('navigator')})`} active={navigatorOpen} onclick={() => onToggleNavigator?.()} />
  {#if collabView() && collabView()!.status !== 'closed'}
    <IslandButton icon="chat" cmd="chat" title={chatUnread() ? `${t().collab.chat.title} · ${t().collab.chat.unread(chatUnread())}` : t().collab.chat.title} active={chatOpen()} onclick={() => setChatOpen(!chatOpen())} />
  {/if}
  <IslandButton icon="ruler" cmd="ruler" title={t().ruler.show} active={showRuler} onclick={() => (showRuler = !showRuler)} />
  <IslandButton icon="pilcrow" title={`${t().toolbarExpanded.formattingMarks} (${shortcutHint('formattingMarks')})`} active={showFormattingMarks} onclick={() => (showFormattingMarks = !showFormattingMarks)} />
  <IslandButton icon="shading" cmd="fieldShadings" title={t().view.fieldShadingsTitle} active={showFieldShading} onclick={() => (showFieldShading = !showFieldShading)} />
</div>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <IslandButton icon="splitView" cmd="splitView" title={`${t().view.splitTitle} (${shortcutHint('splitView')})`} active={splitView} onclick={toggleSplit} />
  <IslandMenu id="pageColumns" icon="pagesAcross" cmd="pagesAcross" title={t().view.pagesAcrossTitle} active={pageColumns > 1}>
    {#each COLUMN_CHOICES as n}
      <button class:selected={pageColumns === n} onclick={() => { closeMenu(); setColumns(n); }}>{t().view.pagesCount(n)}</button>
    {/each}
  </IslandMenu>
</div>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <IslandButton icon="zoomOut" cmd="zoomOut" title={`${t().status.zoomOut} (${shortcutHint('zoomOut')})`} disabled={zoom <= MIN_ZOOM} onclick={() => onZoom?.(zoom - 10)} />
  <IslandButton label={`${zoom}%`} cmd="zoomReset" title={`${t().status.resetZoom} (${shortcutHint('zoomReset')})`} onclick={() => onZoom?.(100)} />
  <IslandButton icon="zoomIn" cmd="zoomIn" title={`${t().status.zoomIn} (${shortcutHint('zoomIn')})`} disabled={zoom >= MAX_ZOOM} onclick={() => onZoom?.(zoom + 10)} />
</div>

{#if onDebugDump}
  <div class="toolbar-separator"></div>
  <div class="toolbar-group">
    <IslandButton label="Debug" title={t().ribbon.debugDump} onclick={onDebugDump} />
  </div>
{/if}
