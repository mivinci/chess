<script lang="ts">
  import Puzzle from 'lucide-svelte/icons/puzzle';
  import Card from '#lib/components/ui/card.svelte';
</script>

<svelte:head>
  <title>残局 · 中国象棋</title>
</svelte:head>

<main class="mx-auto max-w-5xl px-4 py-8">
  <Card class="mx-auto max-w-lg p-10 text-center">
    <div class="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
      <Puzzle class="size-6" />
    </div>
    <h1 class="mt-4 text-xl font-semibold">残局</h1>
    <p class="mt-2 text-sm text-muted-foreground">经典残局挑战，逐步破解。功能开发中。</p>
  </Card>
</main>
