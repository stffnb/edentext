<script lang="ts">
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import { MIN_ZOOM, MAX_ZOOM } from '../../../utils/zoom';
  import { t } from '../../../i18n/i18n.svelte';
  import { shortcutHint } from '../../../editor/shortcuts';

  let {
    showRuler = $bindable(true),
    showFormattingMarks = $bindable(false),
    zoom = 100,
    onZoom,
    onDebugDump,
  }: {
    showRuler?: boolean;
    showFormattingMarks?: boolean;
    zoom?: number;
    onZoom?: (value: number) => void;
    onDebugDump?: () => void;
  } = $props();
</script>

<RibbonGroup label={t().ribbon.groups.show}>
  <div class="rb-col">
    <RibbonButton variant="small" icon="ruler" label={t().ruler.show} active={showRuler} onclick={() => (showRuler = !showRuler)} />
    <RibbonButton variant="small" icon="pilcrow" label={t().toolbarExpanded.formattingMarks} title={`${t().toolbarExpanded.formattingMarks} (${shortcutHint('formattingMarks')})`} active={showFormattingMarks} onclick={() => (showFormattingMarks = !showFormattingMarks)} />
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().status.zoom}>
  <RibbonButton variant="big" icon="zoomOut" label={t().status.zoomOut} title={`${t().status.zoomOut} (${shortcutHint('zoomOut')})`} disabled={zoom <= MIN_ZOOM} onclick={() => onZoom?.(zoom - 10)} />
  <RibbonButton variant="big" icon="zoomReset" label={`${zoom}%`} title={`${t().status.resetZoom} (${shortcutHint('zoomReset')})`} onclick={() => onZoom?.(100)} />
  <RibbonButton variant="big" icon="zoomIn" label={t().status.zoomIn} title={`${t().status.zoomIn} (${shortcutHint('zoomIn')})`} disabled={zoom >= MAX_ZOOM} onclick={() => onZoom?.(zoom + 10)} />
</RibbonGroup>

{#if onDebugDump}
  <div class="ribbon-sep"></div>
  <RibbonGroup label={t().ribbon.groups.debug}>
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
</style>
