import type { Candle } from '@/types/scanner';

export interface CandlestickPattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  significance: 'high' | 'medium' | 'low';
  candleIndex: number; // index in candles array where pattern ends
  description: string;
}

function bodySize(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function upperWick(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerWick(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

function range(c: Candle): number {
  return c.high - c.low;
}

function avgBody(candles: Candle[], lookback: number = 10): number {
  const slice = candles.slice(-lookback);
  return slice.reduce((s, c) => s + bodySize(c), 0) / slice.length;
}

export function detectCandlestickPatterns(candles: Candle[]): CandlestickPattern[] {
  if (candles.length < 5) return [];

  const patterns: CandlestickPattern[] = [];
  const len = candles.length;
  const avg = avgBody(candles, 14);

  // Only check last 3 candles for current patterns
  for (let i = Math.max(2, len - 3); i < len; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const prev2 = i >= 2 ? candles[i - 2] : null;
    const r = range(c);
    const body = bodySize(c);

    // === Single candle patterns ===

    // Doji
    if (body < r * 0.1 && r > 0) {
      patterns.push({ name: 'Doji', type: 'neutral', significance: 'medium', candleIndex: i, description: 'Indecision — open ≈ close' });
    }

    // Hammer (bullish reversal at bottom)
    if (lowerWick(c) > body * 2 && upperWick(c) < body * 0.5 && isBearish(prev)) {
      patterns.push({ name: 'Hammer', type: 'bullish', significance: 'high', candleIndex: i, description: 'Bullish reversal — long lower wick' });
    }

    // Inverted Hammer
    if (upperWick(c) > body * 2 && lowerWick(c) < body * 0.5 && isBearish(prev)) {
      patterns.push({ name: 'Inverted Hammer', type: 'bullish', significance: 'medium', candleIndex: i, description: 'Potential bullish reversal after downtrend' });
    }

    // Shooting Star (bearish reversal at top)
    if (upperWick(c) > body * 2 && lowerWick(c) < body * 0.5 && isBullish(prev)) {
      patterns.push({ name: 'Shooting Star', type: 'bearish', significance: 'high', candleIndex: i, description: 'Bearish reversal — long upper wick at top' });
    }

    // Hanging Man
    if (lowerWick(c) > body * 2 && upperWick(c) < body * 0.5 && isBullish(prev)) {
      patterns.push({ name: 'Hanging Man', type: 'bearish', significance: 'medium', candleIndex: i, description: 'Bearish reversal at top of uptrend' });
    }

    // Marubozu (strong momentum)
    if (body > avg * 1.5 && upperWick(c) < body * 0.05 && lowerWick(c) < body * 0.05) {
      patterns.push({
        name: isBullish(c) ? 'Bullish Marubozu' : 'Bearish Marubozu',
        type: isBullish(c) ? 'bullish' : 'bearish',
        significance: 'high',
        candleIndex: i,
        description: 'Strong momentum — no wicks',
      });
    }

    // Spinning Top
    if (body < r * 0.3 && upperWick(c) > body && lowerWick(c) > body && r > avg * 0.5) {
      patterns.push({ name: 'Spinning Top', type: 'neutral', significance: 'low', candleIndex: i, description: 'Indecision with equal wicks' });
    }

    // === Two candle patterns ===

    // Bullish Engulfing
    if (isBullish(c) && isBearish(prev) && c.open <= prev.close && c.close >= prev.open && body > bodySize(prev)) {
      patterns.push({ name: 'Bullish Engulfing', type: 'bullish', significance: 'high', candleIndex: i, description: 'Bull candle engulfs prior bear candle' });
    }

    // Bearish Engulfing
    if (isBearish(c) && isBullish(prev) && c.open >= prev.close && c.close <= prev.open && body > bodySize(prev)) {
      patterns.push({ name: 'Bearish Engulfing', type: 'bearish', significance: 'high', candleIndex: i, description: 'Bear candle engulfs prior bull candle' });
    }

    // Piercing Line
    if (isBullish(c) && isBearish(prev) && c.open < prev.low && c.close > (prev.open + prev.close) / 2 && c.close < prev.open) {
      patterns.push({ name: 'Piercing Line', type: 'bullish', significance: 'medium', candleIndex: i, description: 'Bull candle closes above midpoint of prior bear' });
    }

    // Dark Cloud Cover
    if (isBearish(c) && isBullish(prev) && c.open > prev.high && c.close < (prev.open + prev.close) / 2 && c.close > prev.open) {
      patterns.push({ name: 'Dark Cloud Cover', type: 'bearish', significance: 'medium', candleIndex: i, description: 'Bear candle closes below midpoint of prior bull' });
    }

    // Tweezer Bottom
    if (isBullish(c) && isBearish(prev) && Math.abs(c.low - prev.low) / avg < 0.05) {
      patterns.push({ name: 'Tweezer Bottom', type: 'bullish', significance: 'medium', candleIndex: i, description: 'Equal lows — potential reversal up' });
    }

    // Tweezer Top
    if (isBearish(c) && isBullish(prev) && Math.abs(c.high - prev.high) / avg < 0.05) {
      patterns.push({ name: 'Tweezer Top', type: 'bearish', significance: 'medium', candleIndex: i, description: 'Equal highs — potential reversal down' });
    }

    // === Three candle patterns ===
    if (prev2) {
      // Morning Star
      if (isBearish(prev2) && bodySize(prev) < avg * 0.3 && isBullish(c) && c.close > (prev2.open + prev2.close) / 2) {
        patterns.push({ name: 'Morning Star', type: 'bullish', significance: 'high', candleIndex: i, description: 'Three-candle bullish reversal' });
      }

      // Evening Star
      if (isBullish(prev2) && bodySize(prev) < avg * 0.3 && isBearish(c) && c.close < (prev2.open + prev2.close) / 2) {
        patterns.push({ name: 'Evening Star', type: 'bearish', significance: 'high', candleIndex: i, description: 'Three-candle bearish reversal' });
      }

      // Three White Soldiers
      if (isBullish(prev2) && isBullish(prev) && isBullish(c) &&
        prev.close > prev2.close && c.close > prev.close &&
        bodySize(prev2) > avg * 0.5 && bodySize(prev) > avg * 0.5 && body > avg * 0.5) {
        patterns.push({ name: 'Three White Soldiers', type: 'bullish', significance: 'high', candleIndex: i, description: 'Three consecutive strong bull candles' });
      }

      // Three Black Crows
      if (isBearish(prev2) && isBearish(prev) && isBearish(c) &&
        prev.close < prev2.close && c.close < prev.close &&
        bodySize(prev2) > avg * 0.5 && bodySize(prev) > avg * 0.5 && body > avg * 0.5) {
        patterns.push({ name: 'Three Black Crows', type: 'bearish', significance: 'high', candleIndex: i, description: 'Three consecutive strong bear candles' });
      }

      // Three Inside Up
      if (isBearish(prev2) && isBullish(prev) && prev.open > prev2.close && prev.close < prev2.open && isBullish(c) && c.close > prev2.open) {
        patterns.push({ name: 'Three Inside Up', type: 'bullish', significance: 'medium', candleIndex: i, description: 'Bullish harami confirmed by third candle' });
      }

      // Three Inside Down
      if (isBullish(prev2) && isBearish(prev) && prev.open < prev2.close && prev.close > prev2.open && isBearish(c) && c.close < prev2.open) {
        patterns.push({ name: 'Three Inside Down', type: 'bearish', significance: 'medium', candleIndex: i, description: 'Bearish harami confirmed by third candle' });
      }
    }
  }

  return patterns;
}
