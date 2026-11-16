<script lang="ts">
  import { cn } from '#lib/utils';
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'outline' | 'secondary' | 'destructive';
    class?: string;
    children?: Snippet;
  }

  let { variant = 'default', class: className = '', children }: Props = $props();

  const variants = {
    default: 'bg-primary text-primary-foreground',
    outline: 'border border-border text-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    destructive: 'bg-destructive text-white'
  };
</script>

<span
  class={cn(
    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
    variants[variant],
    className
  )}
>
  {@render children?.()}
</span>
