import { motion } from "framer-motion";

/**
 * Renders a simple SVG visualization of a keccak256 Merkle tree.
 * Props: layers = [[hash0, hash1, ...], [parent0, ...], ..., [root]]
 */
export default function MerkleVisualizer({ layers, root }) {
  if (!layers || layers.length === 0) {
    return (
      <div className="border border-zinc-800 bg-[#0c0c0e] p-8 text-center text-zinc-500 font-mono text-sm" data-testid="merkle-empty">
        no leaves :: nothing pending
      </div>
    );
  }
  // We'll draw top-down. Largest layer at bottom.
  const reversed = [...layers].reverse(); // root first
  const W = 900;
  const layerHeight = 70;
  const H = reversed.length * layerHeight + 40;

  return (
    <div className="border border-zinc-800 bg-[#0c0c0e] p-4 overflow-x-auto" data-testid="merkle-visual">
      <div className="label-eyebrow mb-3">merkle preview :: keccak256</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="min-w-[600px]">
        {reversed.map((layer, li) => {
          const y = li * layerHeight + 30;
          const spacing = W / (layer.length + 1);
          return (
            <g key={li}>
              {layer.map((h, i) => {
                const x = spacing * (i + 1);
                // draw lines to children in next layer
                const childLayer = reversed[li + 1];
                let lines = null;
                if (childLayer) {
                  const cs = W / (childLayer.length + 1);
                  const left = cs * (i * 2 + 1);
                  const right = cs * (i * 2 + 2);
                  lines = (
                    <>
                      <line x1={x} y1={y + 8} x2={left} y2={y + layerHeight - 8} stroke="#27272a" strokeWidth="1" />
                      {i * 2 + 2 <= childLayer.length && (
                        <line x1={x} y1={y + 8} x2={right} y2={y + layerHeight - 8} stroke="#27272a" strokeWidth="1" />
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
                      r={isRoot ? 9 : 5}
                      fill={isRoot ? "#00FF41" : "#0c0c0e"}
                      stroke={isRoot ? "#00FF41" : "#3f3f46"}
                      strokeWidth="1.5"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3, delay: li * 0.1 + i * 0.02 }}
                    />
                    <text x={x} y={y - 12} textAnchor="middle" className="fill-zinc-500" fontSize="9" fontFamily="IBM Plex Mono">
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
        <div className="mt-3 flex gap-2 items-center">
          <span className="label-eyebrow">root</span>
          <span className="crypto-text">{root}</span>
        </div>
      )}
    </div>
  );
}
