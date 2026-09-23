// Realistic paper-trading execution model.
//
// Market orders are filled by walking the opposite side of the real order book
// (when one is available) and charging a taker fee. Without a book we fall back
// to a configurable slippage on the reference price. This makes simulated fills
// behave like their live counterparts instead of filling at the exact mid.

export const DEFAULT_FEE_RATE = Number(process.env.NT_PAPER_FEE ?? 0.0005); // 5 bps taker
export const DEFAULT_SLIPPAGE_BPS = Number(process.env.NT_PAPER_SLIPPAGE_BPS ?? 2); // 2 bps

function levelsFor(book, side) {
  if (!book) return [];
  const rows = side === 'buy' ? book.asks : book.bids;
  return Array.isArray(rows) ? rows : [];
}

// Walk the book for `targetQty` and return the volume weighted average price.
// Returns { filled, cost, exhausted } where `exhausted` is true when the book
// could not satisfy the full size.
export function walkBook(levels, targetQty) {
  let filled = 0;
  let cost = 0;
  for (const level of levels) {
    const price = Number(level.price);
    const size = Number(level.size);
    if (!(price > 0) || !(size > 0)) continue;
    const take = Math.min(size, targetQty - filled);
    if (take <= 0) break;
    filled += take;
    cost += take * price;
    if (filled >= targetQty) break;
  }
  return { filled, cost, exhausted: filled < targetQty };
}

// Simulate a taker market order.
//   side: 'buy' | 'sell'
//   qty: base-asset quantity to fill (optional)
//   notional: quote amount to deploy (used to derive qty when qty is omitted)
//   referencePrice: last/mark price
//   book: { bids, asks } real depth (optional)
export function simulateFill({
  side,
  qty,
  notional,
  referencePrice,
  book = null,
  feeRate = DEFAULT_FEE_RATE,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
} = {}) {
  const ref = Number(referencePrice);
  if (!(ref > 0)) throw new Error('referencePrice required');
  const targetQty = Number(qty) > 0 ? Number(qty) : Number(notional) > 0 ? Number(notional) / ref : 0;
  if (!(targetQty > 0)) throw new Error('qty or notional required');

  const slip = Number(slippageBps) / 10000;
  const levels = levelsFor(book, side);
  const walked = walkBook(levels, targetQty);

  let filledQty = walked.filled;
  let cost = walked.cost;
  let slippageApplied = false;

  if (walked.exhausted) {
    const remaining = targetQty - filledQty;
    const fallbackPrice = side === 'buy' ? ref * (1 + slip) : ref * (1 - slip);
    cost += remaining * fallbackPrice;
    filledQty += remaining;
    slippageApplied = true;
  }

  const fillPrice = filledQty > 0 ? cost / filledQty : ref;
  const tradedNotional = filledQty * fillPrice;
  const fee = tradedNotional * Number(feeRate || 0);

  return {
    fillPrice,
    qty: filledQty,
    notional: tradedNotional,
    fee,
    feeRate: Number(feeRate || 0),
    slippageBps: walked.exhausted ? Number(slippageBps) : 0,
    source: levels.length ? (slippageApplied ? 'book+slippage' : 'book') : 'slippage',
  };
}

// Net PnL for a round trip, accounting for both fees.
export function roundTripPnl({ side, entryPrice, exitPrice, size, entryFee = 0, exitFee = 0 }) {
  const dir = side === 'long' ? 1 : -1;
  const gross = dir * (exitPrice - entryPrice) * size;
  return gross - entryFee - exitFee;
}
