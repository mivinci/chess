<script lang="ts">
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import { cn } from '#lib/utils';

  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    value: string;
    options: Option[];
    class?: string;
    onchange?: (value: string) => void;
  }

  let { value = $bindable(), options, class: className = '', onchange }: Props = $props();

  function handleChange(event: Event) {
    value = (event.currentTarget as HTMLSelectElement).value;
    onchange?.(value);
  }
</script>

<div class="relative">
  <select
    {value}
    onchange={handleChange}
    class={cn(
      'h-10 w-full appearance-none rounded-md border border-input bg-card px-3 pr-9 text-sm text-foreground shadow-sm outline-none transition-colors focus:ring-2 focus:ring-ring cursor-pointer',
      className
    )}
  >
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <ChevronDown
    class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-50"
  />
</div>
