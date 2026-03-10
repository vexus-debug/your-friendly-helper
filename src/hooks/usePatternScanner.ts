import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTickers, fetchKlines } from '@/lib/bybit-api';
import { detectCandlestickPatterns, type CandlestickPattern } from '@/lib/candlestick-patterns';
import { detectChartPatterns, type ChartPattern } from '@/lib/chart-patterns';
import { detectMarketStructure, type MarketStructureEvent } from '@/lib/market-structure';
import type { Timeframe } from '@/types/scanner';
import { TIMEFRAME_LABELS } from '@/types/scanner';

const SCAN_TIMEFRAMES: Timeframe[] = ['5', '15', '60', '240', 'D', 'W'];
const TOP_SYMBOLS = 50;
const MAX_OLD_PATTERNS = 10;
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface DetectedPattern {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  pattern: CandlestickPattern | ChartPattern | MarketStructureEvent;
  price: number;
  detectedAt: number;
  category: 'candlestick' | 'chart' | 'structure';
}

export interface PatternGroup {
  timeframe: Timeframe;
  label: string;
  patterns: DetectedPattern[];
}

export function usePatternScanner() {
  const [candlestickPatterns, setCandlestickPatterns] = useState<DetectedPattern[]>([]);
  const [chartPatterns, setChartPatterns] = useState<DetectedPattern[]>([]);
  const [structurePatterns, setStructurePatterns] = useState<DetectedPattern[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<number>(0);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const scanningRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const mergePatterns = (
    prev: DetectedPattern[],
    newPatterns: DetectedPattern[],
  ): DetectedPattern[] => {
    // Deduplicate by id; keep new ones + up to MAX_OLD_PATTERNS old ones
    const newIds = new Set(newPatterns.map(p => p.id));
    const old = prev.filter(p => !newIds.has(p.id)).slice(0, MAX_OLD_PATTERNS);
    return [...newPatterns, ...old];
  };

  const runScan = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);

    try {
      // Fetch top symbols
      const categories: ('spot' | 'linear')[] = ['linear', 'spot'];
      const symbolMap = new Map<string, { symbol: string; category: 'spot' | 'linear'; price: number }>();

      for (const cat of categories) {
        try {
          const tickerData = await fetchTickers(cat);
          if (tickerData.retCode === 0 && tickerData.result?.list) {
            const sorted = tickerData.result.list
              .filter(t => t.symbol.endsWith('USDT'))
              .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
              .slice(0, TOP_SYMBOLS);
            for (const t of sorted) {
              if (!symbolMap.has(t.symbol) || cat === 'linear') {
                symbolMap.set(t.symbol, { symbol: t.symbol, category: cat, price: parseFloat(t.lastPrice) });
              }
            }
          }
        } catch { /* skip */ }
      }

      const symbols = Array.from(symbolMap.values());
      const totalOps = symbols.length * SCAN_TIMEFRAMES.length;
      setScanProgress({ current: 0, total: totalOps });

      const newCandlestick: DetectedPattern[] = [];
      const newChart: DetectedPattern[] = [];
      const newStructure: DetectedPattern[] = [];
      let progress = 0;

      const BATCH_SIZE = 3;
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const batch = symbols.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async ({ symbol, category, price }) => {
          for (const tf of SCAN_TIMEFRAMES) {
            try {
              const candles = await fetchKlines(symbol, tf, category);
              if (candles.length < 20) { progress++; continue; }

              const now = Date.now();
              const sym = symbol.replace('USDT', '');

              // Candlestick patterns
              const cPatterns = detectCandlestickPatterns(candles);
              for (const p of cPatterns) {
                newCandlestick.push({
                  id: `cs-${symbol}-${tf}-${p.name}-${now}`,
                  symbol: sym, timeframe: tf, pattern: p, price, detectedAt: now, category: 'candlestick',
                });
              }

              // Chart patterns
              const chPatterns = detectChartPatterns(candles);
              for (const p of chPatterns) {
                newChart.push({
                  id: `ch-${symbol}-${tf}-${p.name}-${now}`,
                  symbol: sym, timeframe: tf, pattern: p, price, detectedAt: now, category: 'chart',
                });
              }

              // Market structure
              const msEvents = detectMarketStructure(candles);
              for (const p of msEvents) {
                newStructure.push({
                  id: `ms-${symbol}-${tf}-${p.name}-${now}`,
                  symbol: sym, timeframe: tf, pattern: p, price, detectedAt: now, category: 'structure',
                });
              }
            } catch { /* skip */ }
            progress++;
            setScanProgress({ current: progress, total: totalOps });
          }
        }));

        if (i + BATCH_SIZE < symbols.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      setCandlestickPatterns(prev => mergePatterns(prev, newCandlestick));
      setChartPatterns(prev => mergePatterns(prev, newChart));
      setStructurePatterns(prev => mergePatterns(prev, newStructure));
      setLastScanTime(Date.now());
    } catch (err) {
      console.error('Pattern scan error:', err);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    runScan();
    intervalRef.current = setInterval(runScan, SCAN_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [runScan]);

  const groupByTimeframe = (patterns: DetectedPattern[]): PatternGroup[] => {
    const groups: PatternGroup[] = [];
    for (const tf of SCAN_TIMEFRAMES) {
      const tfPatterns = patterns.filter(p => p.timeframe === tf);
      if (tfPatterns.length > 0) {
        groups.push({ timeframe: tf, label: TIMEFRAME_LABELS[tf], patterns: tfPatterns });
      }
    }
    return groups;
  };

  return {
    candlestickPatterns,
    chartPatterns,
    structurePatterns,
    candlestickGroups: groupByTimeframe(candlestickPatterns),
    chartGroups: groupByTimeframe(chartPatterns),
    structureGroups: groupByTimeframe(structurePatterns),
    scanning,
    lastScanTime,
    scanProgress,
    runScan,
  };
}
