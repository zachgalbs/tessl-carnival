# Light Cycles

Ride a glowing bumper-cycle round the fenced fairground arena, and outlast the
three other riders.

## How to play

- Your cycle is the gold one. It never stops, and it leaves a solid trail behind it.
- Steer with the arrow keys or WASD. Each press turns 90°; you can't stop or
  turn straight back.
- Three AI riders do the same. They steer away from crashes when they can and
  head for open space.
- Anyone who hits the fence or any trail, their own included, is out.
- The round ends when you crash or are the last rider left.
- Press space, Enter or click on the game over screen to ride again.

## Scoring

| What                                      | Points |
| ----------------------------------------- | ------ |
| Each tick you survive (12 ticks a second) | 1      |
| Each AI rider that crashes before you do  | 100    |
| Being the last rider left                 | 250    |

An AI rider that crashes on the same tick as you doesn't score. Your final
score is saved to the carnival's score board when the round ends.

## Files

- `game.ts`: the game logic (`createState`, `steer`, `tick`, `step`,
  `chooseDirection`) and the `lightCycles` entry, the default export the midway
  finds.
- `game.test.ts`: tests for the game logic.
