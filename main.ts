// Launch-rider for the Pump.fun Paper Sprint: buy coins in their first minutes,
// exit fast on take-profit / stop / trailing stop / max hold.
//
// Run by the grader as `node /bot/main.ts` (Node 22 strips the types; no build,
// no install). The SDK shim is vendored beside it (vendor/makefun-bot.ts is a
// byte-identical copy of the kit's sdk/ts/makefun-bot.ts).

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot({
  onBatch: createStrategy(DEFAULT_PARAMS),
});
