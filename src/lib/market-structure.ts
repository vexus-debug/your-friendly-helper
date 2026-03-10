import type { Candle } from '@/types/scanner';

export interface MarketStructureEvent {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  significance: 'high' | 'medium' | 'low';
  description: string;
  candleIndex: number;
  price: number;
  zone?: { high: number; low: number }; // for FVG / OB
}

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
}

function findSwings(candles: Candle[], lookback: number = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) points.push({ index: i, price: candles[i].high, type: 'high' });
    if (isLow) points.push({ index: i, price: candles[i].low, type: 'low' });
  }
  return points;
}

export function detectMarketStructure(candles: Candle[]): MarketStructureEvent[] {
  if (candles.length < 20) return [];

  const events: MarketStructureEvent[] = [];
  const swings = findSwings(candles, 3);
  const highs = swings.filter(s => s.type === 'high');
  const lows = swings.filter(s => s.type === 'low');

  // === Break of Structure (BOS) ===
  // Bullish BOS: price breaks above a previous swing high
  for (let i = 1; i < highs.length; i++) {
    const prevHigh = highs[i - 1];
    // Check if any candle after this swing high breaks above it
    for (let j = prevHigh.index + 1; j < candles.length; j++) {
      if (candles[j].close > prevHigh.price) {
        // Only report if it's recent (last 5 candles)
        if (j >= candles.length - 5) {
          events.push({
            name: 'Bullish BOS',
            type: 'bullish',
            significance: 'high',
            description: `Break above swing high $${prevHigh.price.toPrecision(5)} — structure shift up`,
            candleIndex: j,
            price: prevHigh.price,
          });
        }
        break;
      }
    }
  }

  // Bearish BOS: price breaks below a previous swing low
  for (let i = 1; i < lows.length; i++) {
    const prevLow = lows[i - 1];
    for (let j = prevLow.index + 1; j < candles.length; j++) {
      if (candles[j].close < prevLow.price) {
        if (j >= candles.length - 5) {
          events.push({
            name: 'Bearish BOS',
            type: 'bearish',
            significance: 'high',
            description: `Break below swing low $${prevLow.price.toPrecision(5)} — structure shift down`,
            candleIndex: j,
            price: prevLow.price,
          });
        }
        break;
      }
    }
  }

  // === Change of Character (CHoCH) ===
  // Bullish CHoCH: After a series of LH/LL, price makes a HH
  if (highs.length >= 3) {
    const last3 = highs.slice(-3);
    // Was making lower highs, now makes higher high
    if (last3[1].price < last3[0].price && last3[2].price > last3[1].price) {
      events.push({
        name: 'Bullish CHoCH',
        type: 'bullish',
        significance: 'high',
        description: 'Change of character — first higher high after downtrend',
        candleIndex: last3[2].index,
        price: last3[2].price,
      });
    }
  }

  if (lows.length >= 3) {
    const last3 = lows.slice(-3);
    // Was making higher lows, now makes lower low
    if (last3[1].price > last3[0].price && last3[2].price < last3[1].price) {
      events.push({
        name: 'Bearish CHoCH',
        type: 'bearish',
        significance: 'high',
        description: 'Change of character — first lower low after uptrend',
        candleIndex: last3[2].index,
        price: last3[2].price,
      });
    }
  }

  // === Fair Value Gaps (FVG) ===
  // Check last 20 candles
  const fvgStart = Math.max(1, candles.length - 20);
  for (let i = fvgStart; i < candles.length - 1; i++) {
    const c0 = candles[i - 1]; // first candle
    const c2 = candles[i + 1]; // third candle

    // Bullish FVG: gap between candle 1 high and candle 3 low
    if (c2.low > c0.high) {
      events.push({
        name: 'Bullish FVG',
        type: 'bullish',
        significance: 'medium',
        description: `Gap $${c0.high.toPrecision(5)} → $${c2.low.toPrecision(5)} unfilled`,
        candleIndex: i,
        price: (c0.high + c2.low) / 2,
        zone: { high: c2.low, low: c0.high },
      });
    }

    // Bearish FVG: gap between candle 1 low and candle 3 high
    if (c2.high < c0.low) {
      events.push({
        name: 'Bearish FVG',
        type: 'bearish',
        significance: 'medium',
        description: `Gap $${c2.high.toPrecision(5)} → $${c0.low.toPrecision(5)} unfilled`,
        candleIndex: i,
        price: (c0.low + c2.high) / 2,
        zone: { high: c0.low, low: c2.high },
      });
    }
  }

  // === Order Blocks ===
  // Bullish OB: last bearish candle before a strong up move
  for (let i = Math.max(1, candles.length - 15); i < candles.length - 2; i++) {
    const c = candles[i];
    const next = candles[i + 1];
    const next2 = candles[i + 2];

    // Bullish OB: bearish candle followed by strong bullish move
    if (c.close < c.open && next.close > c.high && next2.close > next.close) {
      events.push({
        name: 'Bullish Order Block',
        type: 'bullish',
        significance: 'high',
        description: `Demand zone $${c.low.toPrecision(5)} – $${c.high.toPrecision(5)}`,
        candleIndex: i,
        price: c.low,
        zone: { high: c.high, low: c.low },
      });
    }

    // Bearish OB: bullish candle followed by strong bearish move
    if (c.close > c.open && next.close < c.low && next2.close < next.close) {
      events.push({
        name: 'Bearish Order Block',
        type: 'bearish',
        significance: 'high',
        description: `Supply zone $${c.low.toPrecision(5)} – $${c.high.toPrecision(5)}`,
        candleIndex: i,
        price: c.high,
        zone: { high: c.high, low: c.low },
      });
    }
  }

  // === Equal Highs / Equal Lows (liquidity pools) ===
  if (highs.length >= 2) {
    const last2H = highs.slice(-2);
    const diff = Math.abs(last2H[0].price - last2H[1].price) / last2H[0].price * 100;
    if (diff < 0.3) {
      events.push({
        name: 'Equal Highs (Liquidity)',
        type: 'bearish',
        significance: 'medium',
        description: `Liquidity resting above ~$${last2H[0].price.toPrecision(5)}`,
        candleIndex: last2H[1].index,
        price: last2H[1].price,
      });
    }
  }

  if (lows.length >= 2) {
    const last2L = lows.slice(-2);
    const diff = Math.abs(last2L[0].price - last2L[1].price) / last2L[0].price * 100;
    if (diff < 0.3) {
      events.push({
        name: 'Equal Lows (Liquidity)',
        type: 'bullish',
        significance: 'medium',
        description: `Liquidity resting below ~$${last2L[0].price.toPrecision(5)}`,
        candleIndex: last2L[1].index,
        price: last2L[1].price,
      });
    }
  }

  return events;
}
