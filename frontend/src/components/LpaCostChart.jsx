import { useMemo } from "react";
import { motion } from "framer-motion";
import { TrendUp, CurrencyDollarSimple } from "@phosphor-icons/react";

/**
 * LPA cost visualization.
 * Demonstrates how batching N records into one Merkle anchor amortizes the on-chain
 * gas cost across all leaves — per-record cost drops as the batch grows.
 *
 * Numbers are illustrative (Ethereum L1 typical gas price). Adjust GAS_PER_TX
 * and ETH_PRICE_PHP for your thesis defense narrative.
 */
const GAS_PER_TX = 80000;         // ~80k gas for a small Merkle-root write
const GWEI = 20;                  // 20 gwei avg
const ETH_PRICE_PHP = 215_000;    // 1 ETH in PHP (rough)

function txCostPHP() {
  const eth = (GAS_PER_TX * GWEI) / 1e9;
  return eth * ETH_PRICE_PHP;
}

export default function LpaCostChart({ batchSize = 0, totalAnchored = 0 }) {
  const txPHP = txCostPHP();

  const milestones = [1, 5, 10, 25, 50, 100, 250, 500];

  const data = useMemo(() => milestones.map((n) => ({
    n,
    perRecordNoLpa: txPHP,
    perRecordWithLpa: txPHP / n,
    savings: ((1 - 1 / n) * 100).toFixed(1),
  })), [txPHP]);

  const currentCount = Math.max(batchSize, 1);
  const currentPerRecord = txPHP / currentCount;
  const currentSavingsPct = ((1 - 1 / currentCount) * 100).toFixed(1);

  const maxBarHeight = 160;
  const maxValue = Math.max(...data.map((d) => d.perRecordNoLpa));

  return (
    <div className="card-modern p-6">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
        <div>
          <div className="eyebrow">cost amortization // gas savings</div>
          <h3 className="heading-display text-2xl font-bold mt-1">More records, lower per-record cost</h3>
          <p className="text-zinc-400 text-sm mt-2 max-w-2xl">
            Every Merkle anchor is <span className="text-sky-300 font-medium">one on-chain transaction</span> regardless of how many records it contains. With Layered Proof Aggregation, gas cost is amortized — adding more records pushes the per-record cost asymptotically toward zero.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="rounded-lg border border-sky-400/30 bg-sky-500/5 px-4 py-3 min-w-[140px]">
            <div className="eyebrow flex items-center gap-1 text-sky-300"><CurrencyDollarSimple size={11} weight="bold" /> tx cost</div>
            <div className="font-display text-2xl font-bold text-sky-300 mt-1">₱{txPHP.toFixed(2)}</div>
          </div>
          <div className="rounded-lg border border-amber/30 bg-amber/5 px-4 py-3 min-w-[140px]">
            <div className="eyebrow flex items-center gap-1 text-amber"><TrendUp size={11} weight="bold" /> per record now</div>
            <div className="font-display text-2xl font-bold text-amber mt-1">₱{currentPerRecord.toFixed(2)}</div>
            <div className="text-[10px] font-mono text-zinc-500 mt-0.5">batch: {batchSize} pending</div>
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="mt-8 rounded-lg border border-white/5 bg-zinc-900/40 p-5">
        <div className="flex items-end justify-between gap-3" style={{ height: `${maxBarHeight + 60}px` }}>
          {data.map((d, i) => {
            const lpaH = Math.max(4, (d.perRecordWithLpa / maxValue) * maxBarHeight);
            const noLpaH = Math.max(8, (d.perRecordNoLpa / maxValue) * maxBarHeight);
            const isCurrent = batchSize >= d.n && (i === data.length - 1 || batchSize < (data[i + 1]?.n || Infinity));
            return (
              <div key={d.n} className="flex-1 flex flex-col items-center gap-1">
                <div className="flex items-end gap-1.5 h-[160px]">
                  <div className="flex flex-col items-center">
                    <motion.div
                      className="w-6 rounded-t-md bg-zinc-700"
                      initial={{ height: 0 }}
                      animate={{ height: noLpaH }}
                      transition={{ duration: 0.6, delay: i * 0.05 }}
                      title={`Without LPA: ₱${d.perRecordNoLpa.toFixed(2)} per record`}
                    />
                  </div>
                  <div className="flex flex-col items-center">
                    <motion.div
                      className={`w-6 rounded-t-md ${isCurrent ? "bg-gradient-to-t from-sky-500 to-sky-400 shadow-glow" : "bg-gradient-to-t from-sky-600/70 to-sky-400/70"}`}
                      initial={{ height: 0 }}
                      animate={{ height: lpaH }}
                      transition={{ duration: 0.6, delay: 0.1 + i * 0.05 }}
                      title={`With LPA: ₱${d.perRecordWithLpa.toFixed(2)} per record`}
                    />
                  </div>
                </div>
                <div className={`mt-2 font-mono text-[10px] ${isCurrent ? "text-sky-300 font-bold" : "text-zinc-400"}`}>
                  n={d.n}
                </div>
                <div className="font-mono text-[9px] text-zinc-500">{d.savings}% saved</div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-5 mt-6 text-[11px] font-mono text-zinc-400">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-zinc-700" /> without LPA (1 tx per record)</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-gradient-to-t from-sky-500 to-sky-400" /> with LPA (1 tx per batch)</div>
          <div className="ml-auto">Σ records anchored so far: <span className="text-sky-300 font-bold">{totalAnchored}</span></div>
        </div>
      </div>

      {/* Narrative cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        <div className="rounded-lg border border-white/5 bg-zinc-900/40 p-4">
          <div className="eyebrow">naive</div>
          <div className="mt-1 font-mono text-xs text-zinc-300">N records = N transactions = N × ₱{txPHP.toFixed(2)}</div>
        </div>
        <div className="rounded-lg border border-sky-400/30 bg-sky-500/5 p-4">
          <div className="eyebrow text-sky-300">with lpa</div>
          <div className="mt-1 font-mono text-xs text-zinc-200">N records = 1 transaction = ₱{txPHP.toFixed(2)} ÷ N</div>
        </div>
        <div className="rounded-lg border border-white/5 bg-zinc-900/40 p-4">
          <div className="eyebrow">current efficiency</div>
          <div className="mt-1 font-mono text-xs text-zinc-300">
            <span className="text-sky-300 font-bold">{currentSavingsPct}%</span> reduction in per-record gas cost at this batch size
          </div>
        </div>
      </div>

      <p className="text-[10px] text-zinc-600 font-mono mt-4">
        Illustrative pricing — assumes ~80,000 gas at 20 gwei and ₱215,000/ETH. Real costs vary with network congestion.
      </p>
    </div>
  );
}
