<script lang="ts">
  import { filterOptions } from '../../core/sidebarState';
  import { contrastColor } from '../../shared/color';

  let {
    label,
    options,
    selected,
    onToggle,
    colorFor,
    placeholder = 'Filter…',
  }: {
    label: string;
    options: string[];
    selected: string[];
    onToggle?: (value: string) => void;
    colorFor?: (value: string) => string;
    placeholder?: string;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let highlighted = $state(0);

  const result = $derived(filterOptions(options, selected, query));

  $effect(() => {
    const max = Math.max(0, result.visible.length - 1);
    if (highlighted > max) {
      highlighted = max;
    }
  });

  function choose(value: string): void {
    onToggle?.(value);
    query = '';
    highlighted = 0;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      open = false;
      query = '';
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = result.visible.length === 0 ? 0 : Math.min(highlighted + 1, result.visible.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const value = result.visible[highlighted];
      if (value) {
        choose(value);
      }
    }
  }
</script>

<div class="picker" data-testid="filter-picker-{label}">
  <span class="label">{label}</span>
  <div class="field">
    {#each selected as value (value)}
      {@const bg = colorFor ? colorFor(value) : undefined}
      <span class="pill" data-testid="pill-{label}" style={bg ? `background:${bg}; color:${contrastColor(bg)}` : ''}>
        {value}
        <button type="button" class="pill-x" data-testid="pill-remove-{label}" aria-label="Remove {value}" onclick={() => onToggle?.(value)}>✕</button>
      </span>
    {/each}
    <input
      type="text"
      class="picker-input"
      data-testid="picker-input-{label}"
      role="combobox"
      aria-expanded={open}
      aria-controls="picker-listbox-{label}"
      aria-autocomplete="list"
      aria-activedescendant={open && result.visible.length > 0 ? `picker-opt-${label}-${highlighted}` : undefined}
      placeholder={placeholder}
      bind:value={query}
      onfocus={() => (open = true)}
      onblur={() => (open = false)}
      onkeydown={onkeydown}
    />
  </div>
  {#if open}
    <ul class="menu" id="picker-listbox-{label}" role="listbox" data-testid="picker-menu-{label}">
      {#each result.visible as option, i (option)}
        {@const obg = colorFor ? colorFor(option) : undefined}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
        <li
          class="option"
          class:highlighted={i === highlighted}
          id="picker-opt-{label}-{i}"
          role="option"
          aria-selected={i === highlighted}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => choose(option)}
        >
          {#if obg}<span class="swatch" style="background:{obg}"></span>{/if}
          {option}
        </li>
      {/each}
      {#if result.visible.length === 0}
        <li class="hint" data-testid="picker-empty-{label}">No matches</li>
      {/if}
      {#if result.more > 0}
        <li class="hint" data-testid="picker-more-{label}">+{result.more} more — type to filter…</li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .picker { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground, #9a9a9a); }
  .field { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; flex: 1; min-width: 80px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 1px 6px; border-radius: 10px; background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
  .pill-x { background: none; border: none; color: inherit; cursor: pointer; font-size: 10px; padding: 0; line-height: 1; }
  .picker-input { flex: 1; min-width: 60px; background: var(--vscode-input-background, #2a2a2a); color: var(--vscode-input-foreground, #ddd); border: 1px solid var(--vscode-input-border, #555); border-radius: 3px; padding: 1px 5px; font-size: 11px; }
  .menu { position: absolute; top: 100%; left: 0; right: 0; z-index: 5; margin: 2px 0 0; padding: 2px; list-style: none; max-height: 180px; overflow: auto; background: var(--vscode-dropdown-background, #252526); border: 1px solid var(--vscode-dropdown-border, #454545); border-radius: 4px; }
  .menu .option { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: none; border: none; color: var(--vscode-foreground, #ccc); cursor: pointer; padding: 3px 6px; font-size: 11.5px; border-radius: 3px; }
  .menu .option.highlighted, .menu .option:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
  .swatch { width: 9px; height: 9px; border-radius: 2px; flex: none; }
  .hint { padding: 3px 6px; font-size: 11px; color: var(--vscode-descriptionForeground, #9a9a9a); }
</style>
