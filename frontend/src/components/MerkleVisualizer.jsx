import { motion } from "framer-motion";

export default function MerkleVisualizer({ layers, root }) {
  if (!layers || layers.length === 0) {
    return (
      <div className="card-modern p-10 text-center text-zinc-500 font-mono text-sm" data-testid="merkle-empty">
        nothing pending // queue is empty
      </div>
    );
  }
  const reversed = [...layers].reverse();
  const W = 900;
  const layerHeight = 80;
  const H = reversed.length * layerHeight + 40;

  return (
    <div className="card-modern p-5 overflow-x-auto" data-testid="merkle-visual">
      <div className="eyebrow mb-3">merkle preview // keccak256</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="min-w-[600px]">
        <defs>
          <linearGradient id="rootGlow" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {reversed.map((layer, li) => {
          const y = li * layerHeight + 30;
          const spacing = W / (layer.length + 1);
          return (
            <g key={li}>
              {layer.map((h, i) => {
                const x = spacing * (i + 1);
                const child = reversed[li + 1];
                let lines = null;
                if (child) {
                  const cs = W / (child.length + 1);
                  const lx = cs * (i * 2 + 1);
                  const rx = cs * (i * 2 + 2);
                  lines = (
                    <>
                      <line x1={x} y1={y + 8} x2={lx} y2={y + layerHeight - 8} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                      {i * 2 + 2 <= child.length && (
                        <line x1={x} y1={y + 8} x2={rx} y2={y + layerHeight - 8} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                      )}
                    </>
                  );
                }
                const isRoot = li === 0;
                return (
                  <g key={i}>
                    {lines}
                    <motion.circle
                      cx={x}
                      cy={y}
                      r={isRoot ? 11 : 6}
                      fill={isRoot ? "url(#rootGlow)" : "#0c0c10"}
                      stroke={isRoot ? "#34d399" : "rgba(255,255,255,0.15)"}
                      strokeWidth="1.5"
                      filter={isRoot ? "url(#glow)" : undefined}
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.35, delay: li * 0.08 + i * 0.02 }}
                    />
                    <text x={x} y={y - 14} textAnchor="middle" className="fill-zinc-400" fontSize="9.5" fontFamily="JetBrains Mono">
                      {h.slice(0, 8)}…
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {root && (
        <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
          <span className="eyebrow">root</span>
          <span className="crypto-text">{root}</span>
        </div>
      )}
    </div>
  );
}
