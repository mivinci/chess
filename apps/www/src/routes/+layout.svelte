<script lang="ts">
  import './layout.css';
  import { onMount } from 'svelte';
  import favicon from '#lib/assets/favicon.svg';
  import { page } from '$app/state';
  import Palette from 'lucide-svelte/icons/palette';
  import Swords from 'lucide-svelte/icons/swords';
  import { preloadSounds, unlockAudio } from '#lib/chess/sound';
  import { applyTheme, currentTheme, THEMES, type ThemeId } from '#lib/theme';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  const tabs = [
    { href: '/ai', label: '人机' },
    { href: '/play', label: '房间' },
    { href: '/board', label: '盘面' },
    { href: '/replay', label: '复盘' }
  ];

  let loading = $state(true);
  let theme = $state<ThemeId>('vermilion');
  let themeOpen = $state(false);

  onMount(() => {
    theme = currentTheme();
    let alive = true;
    // 音效和棋子字体并行预加载；各有超时兜底，不能让加载屏卡住页面
    const withTimeout = (p: Promise<unknown>, ms: number) =>
      Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);

    const fontReady = document.fonts
      ? withTimeout(document.fonts.load('16px ChessKai', '帅'), 2500)
      : Promise.resolve();

    Promise.all([preloadSounds(2500), fontReady]).then(() => {
      if (alive) loading = false;
    });

    const onPointerDown = (e: PointerEvent) => {
      // 首次手势同步唤醒音频，之后异步播放（AI 回合、房间广播）才不会被 iOS 拦
      unlockAudio();
      const target = e.target as HTMLElement;
      if (themeOpen && !target.closest('.theme-menu') && !target.closest('[aria-label="切换配色"]')) {
        themeOpen = false;
      }
    };
    document.addEventListener('pointerdown', onPointerDown);

    return () => {
      alive = false;
      document.removeEventListener('pointerdown', onPointerDown);
    };
  });

  function isActive(href: string) {
    return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{#if loading}
  <div class="loading-screen" role="status" aria-live="polite" aria-label="正在加载">
    <div class="loading-inner">
      <div class="loading-grid" aria-hidden="true">
        {#each Array(9) as _}
          <span></span>
        {/each}
      </div>
      <div class="loading-piece">帥</div>
      <p class="loading-text">正在加载棋盘…</p>
    </div>
  </div>
{/if}

{#if !loading}
  <div class="min-h-screen bg-background">
  <nav class="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
    <div class="relative mx-auto max-w-5xl px-4">
      <div class="flex items-center gap-1 overflow-x-auto py-2 pr-12">
        <a
          href="/ai"
          class="mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
          aria-label="中国象棋首页"
        >
          <Swords class="size-5" />
        </a>
        {#each tabs as tab (tab.href)}
          <a
            href={tab.href}
            class="shrink-0 rounded-md px-2.5 py-1.5 text-sm transition-colors {isActive(tab.href)
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
          >
            {tab.label}
          </a>
        {/each}
      </div>
      <div class="absolute right-4 top-1/2 -translate-y-1/2">
        <button
          type="button"
          class="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="切换配色"
          aria-expanded={themeOpen}
          onclick={() => (themeOpen = !themeOpen)}
        >
          <Palette class="size-4" />
        </button>
        {#if themeOpen}
          <div class="theme-menu absolute right-0 top-10 w-40 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
            {#each THEMES as t (t.id)}
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent {theme ===
                t.id
                  ? 'text-foreground'
                  : 'text-muted-foreground'}"
                onclick={() => {
                  theme = t.id;
                  applyTheme(t.id);
                  themeOpen = false;
                }}
              >
                <span class="theme-swatch" data-swatch={t.id}></span>
                <span class="flex-1">{t.label}</span>
                <span class="text-[10px] text-muted-foreground">{t.desc}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </nav>

  {@render children()}
  </div>
{/if}

<style>
  .theme-swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    flex-shrink: 0;
  }
  .theme-swatch[data-swatch='bamboo'] {
    background: linear-gradient(135deg, #18211d 50%, #7fb894 50%);
  }
  .theme-swatch[data-swatch='vermilion'] {
    background: linear-gradient(135deg, #1c1c1e 50%, #d94f45 50%);
  }
  .theme-swatch[data-swatch='indigo'] {
    background: linear-gradient(135deg, #1a1f2e 50%, #8faadc 50%);
  }
  .theme-swatch[data-swatch='sandalwood'] {
    background: linear-gradient(135deg, #2b2620 50%, #c99a5b 50%);
  }

  .loading-screen {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-background-tertiary);
  }

  .loading-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
  }

  .loading-grid {
    display: grid;
    grid-template-columns: repeat(3, 14px);
    gap: 6px;
    animation: grid-spin 1.6s ease-in-out infinite;
  }

  .loading-grid span {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--color-primary);
    opacity: 0.25;
  }

  .loading-grid span:nth-child(2),
  .loading-grid span:nth-child(5),
  .loading-grid span:nth-child(8) {
    opacity: 0.6;
  }

  .loading-grid span:nth-child(5) {
    opacity: 1;
  }

  .loading-piece {
    position: absolute;
    margin-top: -2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #e8d5a8;
    color: #b42318;
    font-family: 'ChessKai', var(--font-serif);
    font-size: 26px;
    font-weight: 500;
    box-shadow: 0 3px 8px rgba(40, 20, 5, 0.3), inset 0 1px 2px rgba(255, 250, 230, 0.8);
    animation: piece-hop 1.6s ease-in-out infinite;
  }

  .loading-text {
    margin-top: 24px;
    color: var(--color-text-secondary);
    font-size: 13px;
  }

  @keyframes grid-spin {
    0%,
    100% {
      transform: rotate(0deg);
    }
    50% {
      transform: rotate(90deg);
    }
  }

  @keyframes piece-hop {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-grid,
    .loading-piece {
      animation: none;
    }
  }
</style>
