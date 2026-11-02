import { canvasFont, recordScore, theme, type CarnivalGame } from '../../carnival';

const { width: WIDTH, height: HEIGHT } = theme.canvas;

export const CELL = 10;
export const COLS = 76;
export const ROWS = 42;
const ARENA = { x: (WIDTH - COLS * CELL) / 2, y: 30 } as const;
/** Ticks per second: every rider moves one cell per tick. */
export const TICK_RATE = 12;

export const POINTS_PER_TICK = 1;
export const POINTS_PER_RIVAL_OUT = 100;
export const POINTS_LAST_RIDER = 250;

export type Direction = 'up' | 'down' | 'left' | 'right';

const MOVES: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

const TURNS: Record<Direction, [Direction, Direction]> = {
  up: ['left', 'right'],
  down: ['right', 'left'],
  left: ['down', 'up'],
  right: ['up', 'down'],
};

export interface Rider {
  x: number;
  y: number;
  dir: Direction;
  alive: boolean;
}

export interface LightCyclesState {
  /** The player is rider 0; the rest are AI riders. */
  riders: Rider[];
  /** One cell per entry, row by row: 0 is open, otherwise 1 + the index of the rider whose trail it is. */
  trails: Uint8Array;
  /** Turns the player has pressed that haven't happened yet, oldest first. */
  turns: Direction[];
  ticks: number;
  score: number;
  /** Time carried over towards the next tick, in seconds. */
  carry: number;
  phase: 'playing' | 'over';
}

const STARTS: Rider[] = [
  { x: 8, y: ROWS / 2, dir: 'right', alive: true },
  { x: COLS - 9, y: ROWS / 2 - 1, dir: 'left', alive: true },
  { x: COLS / 2 - 1, y: 4, dir: 'down', alive: true },
  { x: COLS / 2, y: ROWS - 5, dir: 'up', alive: true },
];

const index = (x: number, y: number) => y * COLS + x;

export function isOpen(state: LightCyclesState, x: number, y: number): boolean {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS && state.trails[index(x, y)] === 0;
}

export function createState(): LightCyclesState {
  const state: LightCyclesState = {
    riders: STARTS.map((rider) => ({ ...rider })),
    trails: new Uint8Array(COLS * ROWS),
    turns: [],
    ticks: 0,
    score: 0,
    carry: 0,
    phase: 'playing',
  };
  state.riders.forEach((rider, i) => (state.trails[index(rider.x, rider.y)] = i + 1));
  return state;
}

/**
 * Queues a turn for the player. A turn back the way the cycle is going, or
 * one that doesn't change direction, is ignored. Returns whether it queued.
 */
export function steer(state: LightCyclesState, dir: Direction): boolean {
  if (state.phase !== 'playing' || state.turns.length >= 2) return false;
  const heading = state.turns.at(-1) ?? state.riders[0].dir;
  if (dir === heading || dir === OPPOSITE[heading]) return false;
  state.turns.push(dir);
  return true;
}

/** How many open cells can be reached from (x, y), counting it. */
function openSpace(state: LightCyclesState, x: number, y: number, blocked: Set<number>): number {
  const seen = new Set<number>([index(x, y)]);
  const queue = [[x, y]];
  while (queue.length > 0) {
    const [cx, cy] = queue.pop()!;
    for (const { dx, dy } of Object.values(MOVES)) {
      const nx = cx + dx;
      const ny = cy + dy;
      const i = index(nx, ny);
      if (isOpen(state, nx, ny) && !seen.has(i) && !blocked.has(i)) {
        seen.add(i);
        queue.push([nx, ny]);
      }
    }
  }
  return seen.size;
}

/** How many open cells lie straight ahead of (x, y) going `dir`. */
function runLength(state: LightCyclesState, x: number, y: number, dir: Direction): number {
  const { dx, dy } = MOVES[dir];
  let length = 0;
  while (isOpen(state, x + dx * (length + 1), y + dy * (length + 1))) length++;
  return length;
}

/**
 * Picks an AI rider's next direction: never a crash when a safe move exists,
 * and otherwise the move with the most open space behind it.
 */
export function chooseDirection(state: LightCyclesState, riderIndex: number): Direction {
  const rider = state.riders[riderIndex];
  // Cells other riders could move into next tick count as taken.
  const blocked = new Set<number>();
  state.riders.forEach((other, i) => {
    if (i === riderIndex || !other.alive) return;
    for (const { dx, dy } of Object.values(MOVES)) {
      const x = other.x + dx;
      const y = other.y + dy;
      if (isOpen(state, x, y)) blocked.add(index(x, y));
    }
  });

  let best = rider.dir;
  let bestValue = -1;
  for (const dir of [rider.dir, ...TURNS[rider.dir]]) {
    const x = rider.x + MOVES[dir].dx;
    const y = rider.y + MOVES[dir].dy;
    if (!isOpen(state, x, y)) continue;
    // A cell another rider might take is a last resort, but beats a sure crash.
    const contested = blocked.has(index(x, y));
    const space = contested ? 0 : openSpace(state, x, y, blocked);
    const value = space * COLS + runLength(state, x, y, dir) + 1;
    if (value > bestValue) {
      best = dir;
      bestValue = value;
    }
  }
  return best;
}

/** Moves every rider one cell, and settles crashes and scoring. */
export function tick(state: LightCyclesState): void {
  if (state.phase !== 'playing') return;

  const player = state.riders[0];
  const turn = state.turns.shift();
  if (turn) player.dir = turn;
  state.riders.forEach((rider, i) => {
    if (i > 0 && rider.alive) rider.dir = chooseDirection(state, i);
  });

  const targets = state.riders.map((rider) => ({
    x: rider.x + MOVES[rider.dir].dx,
    y: rider.y + MOVES[rider.dir].dy,
  }));
  const crashed = state.riders.map((rider, i) => {
    if (!rider.alive) return false;
    const { x, y } = targets[i];
    if (!isOpen(state, x, y)) return true;
    // Two riders moving into the same cell both crash.
    return state.riders.some(
      (other, j) => j !== i && other.alive && targets[j].x === x && targets[j].y === y,
    );
  });

  state.riders.forEach((rider, i) => {
    if (!rider.alive) return;
    if (crashed[i]) {
      rider.alive = false;
      return;
    }
    rider.x = targets[i].x;
    rider.y = targets[i].y;
    state.trails[index(rider.x, rider.y)] = i + 1;
  });

  state.ticks += 1;
  if (!player.alive) {
    state.phase = 'over';
    return;
  }

  state.score += POINTS_PER_TICK;
  const rivalsOut = crashed.filter((out, i) => i > 0 && out).length;
  state.score += rivalsOut * POINTS_PER_RIVAL_OUT;
  if (state.riders.every((rider, i) => i === 0 || !rider.alive)) {
    state.score += POINTS_LAST_RIDER;
    state.phase = 'over';
  }
}

/** Advances the game by `dt` seconds, ticking at `TICK_RATE`. */
export function step(state: LightCyclesState, dt: number): void {
  state.carry += dt;
  while (state.carry >= 1 / TICK_RATE && state.phase === 'playing') {
    state.carry -= 1 / TICK_RATE;
    tick(state);
  }
}

const KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};

function draw(ctx: CanvasRenderingContext2D, state: LightCyclesState) {
  const { colors } = theme;
  // The player is gold; the AI riders take the other bright theme colours.
  const riderColors = [colors.accent, colors.water, colors.stripeA, colors.muted];

  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // The fairground floor and its fence.
  ctx.fillStyle = colors.surface;
  ctx.fillRect(ARENA.x, ARENA.y, COLS * CELL, ROWS * CELL);
  ctx.strokeStyle = colors.wood;
  ctx.lineWidth = 6;
  ctx.strokeRect(ARENA.x - 3, ARENA.y - 3, COLS * CELL + 6, ROWS * CELL + 6);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const owner = state.trails[index(x, y)];
      if (owner === 0) continue;
      ctx.fillStyle = riderColors[owner - 1];
      ctx.globalAlpha = state.riders[owner - 1].alive ? 0.75 : 0.35;
      ctx.fillRect(ARENA.x + x * CELL + 1, ARENA.y + y * CELL + 1, CELL - 2, CELL - 2);
    }
  }
  ctx.globalAlpha = 1;

  // The cycles themselves, glowing.
  state.riders.forEach((rider, i) => {
    if (!rider.alive) return;
    ctx.fillStyle = riderColors[i];
    ctx.shadowColor = riderColors[i];
    ctx.shadowBlur = 12;
    ctx.fillRect(ARENA.x + rider.x * CELL - 1, ARENA.y + rider.y * CELL - 1, CELL + 2, CELL + 2);
  });
  ctx.shadowBlur = 0;

  const rivalsLeft = state.riders.filter((rider, i) => i > 0 && rider.alive).length;
  ctx.fillStyle = colors.text;
  ctx.font = canvasFont('body', 'bold');
  ctx.textAlign = 'left';
  ctx.fillText(`Score ${state.score}`, 16, HEIGHT - 20);
  ctx.textAlign = 'right';
  ctx.fillText(`Riders left ${rivalsLeft}/${state.riders.length - 1}`, WIDTH - 16, HEIGHT - 20);

  if (state.phase === 'over') {
    const won = state.riders[0].alive;
    ctx.fillStyle = colors.background;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.accent;
    ctx.font = canvasFont('title', 'bold');
    ctx.fillText(
      won ? `Last rider left! You scored ${state.score}` : `Crashed! You scored ${state.score}`,
      WIDTH / 2,
      HEIGHT / 2,
    );
    ctx.fillStyle = colors.text;
    ctx.font = canvasFont('body');
    ctx.fillText('Press space or click to ride again', WIDTH / 2, HEIGHT / 2 + 40);
  }
}

export const lightCycles: CarnivalGame = {
  id: 'light-cycles',
  name: 'Light Cycles',
  description: 'Ride a glowing bumper-cycle round the arena and outlast three rivals.',

  start(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    let state = createState();
    let scoreRecorded = false;
    const restart = () => {
      state = createState();
      scoreRecorded = false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const dir = KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (dir) {
        event.preventDefault();
        steer(state, dir);
      } else if ((event.key === ' ' || event.key === 'Enter') && state.phase === 'over') {
        event.preventDefault();
        restart();
      }
    };
    const onDown = () => {
      if (state.phase === 'over') restart();
    };
    window.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointerdown', onDown);

    let frame = 0;
    let last = performance.now();
    const loop = (time: number) => {
      // Cap the step so a background tab doesn't fast-forward the round.
      const dt = Math.min((time - last) / 1000, 0.25);
      last = time;
      step(state, dt);
      if (state.phase === 'over' && !scoreRecorded) {
        recordScore(lightCycles.id, state.score);
        scoreRecorded = true;
      }
      draw(ctx, state);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('pointerdown', onDown);
    };
  },
};

export default lightCycles;
