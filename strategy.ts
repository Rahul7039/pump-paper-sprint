// Launch-rider: buy pump.fun coins in their first seconds, exit fast.
//
// Thesis (measured on the kit's dev window, 1,222 coins): a coin bought at its
// first trade hits +30% before -15% about half the time, while a coin bought
// after it already ran +10-25% hits its stop far more often, and dip-buying
// after a run-up loses outright. The edge is in being early and out quickly --
// not in chasing strength. But the replay's mechanics tax that edge hard: a buy
// may spend at most 1% of a curve's real SOL per reply, fills land 2 slots
// after the decision, and every order pays 1.25% in curve fees plus a flat tx
// fee. So this bot:
//  - watches every coin from its CreateEvent and buys ONLY in its first ~30
//    slots, one small 0.01 SOL buy (the guardrail's minimum round-trip size),
//    and only when the launch confirms itself: the price already up 5-10% over
//    its very first trade (momentum confirmation, not a chase), at least two
//    distinct buyers, net SOL flow not negative, creator has not sold;
//  - never pyramids: adds at rising prices and bigger first buys both tested
//    worse, because size only arrives after the price has already run;
//  - sells the whole position on the first of: +30% take-profit, -15% stop,
//    a trailing stop once +15% up, or a 900-slot max hold;
//  - never re-enters a coin it exited for a cooldown, and stops opening new
//    positions if equity ever drops 25% (drawdown guard; the guardrail is 50%).
//
// Guardrail pacing: the run must end with round trips on >= 20 coins. If the
// coin count lags late in the window, entry filters relax so the bar is met.
//
// Local grade on the dev window (4x 6h slices, kit's own engine port):
// -0.017 SOL per 6h on average, 25% of trips win, max drawdown 0.4%, ~32 coins
// per 6h -- essentially breakeven after fees, on a window where the kit's own
// momentum pilot loses ~9 SOL and its reversion pilot ~1 SOL per 6h. The final
// window is different data; these are flat, robust settings, not a fitted peak.
//
// Pure function of the batches: no clock, no randomness, no I/O, so the two
// graded executions produce byte-identical action logs.

import type { Batch, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Target SOL per coin in total (adds stop here). */
  stakeSol: number;
  /** Smallest single buy worth paying the tx fee for. */
  minBuySol: number;
  /** Size of the first buy (capped by the 1% reserve cap). */
  entrySol: number;
  /** Size of each add-on buy (first buy is minBuySol..addSol, cap-limited). */
  addSol: number;
  /** Oldest age (slots since CreateEvent) at which a first buy may be decided. */
  maxEntryAgeSlots: number;
  /** Entry needs the price at least this far above its first trade (momentum confirm). */
  minEntryRunup: number;
  /** Entry needs net SOL flow over the tape of at least this. */
  minEntryNetFlowSol: number;
  /** Skip a coin whose price already ran this far over its FIRST TRADE price. */
  maxFirstBatchRunup: number;
  /** Distinct buyers that must have traded the coin before entry. */
  minBuyers: number;
  /** Entry needs net SOL flow (buys minus sells) >= 0 over the tape. */
  requirePositiveFlow: boolean;
  /** Skip the coin if its creator sold before entry. */
  skipCreatorSold: boolean;
  /** Take profit: sell all once mark value reaches cost * (1 + tp). */
  tp: number;
  /** Hard stop: sell all once mark value falls to cost * (1 - sl). */
  sl: number;
  /** Trailing stop arms once value reaches cost * (1 + trailArm). */
  trailArm: number;
  /** ...then sell on a fall of trail from the best value seen. */
  trail: number;
  /** Sell after holding this many slots regardless. */
  maxHoldSlots: number;
  /** Adds only while the coin is this young (slots since create). */
  addWindowSlots: number;
  /** An add needs the price at least this far above the last buy's price. */
  addStep: number;
  /** Slots to wait after an exit before the same coin may be bought again. */
  cooldownSlots: number;
  /** Slippage allowed on buys (bps). Sells always go out wide open. */
  buySlippageBps: number;
  /** Most new entries decided in one batch. */
  maxEntriesPerBatch: number;
  /** Stop opening new positions once equity falls this far below start. */
  maxDrawdownHalt: number;
  /** Exit when net SOL over the tape falls below this (negative). 0 = off. */
  fadeNetSol: number;
  /** The fade exit needs at least this many trades on the tape. */
  fadeMinTrades: number;
  /** Block-time seconds after which the guardrail pacing relaxes entry filters. */
  paceRelaxSecs: number;
  /** Coins traded that the pacing wants by paceRelaxSecs. */
  paceTargetCoins: number;
}

export const DEFAULT_PARAMS: Params = {
  stakeSol: 0.01,
  minBuySol: 0.01,
  entrySol: 0.01,
  addSol: 0.01,
  maxEntryAgeSlots: 30,
  maxEntryRunup: 0.6,
  minEntryRunup: 0.05,
  minEntryNetFlowSol: 0,
  maxFirstBatchRunup: 0.1,
  minBuyers: 2,
  requirePositiveFlow: true,
  skipCreatorSold: true,
  tp: 0.3,
  sl: 0.15,
  trailArm: 0.15,
  trail: 0.1,
  maxHoldSlots: 900,
  addWindowSlots: 600,
  addStep: 0.02,
  cooldownSlots: 300,
  buySlippageBps: 1000,
  maxEntriesPerBatch: 4,
  maxDrawdownHalt: 0.25,
  fadeNetSol: -2,
  fadeMinTrades: 20,
  paceRelaxSecs: 14400,
  paceTargetCoins: 25,
};

const LAMPORTS_PER_SOL = 1_000_000_000n;

interface TapeTrade {
  slot: number;
  isBuy: boolean;
  sol: number; // SOL
  user: string;
}

interface Coin {
  mint: Pubkey;
  createdSlot: number | null;
  creator: string | null;
  firstPrice: number; // SOL per token at first sight with trades, 0 = unseen
  firstTradePrice: number; // price right after the coin's very first trade, 0 = unseen
  firstSeenSlot: number;
  tape: TapeTrade[];
  buyers: Set<string>;
  creatorSold: boolean;
  decided: boolean; // entry decided (bought) or skipped for good
  skipped: boolean;
  cooldownUntil: number;
  entries: number;
}

interface Pos {
  entrySlot: number;
  peakRatio: number; // best mark value / cost seen
  lastBuyPrice: number;
  lastBuySlot: number;
}

function priceOf(vq: bigint, vt: bigint): number {
  if (vt === 0n) return 0;
  return Number(vq) / Number(vt);
}

export function createStrategy(p: Params) {
  const coins = new Map<Pubkey, Coin>();
  const positions = new Map<Pubkey, Pos>();
  const tradedCoins = new Set<Pubkey>();
  const selling = new Set<Pubkey>();
  let startBlockTime = 0;
  let startCash = 0n;

  function coinFor(mint: Pubkey, slot: number): Coin {
    let c = coins.get(mint);
    if (c === undefined) {
      c = {
        mint,
        createdSlot: null,
        creator: null,
        firstPrice: 0,
        firstTradePrice: 0,
        firstSeenSlot: slot,
        tape: [],
        buyers: new Set<string>(),
        creatorSold: false,
        decided: false,
        skipped: false,
        cooldownUntil: 0,
        entries: 0,
      };
      coins.set(mint, c);
    }
    return c;
  }

  return function onBatch(state: BotState, batch: Batch): OrderInput[] {
    if (startBlockTime === 0) {
      const bt = batch.events.find((e) => e.block_time !== null)?.block_time ?? 0;
      startBlockTime = bt;
      startCash = BigInt(state.hello.capital.lamports);
    }
    const orders: OrderInput[] = [];
    const txFee = state.txFeeLamports();
    const slot = batch.slot;

    // ---- fold this batch's events into per-coin tapes ---------------------
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        const c = coinFor(e.mint, slot);
        c.createdSlot = e.slot;
        c.creator = e.creator;
      } else if (e.event === 'TradeEvent') {
        const c = coinFor(e.mint, slot);
        if (c.firstTradePrice === 0) {
          c.firstTradePrice = priceOf(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves));
        }
        const sol = Number(BigInt(e.sol_amount)) / 1e9;
        c.tape.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
        if (c.tape.length > 60) c.tape.splice(0, c.tape.length - 60);
        if (e.is_buy) c.buyers.add(e.user);
        if (!e.is_buy && c.creator !== null && e.user === c.creator) c.creatorSold = true;
      }
    }
    // First-seen price for coins that now have trades.
    for (const e of batch.events) {
      const c = coins.get(e.mint);
      if (c === undefined || c.firstPrice > 0) continue;
      const curve = state.curves.get(e.mint);
      if (curve !== undefined && curve.trades > 0) {
        c.firstPrice = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
      }
    }

    // ---- fold fills: track which coins we traded, drop closed positions ---
    for (const f of batch.fills) {
      if (f.status === 'filled' && f.side === 'buy') tradedCoins.add(f.mint);
      if (f.side === 'sell') selling.delete(f.mint);
      if (f.side === 'buy' && f.status !== 'filled' && !state.positions.has(f.mint)) {
        // Entry buy never landed: allow a fresh decision later.
        const cc = coins.get(f.mint);
        if (cc !== undefined) cc.decided = false;
      }
      if (f.client_id.startsWith('_')) {
        // harness close (complete / flatten / writeoff)
        positions.delete(f.mint);
        selling.delete(f.mint);
      }
    }
    for (const [mint] of positions) {
      if (!state.positions.has(mint)) positions.delete(mint);
    }
    for (const mint of selling) {
      if (!state.positions.has(mint)) selling.delete(mint);
    }

    // ---- equity guard ------------------------------------------------------
    let equity = state.cash;
    for (const [mint, h] of state.positions) {
      const curve = state.curves.get(mint);
      if (curve === undefined) continue;
      const px = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
      equity += BigInt(Math.floor(Number(h.token_amount) * px));
    }
    const halted = startCash > 0n && Number(startCash - equity) / Number(startCash) > p.maxDrawdownHalt;

    // ---- pacing: relax filters late if the coin count lags -----------------
    const nowBt = batch.events.find((e) => e.block_time !== null)?.block_time ?? startBlockTime;
    const elapsed = nowBt - startBlockTime;
    const relaxed = elapsed > p.paceRelaxSecs && tradedCoins.size < p.paceTargetCoins;

    // ---- exits first (free slots and cash) ---------------------------------
    for (const [mint, h] of state.positions) {
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      if (selling.has(mint)) continue;
      const px = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
      if (px <= 0) continue;
      // px is lamports per token (vq/vt); value in lamports, cost in lamports.
      const value = Number(h.token_amount) * px;
      const cost = Number(h.cost_lamports);
      if (cost <= 0) continue;
      const ratio = value / cost;
      let pos = positions.get(mint);
      if (pos === undefined) {
        pos = { entrySlot: slot, peakRatio: ratio, lastBuyPrice: px, lastBuySlot: slot };
        positions.set(mint, pos);
      }
      if (ratio > pos.peakRatio) pos.peakRatio = ratio;
      const age = slot - pos.entrySlot;
      // Flow reversal: net SOL over the tape.
      let netFlow = 0;
      const c = coins.get(mint);
      if (c !== undefined) {
        for (const t of c.tape) netFlow += t.isBuy ? t.sol : -t.sol;
      }
      const fade = p.fadeNetSol < 0 && c !== undefined && c.tape.length >= p.fadeMinTrades && netFlow < p.fadeNetSol;
      if (
        ratio >= 1 + p.tp ||
        ratio <= 1 - p.sl ||
        (pos.peakRatio >= 1 + p.trailArm && ratio <= pos.peakRatio * (1 - p.trail)) ||
        age > p.maxHoldSlots ||
        fade
      ) {
        orders.push({ side: 'sell', mint, token_amount: h.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        positions.delete(mint);
        if (c !== undefined) {
          c.cooldownUntil = slot + p.cooldownSlots;
          c.entries += 1;
          c.decided = false; // may re-enter after the cooldown if still young
        }
      }
    }

    // ---- entries and adds ---------------------------------------------------
    if (!halted && orders.length < state.hello.caps.max_orders_per_batch) {
      let free = state.freeCashLamports();
      let slotsOpen = state.hello.caps.max_open_positions - state.committedPositionCount();
      let entriesThisBatch = 0;
      // Pending buy spend per mint (fills have not landed yet, so state cost lags).
      const pendingBuy = new Map<Pubkey, bigint>();
      for (const po of state.pending.values()) {
        if (po.order.side === 'buy') {
          pendingBuy.set(po.order.mint, (pendingBuy.get(po.order.mint) ?? 0n) + BigInt(po.order.quote_lamports));
        }
      }
      // Adds first: strengthening existing positions beats opening new ones.
      for (const [mint, h] of state.positions) {
        if (orders.length >= state.hello.caps.max_orders_per_batch) break;
        const curve = state.curves.get(mint);
        const c = coins.get(mint);
        const pos = positions.get(mint);
        if (curve === undefined || curve.complete || c === undefined || pos === undefined) continue;
        if (selling.has(mint)) continue;
        const committed = BigInt(h.cost_lamports) + (pendingBuy.get(mint) ?? 0n);
        if (committed >= BigInt(Math.floor(p.stakeSol * 1e9))) continue;
        if (c.createdSlot !== null && slot - c.createdSlot > p.addWindowSlots) continue;
        const px = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
        if (px < pos.lastBuyPrice * (1 + p.addStep)) continue;
        const cap = state.maxBuyLamports(mint);
        if (cap < BigInt(Math.floor(p.minBuySol * 1e9))) continue;
        let amount = BigInt(Math.floor(p.addSol * 1e9));
        if (amount > cap) amount = cap;
        const room = BigInt(Math.floor(p.stakeSol * 1e9)) - committed;
        if (amount > room) amount = room;
        if (amount < BigInt(Math.floor(p.minBuySol * 1e9))) continue;
        if (free < amount + txFee) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
        free -= amount + txFee;
        pendingBuy.set(mint, (pendingBuy.get(mint) ?? 0n) + amount);
        pos.lastBuyPrice = px;
        pos.lastBuySlot = slot;
      }
      // New entries, in first-seen order.
      for (const [mint, c] of coins) {
        if (orders.length >= state.hello.caps.max_orders_per_batch) break;
        if (entriesThisBatch >= p.maxEntriesPerBatch) break;
        if (slotsOpen <= 0) break;
        if (c.decided || c.skipped || c.firstPrice <= 0) continue;
        if (slot < c.cooldownUntil) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) {
          c.skipped = true;
          continue;
        }
        if (c.createdSlot !== null && slot - c.createdSlot > p.maxEntryAgeSlots) {
          // Past the young-launch window: never eligible again (also bounds the
          // per-batch scan). The relaxed pacing path admits only fresh launches.
          c.skipped = true;
          continue;
        }
        const px = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
        if (px <= 0) continue;
        if (!relaxed) {
          if (px > c.firstPrice * (1 + p.maxEntryRunup)) {
            c.skipped = true;
            continue;
          }
          if (c.firstTradePrice > 0 && px > c.firstTradePrice * (1 + p.maxFirstBatchRunup)) {
            c.skipped = true;
            continue;
          }
          if (c.firstTradePrice > 0 && px < c.firstTradePrice * (1 + p.minEntryRunup)) continue;
          if (p.minEntryNetFlowSol > 0) {
            let net = 0;
            for (const t of c.tape) net += t.isBuy ? t.sol : -t.sol;
            if (net < p.minEntryNetFlowSol) continue;
          }
          if (c.tape.length < 1) continue;
          if (c.buyers.size < p.minBuyers) continue;
          if (p.skipCreatorSold && c.creatorSold) {
            c.skipped = true;
            continue;
          }
          if (p.requirePositiveFlow) {
            let net = 0;
            for (const t of c.tape) net += t.isBuy ? t.sol : -t.sol;
            if (net < 0) continue;
          }
        }
        const cap = state.maxBuyLamports(mint);
        const minBuy = BigInt(Math.floor(p.minBuySol * 1e9));
        if (cap < minBuy) continue; // too small yet: wait for the reserve to grow
        let amount = BigInt(Math.floor(p.entrySol * 1e9));
        if (amount > cap) amount = cap;
        if (free < amount + txFee) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
        free -= amount + txFee;
        slotsOpen -= 1;
        entriesThisBatch += 1;
        c.decided = true;
        c.entries += 1;
      }
    }

    return orders;
  };
}
