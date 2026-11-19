<script lang="ts">
  // An on/off switch: a native checkbox with role="switch", so keyboard, focus and
  // screen readers come with it; only its look is drawn here.
  let { checked = false, disabled = false, label, onchange }: {
    checked?: boolean;
    disabled?: boolean;
    label: string;
    onchange: (on: boolean) => void;
  } = $props();
</script>

<input
  type="checkbox"
  role="switch"
  class="toggle"
  aria-label={label}
  {checked}
  {disabled}
  onchange={(e) => onchange(e.currentTarget.checked)}
/>

<style>
  .toggle {
    appearance: none;
    flex: none;
    position: relative;
    width: 36px;
    height: 20px;
    margin: 0;
    border-radius: 10px;
    background: var(--w-border-strong);
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    inset-inline-start: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
    transition: transform 0.15s ease;
  }
  .toggle:checked { background: var(--w-accent-fill); }
  .toggle:checked::after { transform: translateX(16px); }
  :global(html[dir='rtl']) .toggle:checked::after { transform: translateX(-16px); }
  .toggle:focus-visible { outline: 2px solid var(--w-accent); outline-offset: 2px; }
  .toggle:disabled { opacity: 0.45; cursor: default; }
  @media (prefers-reduced-motion: reduce) {
    .toggle, .toggle::after { transition: none; }
  }
</style>
