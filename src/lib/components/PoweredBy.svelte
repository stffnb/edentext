<script lang="ts">
  // AGPL-3.0-only with an additional term under section 7(b): see NOTICE.md.
  // The attribution an embedded editor shows (NOTICE.md). Fixed English
  // wording, like the product name: it is a licence notice, not interface text.
  const HOME_URL = 'https://stffnb.github.io/edentext/';
</script>

<a class="powered-by" href={HOME_URL} target="_blank" rel="noopener">
  <img src="favicon.svg" alt="" width="14" height="14" />
  <span>Powered by <strong>EdenText</strong></span>
</a>

<style>
  .powered-by {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 6px;
    border-radius: 4px;
    /* The status bar's own text colour: the notice must stay legible in every theme. */
    color: var(--color-text);
    font-size: 0.75rem;
    text-decoration: none;
    white-space: nowrap;
  }

  .powered-by:hover {
    text-decoration: underline;
  }

  .powered-by strong {
    font-weight: 600;
  }
</style>
