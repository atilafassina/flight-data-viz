import { useEffect, useState } from 'react';

const BOOT_SEQUENCE = [
  { text: 'APPKIT FLIGHT VIZ v1.0', delay: 0 },
  { text: 'Initializing resample engine...', delay: 300 },
  { text: 'Connecting to SQL Warehouse ............ OK', delay: 700 },
  { text: 'Lakebase index ......................... OK', delay: 1100 },
  { text: 'Arrow IPC decoder ...................... OK', delay: 1400 },
  { text: 'LTTB downsampler ....................... OK', delay: 1700 },
  { text: 'WebGL renderer ......................... OK', delay: 2000 },
  { text: '', delay: 2200 },
  { text: 'Awaiting flight data...', delay: 2400 },
];

function BootLine({ text, delay }: { text: string; delay: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  if (!visible) return null;

  const isHeader = delay === 0;
  const isStatus = text.includes('OK');

  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-1 duration-200"
      style={{ animationDelay: '0ms' }}
    >
      {isHeader ? (
        <span className="font-bold text-emerald-400">{text}</span>
      ) : isStatus ? (
        <span>
          <span className="text-zinc-500">{text.replace('OK', '')}</span>
          <span className="font-bold text-emerald-400">OK</span>
        </span>
      ) : text === '' ? (
        <br />
      ) : (
        <span className="text-amber-400/80">{text}</span>
      )}
    </div>
  );
}

function Altimeter() {
  const [alt, setAlt] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setAlt((prev) => {
        if (prev >= 35000) return 0;
        return prev + Math.floor(Math.random() * 800 + 200);
      });
    }, 120);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-baseline gap-1 font-mono">
      <span className="text-xs text-zinc-600">ALT</span>
      <span className="tabular-nums text-emerald-500/60">{String(alt).padStart(5, '0')}</span>
      <span className="text-xs text-zinc-600">FT</span>
    </div>
  );
}

function ScanLine() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
      <div
        className="absolute left-0 h-px w-full bg-emerald-400/10"
        style={{
          animation: 'scanline 3s linear infinite',
        }}
      />
      <style>{`
        @keyframes scanline {
          0% { top: -1px; }
          100% { top: 100%; }
        }
      `}</style>
    </div>
  );
}

export function ChartLoading() {
  return (
    <div className="relative h-[600px] w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-6 font-mono text-xs leading-relaxed">
      <ScanLine />

      {/* CRT vignette */}
      <div className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-b from-transparent via-transparent to-zinc-950/40" />
      <div className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0_0_80px_rgba(0,0,0,0.6)]" />

      {/* Boot sequence */}
      <div className="relative z-10 space-y-0.5">
        {BOOT_SEQUENCE.map((line, i) => (
          <BootLine key={i} text={line.text} delay={line.delay} />
        ))}

        {/* Blinking cursor */}
        <span className="inline-block h-3 w-1.5 animate-pulse bg-emerald-400/70" />
      </div>

      {/* Bottom HUD strip */}
      <div className="absolute bottom-4 left-6 right-6 z-10 flex items-center justify-between border-t border-zinc-800 pt-3 text-xs">
        <div className="flex gap-6">
          <Altimeter />
          <div className="flex items-baseline gap-1 font-mono">
            <span className="text-xs text-zinc-600">SPD</span>
            <span className="tabular-nums text-emerald-500/60">---</span>
            <span className="text-xs text-zinc-600">KTS</span>
          </div>
          <div className="flex items-baseline gap-1 font-mono">
            <span className="text-xs text-zinc-600">HDG</span>
            <span className="tabular-nums text-emerald-500/60">---</span>
            <span className="text-xs text-zinc-600">DEG</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          <span className="text-zinc-500">STANDBY</span>
        </div>
      </div>
    </div>
  );
}

export function ChartEmpty() {
  return (
    <div className="relative flex h-[600px] w-full items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <ScanLine />
      <div className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0_0_80px_rgba(0,0,0,0.6)]" />

      <div className="relative z-10 text-center font-mono">
        <div className="mb-3 text-2xl text-zinc-700">{'{ }'}</div>
        <p className="text-sm text-zinc-500">No flight data loaded</p>
        <p className="mt-1 text-xs text-zinc-600">Enter a flight ID and press Load to begin</p>
      </div>

      {/* Bottom HUD strip */}
      <div className="absolute bottom-4 left-6 right-6 z-10 flex items-center justify-between border-t border-zinc-800 pt-3 text-xs font-mono">
        <span className="text-zinc-700">APPKIT FLIGHT VIZ</span>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
          <span className="text-zinc-700">OFFLINE</span>
        </div>
      </div>
    </div>
  );
}
