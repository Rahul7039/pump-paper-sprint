# Strategy: launch-rider

## What the dev window taught

Measured on the kit's frozen dev window (1,222 coins, 24h):

- A coin bought at its **first trade** hits +30% before −15% about half the time
  within ~4 minutes. A coin bought after it already ran +10–25% hits its stop
  far more often, and dip-buying after a run-up loses outright. **The edge is
  in being early, not in chasing strength.**
- The replay's mechanics tax that edge hard: a buy may spend at most 1% of a
  curve's real SOL per reply, fills land 2 slots after the decision, and every
  order pays 1.25% in curve fees plus a flat 0.000105 SOL tx fee. Pyramiding
  into strength and bigger first buys both tested worse — size only arrives
  after the price has already run.
- Completions are mostly instant (untradeable) and buying near completion
  (real SOL 30–70) has a median final return of 0.25–1.00x — no edge there.

## The bot

- **Entry:** only in a coin's first ~30 slots, one 0.01 SOL buy (the
  guardrail's minimum round-trip size), and only when the launch confirms
  itself: price already +5–10% over its very first trade, ≥2 distinct buyers,
  net SOL flow ≥ 0, creator has not sold.
- **Exits:** sell all on the first of +30% take-profit, −15% stop, a trailing
  stop once +15% up (10% give-back), a flow-reversal fade, or a 900-slot max
  hold. Cooldown 300 slots before the same coin may be bought again.
- **Guards:** stops opening new positions if equity ever falls 25% (guardrail
  is 50%). If the traded-coin count lags late in the window, entry filters
  relax so the 20-coin guardrail is met.

## Local grade (kit's own engine port, 4× 6h slices of the dev window)

| | |
|---|---|
| Net PnL | −0.017 SOL per 6h on average (slice range +0.004 to −0.032) |
| Trips / win rate | ~32 per 6h / 25% win |
| Coins traded | ~32 per 6h (guardrail: 20) |
| Max drawdown | 0.4% (guardrail: 50%) |

Essentially breakeven after fees on this window — where the kit's own
momentum pilot loses ~9 SOL and its reversion pilot ~1 SOL per 6h. The final
window is different data; these are flat, robust settings chosen across
~60 swept variants, not a fitted peak. No overfitting to any single slice:
every neighbouring parameter set lands within ±0.01 SOL per 6h of this one.
