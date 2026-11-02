import { describe, expect, it } from 'vitest';
import {
  COLS,
  POINTS_LAST_RIDER,
  POINTS_PER_RIVAL_OUT,
  POINTS_PER_TICK,
  TICK_RATE,
  chooseDirection,
  createState,
  isOpen,
  steer,
  step,
  tick,
} from './game';

/** Takes every AI rider out of the round. */
function withRivalsOut(state = createState()) {
  for (const rider of state.riders.slice(1)) rider.alive = false;
  return state;
}

describe('light cycles', () => {
  it('starts with four riders, no score and their first trail cells laid', () => {
    const state = createState();
    expect(state.riders).toHaveLength(4);
    expect(state.riders.every((r) => r.alive)).toBe(true);
    expect(state.score).toBe(0);
    expect(state.phase).toBe('playing');
    for (const rider of state.riders) expect(isOpen(state, rider.x, rider.y)).toBe(false);
  });

  it('scores a point for each tick survived and leaves a trail behind', () => {
    const state = createState();
    const { x, y } = state.riders[0];
    tick(state);
    tick(state);
    expect(state.score).toBe(2 * POINTS_PER_TICK);
    expect(state.riders[0]).toMatchObject({ x: x + 2, y });
    expect(isOpen(state, x + 1, y)).toBe(false);
  });

  it('turns 90 degrees and never reverses', () => {
    const state = createState();
    expect(steer(state, 'left')).toBe(false);
    expect(steer(state, 'right')).toBe(false);
    expect(steer(state, 'up')).toBe(true);
    tick(state);
    expect(state.riders[0].dir).toBe('up');
  });

  it('does not let two quick turns add up to a reverse', () => {
    const state = createState();
    expect(steer(state, 'up')).toBe(true);
    expect(steer(state, 'down')).toBe(false);
    expect(steer(state, 'left')).toBe(true);
  });

  it('ticks at the tick rate as time passes', () => {
    const state = createState();
    step(state, 3 / TICK_RATE + 0.001);
    expect(state.ticks).toBe(3);
  });

  it('ends the round when the player hits the fence', () => {
    const state = withRivalsOut();
    Object.assign(state.riders[0], { x: COLS - 1, y: 5, dir: 'right' });
    tick(state);
    expect(state.riders[0].alive).toBe(false);
    expect(state.phase).toBe('over');
  });

  it('crashes a rider into its own trail', () => {
    const state = createState();
    const { x, y } = state.riders[0];
    tick(state);
    steer(state, 'up');
    tick(state);
    steer(state, 'left');
    tick(state);
    expect(state.riders[0]).toMatchObject({ x, y: y - 1 });
    expect(state.riders[0].alive).toBe(true);
    steer(state, 'down');
    tick(state);
    expect(state.riders[0].alive).toBe(false);
    expect(state.phase).toBe('over');
  });

  it('scores 100 for each rival that crashes first', () => {
    const state = createState();
    const rival = state.riders[1];
    // Box the rival in against the fence so every move crashes.
    Object.assign(rival, { x: COLS - 1, y: 0, dir: 'right' });
    state.trails[1 * COLS + COLS - 1] = 1;
    state.trails[COLS - 2] = 1;
    tick(state);
    expect(rival.alive).toBe(false);
    expect(state.score).toBe(POINTS_PER_TICK + POINTS_PER_RIVAL_OUT);
    expect(state.phase).toBe('playing');
  });

  it('gives no rival points when the player crashes on the same tick', () => {
    const state = createState();
    Object.assign(state.riders[0], { x: 0, y: 5, dir: 'left' });
    const rival = state.riders[1];
    Object.assign(rival, { x: COLS - 1, y: 0, dir: 'right' });
    state.trails[1 * COLS + COLS - 1] = 1;
    state.trails[COLS - 2] = 1;
    tick(state);
    expect(rival.alive).toBe(false);
    expect(state.phase).toBe('over');
    expect(state.score).toBe(0);
  });

  it('scores 250 and ends the round when the player is the last rider left', () => {
    const state = createState();
    state.riders[2].alive = false;
    state.riders[3].alive = false;
    const rival = state.riders[1];
    Object.assign(rival, { x: COLS - 1, y: 0, dir: 'right' });
    state.trails[1 * COLS + COLS - 1] = 1;
    state.trails[COLS - 2] = 1;
    tick(state);
    expect(state.phase).toBe('over');
    expect(state.score).toBe(POINTS_PER_TICK + POINTS_PER_RIVAL_OUT + POINTS_LAST_RIDER);
  });

  it('steers an AI rider away from the fence', () => {
    const state = createState();
    Object.assign(state.riders[1], { x: 0, y: 10, dir: 'left' });
    expect(['up', 'down']).toContain(chooseDirection(state, 1));
  });

  it('steers an AI rider towards the open side, away from a dead end', () => {
    const state = withRivalsOut();
    // A wall across the arena at row 10, open only above it on the right.
    for (let x = 0; x < COLS; x++) state.trails[10 * COLS + x] = 1;
    for (let y = 0; y < 10; y++) state.trails[y * COLS + 30] = 1;
    state.riders[2].alive = true;
    Object.assign(state.riders[2], { x: 31, y: 5, dir: 'up' });
    // Left is blocked by the wall at x 30; right leads to the big open area.
    expect(chooseDirection(state, 2)).not.toBe('left');
    Object.assign(state.riders[2], { x: 29, y: 5, dir: 'up' });
    expect(['left', 'up']).toContain(chooseDirection(state, 2));
  });

  it('keeps AI riders alive for a while in an open arena', () => {
    const state = createState();
    // Ride only the AI riders, so the round can't end on the player.
    state.riders[0].alive = false;
    for (let i = 0; i < 60; i++) {
      state.riders.forEach((rider, j) => {
        if (j > 0 && rider.alive) rider.dir = chooseDirection(state, j);
      });
      for (const [j, rider] of state.riders.entries()) {
        if (j === 0 || !rider.alive) continue;
        const next = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[rider.dir];
        rider.x += next[0];
        rider.y += next[1];
        if (!isOpen(state, rider.x, rider.y)) rider.alive = false;
        else state.trails[rider.y * COLS + rider.x] = j + 1;
      }
    }
    expect(state.riders.slice(1).every((r) => r.alive)).toBe(true);
  });

  it('ignores steering once the round is over', () => {
    const state = createState();
    state.phase = 'over';
    expect(steer(state, 'up')).toBe(false);
  });
});
