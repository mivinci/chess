<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Bot from 'lucide-svelte/icons/bot';
  import History from 'lucide-svelte/icons/history';
  import Lightbulb from 'lucide-svelte/icons/lightbulb';
  import LoaderCircle from 'lucide-svelte/icons/loader-circle';
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
  import Trophy from 'lucide-svelte/icons/trophy';
  import Undo2 from 'lucide-svelte/icons/undo-2';
  import Volume2 from 'lucide-svelte/icons/volume-2';
  import VolumeX from 'lucide-svelte/icons/volume-x';
  import User from 'lucide-svelte/icons/user';
  import ChessBoard from '#lib/components/chess-board.svelte';
  import Badge from '#lib/components/ui/badge.svelte';
  import Button from '#lib/components/ui/button.svelte';
  import Card from '#lib/components/ui/card.svelte';
  import Select from '#lib/components/ui/select.svelte';
  import { ChessGame, type GameStatus } from '#lib/chess/game';
  import { saveRecord } from '#lib/chess/records';
  import { explainHint } from '#lib/chess/hint-explain';
  import { playCaptureSound, playMoveSound } from '#lib/chess/sound';
  import { generateRoomId, ROOM_HTTP_BASE } from '#lib/room/config';
  import { BLACK, RED, sideOf, type Move, type Side } from '#lib/chess/types';
  import type { SearchRequest, SearchResponse } from '#lib/chess/ai.worker';

  const DEPTH: Record<string, number> = { easy: 2, normal: 3, hard: 4 };

  const MOVE_ANIMATION_MS = 550;
  const NATURAL_THINK_MIN = 700;
  const NATURAL_THINK_JITTER = 400;

  let game = new ChessGame();
  let boardView = $state<number[]>(Array.from(game.board));
  let pieceIdsView = $state<number[]>(Array.from(game.pieceIds));
  let currentTurn = $state<Side>(RED);
  let lastMove = $state<Move | null>(null);
  let notations = $state<string[]>([]);
  let gameStatus = $state<GameStatus>('playing');
  let selected = $state<number | null>(null);
  let targets = $state<number[]>([]);
  let difficulty = $state('normal');
  let playerSide = $state<Side>(RED);
  let thinking = $state(false);
  let hinting = $state(false);
  let hintMove = $state<Move | null>(null);
  let hintScore = $state(0);
  let hintText = $derived(
    hintMove ? explainHint(game.board, hintMove, playerSide, hintScore) : ''
  );
  let soundOn = $state(true);
  let aiPace = $state<'natural' | 'fast'>('natural');

  // 音效跟动画对齐：吃子在砸下瞬间响，普通落子在棋子落定时响。
  // 用 AudioBuffer 精确调度，不再 setTimeout + play()，消除手机上 audio.play() 的启动抖动
  function playMove(move: Move | null) {
    if (!soundOn || !move) return;
    const isCapture = move.captured !== 0;
    const delay = isCapture ? 430 : 540;
    if (isCapture) playCaptureSound(delay);
    else playMoveSound(delay);
  }
  let worker: Worker | null = null;
  let requestId = 0;
  let humanMovedAt = 0;
  let aiStartedAt = 0;
  let recorded = false;

  let humanTurn = $derived(!thinking && currentTurn === playerSide && gameStatus === 'playing');
  let inCheck = $derived(gameStatus === 'playing' && game.inCheck(currentTurn));
  let checkKing = $derived(inCheck ? game.kingPos(currentTurn) : -1);
  let moveCount = $derived(Math.ceil(notations.length / 2));

  let pairs = $derived.by(() => {
    const rows: { no: number; red: string; black: string }[] = [];
    for (let i = 0; i < notations.length; i += 2) {
      rows.push({ no: i / 2 + 1, red: notations[i], black: notations[i + 1] ?? '' });
    }
    return rows;
  });

  let endText = $derived(
    gameStatus === 'red-win' || gameStatus === 'black-win' ? '无棋可走（将死 / 困毙）' : ''
  );

  let statusText = $derived.by(() => {
    if (gameStatus === 'red-win' || gameStatus === 'black-win') {
      const winner = gameStatus === 'red-win' ? RED : BLACK;
      return winner === playerSide ? '你赢了！' : '电脑获胜';
    }
    if (thinking) return '电脑思考中…';
    if (inCheck) return `${currentTurn === RED ? '红方' : '黑方'}被将军！`;
    return humanTurn ? '轮到你走棋' : '电脑走棋中';
  });

  function sync() {
    boardView = Array.from(game.board);
    pieceIdsView = Array.from(game.pieceIds);
    currentTurn = game.turn;
    lastMove = game.lastMove;
    notations = [...game.notations];
    gameStatus = game.status;
  }

  function recordCurrentGame() {
    if (recorded || game.history.length === 0) return;
    recorded = true;
    const roomId = generateRoomId();
    const moves = game.history.map((m) => ({ ...m }));
    const notations = [...game.notations];
    saveRecord({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      playedAt: Date.now(),
      playerSide,
      difficulty,
      pace: aiPace,
      source: 'ai',
      roomId,
      result: game.status,
      endReason: 'checkmate',
      moves,
      notations
    });
    // 上传到服务端供日后分支；失败不影响本地记录，这盘仍能看能复盘，只是不能从服务端派生
    const token = (page.data.roomToken as string | undefined) ?? '';
    void fetch(`${ROOM_HTTP_BASE}/archive?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: roomId, history: moves, notations })
    }).catch(() => {});
  }

  function postSearch(purpose: 'move' | 'hint', side: Side) {
    if (!worker) return;
    worker.postMessage({
      id: ++requestId,
      board: game.board.slice(),
      side,
      depth: purpose === 'hint' ? 3 : DEPTH[difficulty],
      purpose
    } satisfies SearchRequest);
  }

  function askAI() {
    thinking = true;
    aiStartedAt = performance.now();
    postSearch('move', currentTurn);
  }

  function requestHint() {
    if (!worker || !humanTurn || gameStatus !== 'playing') return;
    hintMove = null;
    hintScore = 0;
    hinting = true;
    postSearch('hint', playerSide);
  }

  function handleSquare(index: number) {
    if (!humanTurn) return;
    const piece = game.board[index];

    if (selected !== null && targets.includes(index)) {
      const from = selected;
      selected = null;
      targets = [];
      const move = game.move(from, index);
      if (move) {
        playMove(move);
        hintMove = null;
        humanMovedAt = performance.now();
        sync();
        if (gameStatus === 'playing') askAI();
        else recordCurrentGame(); // 玩家走子直接将死/困毙对手时也要存档
      }
      return;
    }

    if (piece !== 0 && sideOf(piece) === playerSide) {
      selected = index;
      targets = game.legalMoves(index).map((m) => m.to);
    } else {
      selected = null;
      targets = [];
    }
  }

  function newGame() {
    cancelSearch();
    recordCurrentGame();
    game.reset();
    recorded = false;
    selected = null;
    targets = [];
    thinking = false;
    hinting = false;
    hintMove = null;
    sync();
    if (playerSide === BLACK) askAI();
  }

  function undo() {
    cancelSearch();
    thinking = false;
    recorded = false;
    hinting = false;
    hintMove = null;
    const steps = game.turn === playerSide ? 2 : 1;
    for (let i = 0; i < steps; i++) game.undo();
    selected = null;
    targets = [];
    sync();
  }

  function changeSide(value: string) {
    playerSide = value === 'black' ? BLACK : RED;
    newGame();
  }

  function setupWorker() {
    worker = new Worker(new URL('../../lib/chess/ai.worker.ts', import.meta.url), {
      type: 'module'
    });
    worker.onerror = () => {
      thinking = false;
    };
    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      const response = event.data;
      if (response.id !== requestId) return;

      if (response.purpose === 'hint') {
        hintMove = response.move;
        hintScore = response.score;
        hinting = false;
        return;
      }

      // 玩家那步的位移动画播完再落子，避免两颗棋子同时飞、看不清先后
      // 自然模式再加一段随机的「思考」时间，避免秒回
      const thinkMs =
        aiPace === 'natural'
          ? NATURAL_THINK_MIN + Math.random() * NATURAL_THINK_JITTER
          : MOVE_ANIMATION_MS;
      const floor = Math.max(MOVE_ANIMATION_MS, thinkMs);
      const remaining = Math.max(0, floor - (performance.now() - aiStartedAt));
      setTimeout(() => {
        if (response.id !== requestId) return;
        if (response.move) playMove(game.move(response.move.from, response.move.to));
        thinking = false;
        sync();
        if (gameStatus !== 'playing') recordCurrentGame();
      }, remaining);
    };
  }

  /** 立即中断正在进行的搜索：terminate 是唯一能真正停止同步循环的方式 */
  function cancelSearch() {
    requestId++;
    worker?.terminate();
    setupWorker();
  }

  onMount(() => {
    setupWorker();
    return () => worker?.terminate();
  });
</script>

<svelte:head>
  <title>中国象棋 · 人机对战</title>
  <meta
    name="description"
    content="木质质感中国象棋，支持三档难度的人机对战，可部署到 Cloudflare Workers。"
  />
</svelte:head>

  <main class="min-h-screen bg-background">
  <div class="mx-auto max-w-5xl px-4 py-5 sm:py-6">
    <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section>
        <ChessBoard
          board={boardView}
          pieceIds={pieceIdsView}
          playerSide={playerSide}
          {selected}
          {targets}
          {lastMove}
          hint={hintMove}
          {checkKing}
          disabled={!humanTurn}
          onsquare={handleSquare}
        />
        <div class="mx-auto mt-3 flex max-w-[600px] items-center justify-between gap-3">
          <Badge
            variant={inCheck
              ? 'destructive'
              : gameStatus === 'playing'
                ? 'secondary'
                : 'default'}
          >
            {#if thinking}
              <LoaderCircle class="size-3 animate-spin" />
            {:else if gameStatus === 'playing'}
              {#if currentTurn === RED}
                <span class="size-2 rounded-full bg-[#b42318]"></span>
              {:else}
                <span class="size-2 rounded-full bg-[#2a231c] ring-1 ring-white/40"></span>
              {/if}
            {:else}
              <Trophy class="size-3" />
            {/if}
            {statusText}
          </Badge>
          <span class="text-xs text-muted-foreground">第 {moveCount + 1} 回合</span>
        </div>
        {#if gameStatus !== 'playing'}
          <Card class="mx-auto mt-3 max-w-[600px] p-3.5 text-center">
            <div class="flex items-center justify-center gap-2">
              <Trophy class="size-5 text-primary" />
              <h2 class="text-lg font-semibold">
                {gameStatus === 'red-win'
                  ? playerSide === RED
                    ? '你赢了'
                    : '电脑获胜'
                  : playerSide === BLACK
                    ? '你赢了'
                    : '电脑获胜'}
              </h2>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">共 {moveCount} 回合 · {endText}</p>
            <div class="mt-3 flex gap-2">
              <Button class="flex-1" onclick={newGame}>
                <RotateCcw class="size-4" />再来一局
              </Button>
              <Button
                variant="outline"
                class="flex-1"
                onclick={() => {
                  recordCurrentGame();
                  void goto('/replay');
                }}
              >
                <History class="size-3.5" />去复盘
              </Button>
            </div>
          </Card>
        {/if}
      </section>

      <aside class="space-y-3">
        <Card class="p-3.5">
          <h2 class="mb-3 text-sm font-semibold">对局设置</h2>
          <div class="space-y-3">
            <div>
              <span class="mb-1.5 block text-xs text-muted-foreground">难度</span>
              <Select
                value={difficulty}
                options={[
                  { value: 'easy', label: '入门 · 两层搜索' },
                  { value: 'normal', label: '进阶 · 三层搜索' },
                  { value: 'hard', label: '高手 · 四层搜索' }
                ]}
                onchange={(v) => (difficulty = v)}
              />
            </div>
            <div>
              <span class="mb-1.5 block text-xs text-muted-foreground">执子</span>
              <Select
                value={playerSide === RED ? 'red' : 'black'}
                options={[
                  { value: 'red', label: '执红 · 先手' },
                  { value: 'black', label: '执黑 · 后手' }
                ]}
                onchange={changeSide}
              />
            </div>
            <div>
              <span class="mb-1.5 block text-xs text-muted-foreground">AI 节奏</span>
              <Select
                value={aiPace}
                options={[
                  { value: 'natural', label: '自然 · 像真人思考' },
                  { value: 'fast', label: '快速 · 落子即回应' }
                ]}
                onchange={(v) => (aiPace = v as 'natural' | 'fast')}
              />
            </div>
            <div class="grid grid-cols-2 gap-2 pt-1">
              <Button onclick={newGame}><RotateCcw class="size-4" />新局</Button>
              <Button variant="outline" onclick={undo} disabled={notations.length === 0}>
                <Undo2 class="size-4" />悔棋
              </Button>
              <Button
                variant="secondary"
                onclick={requestHint}
                disabled={!humanTurn || hinting}
              >
                {#if hinting}
                  <LoaderCircle class="size-4 animate-spin" />思考中…
                {:else}
                  <Lightbulb class="size-4" />提示一步
                {/if}
              </Button>
              <Button
                variant="outline"
                onclick={() => {
                  soundOn = !soundOn;
                }}
              >
                {#if soundOn}
                  <Volume2 class="size-4" />音效开
                {:else}
                  <VolumeX class="size-4" />音效关
                {/if}
              </Button>
            </div>
            {#if hintText}
              <div class="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-foreground/90">
                <div class="mb-0.5 flex items-center gap-1 font-medium text-primary">
                  <Lightbulb class="size-3" />建议走法
                </div>
                {hintText}
              </div>
            {/if}
            {#if hintMove}
              <p class="text-xs text-muted-foreground">棋盘上高亮了建议的起点和落点，自己点它走棋。</p>
            {/if}
          </div>
        </Card>

        <Card class="p-3.5">
          <h2 class="mb-3 text-sm font-semibold">对局信息</h2>
          <div class="space-y-2 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">你的身份</span>
              <span class="flex items-center gap-1.5">
                {#if playerSide === RED}
                  <span class="size-2.5 rounded-full bg-[#b42318]"></span>红方
                {:else}
                  <span class="size-2.5 rounded-full bg-[#2a231c] ring-1 ring-white/40"></span>黑方
                {/if}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">对手</span>
              <span class="flex items-center gap-1.5 text-muted-foreground">
                <Bot class="size-3.5" />电脑
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">已走</span>
              <span class="tabular-nums">{notations.length} 步</span>
            </div>
          </div>
        </Card>

        <Card class="p-3.5">
          <h2 class="mb-3 text-sm font-semibold">棋谱</h2>
          <div class="max-h-64 space-y-0.5 overflow-y-auto pr-1 text-sm">
            {#each pairs as pair (pair.no)}
              <div class="grid grid-cols-[2rem_1fr_1fr] gap-2 rounded px-2 py-1 odd:bg-muted/50">
                <span class="tabular-nums text-muted-foreground">{pair.no}.</span>
                <span class="font-medium text-[#d9534f]">{pair.red}</span>
                <span>{pair.black}</span>
              </div>
            {:else}
              <p class="py-6 text-center text-xs text-muted-foreground">落子后显示棋谱</p>
            {/each}
          </div>
        </Card>

        <p class="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <User class="size-3.5" />点击己方棋子查看可走位置
        </p>
      </aside>
    </div>
  </div>
</main>
