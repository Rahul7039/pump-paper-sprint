# pump-paper-sprint

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/Rahul7039/pump-paper-sprint/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/Rahul7039/pump-paper-sprint/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A launch-rider bot for make.fun's Pump.fun Paper Sprint: it paper-trades pump.fun bonding curves on a 6-hour replay, ranked by pure net PnL. It buys coins only in their first ~30 slots, one small 0.01 SOL buy per coin, and only when the launch confirms itself (price up 5–10% over its first trade, at least two distinct buyers, net flow not negative, creator has not sold) — then exits fast on a +30% take-profit, −15% stop, trailing stop, or a 900-slot max hold. No pyramiding, no chasing: on the dev window it lands essentially breakeven after fees with a 0.4% max drawdown, on a window where the kit's own momentum pilot loses ~9 SOL.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=ggys4frk&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
