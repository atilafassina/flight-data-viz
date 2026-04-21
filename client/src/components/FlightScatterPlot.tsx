import { useMemo, useState, lazy, Suspense } from 'react';
import type { Data, Layout } from 'plotly.js';
import { ChartLoading, ChartEmpty } from './ChartLoading';

const Plot = lazy(() => import('react-plotly.js'));

interface DownsampledPoint {
  time: number;
  value: number;
}

interface ParameterData {
  parameter: string;
  points: DownsampledPoint[];
}

interface FlightScatterPlotProps {
  data: ParameterData[];
  loading?: boolean;
  error?: string | null;
}

const HOVER_LABEL = {
  bgcolor: '#111',
  bordercolor: '#374151',
  font: { color: '#d1d5db', family: 'JetBrains Mono, monospace', size: 11 },
};

const DARK_AXIS = {
  gridcolor: '#1f2937',
  zerolinecolor: '#1f2937',
  tickfont: { color: '#6b7280', family: 'JetBrains Mono, monospace', size: 10 },
  titlefont: { color: '#9ca3af', family: 'JetBrains Mono, monospace', size: 11 },
};

/**
 * Interpolate values from `source` at the given sorted `timestamps`.
 * Uses linear interpolation between bracketing points.
 */
function interpolateAt(source: DownsampledPoint[], timestamps: number[]): number[] {
  if (source.length === 0) return timestamps.map(() => 0);
  if (source.length === 1) return timestamps.map(() => source[0].value);

  const result = new Array<number>(timestamps.length);
  let j = 0;

  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];

    // Clamp to edges
    if (t <= source[0].time) {
      result[i] = source[0].value;
      continue;
    }
    if (t >= source[source.length - 1].time) {
      result[i] = source[source.length - 1].value;
      continue;
    }

    // Advance j to bracket t
    while (j < source.length - 2 && source[j + 1].time < t) j++;

    const a = source[j];
    const b = source[j + 1];
    const dt = b.time - a.time;
    if (dt === 0) {
      result[i] = a.value;
    } else {
      const frac = (t - a.time) / dt;
      result[i] = a.value + frac * (b.value - a.value);
    }
  }

  return result;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function FlightScatterPlot({ data, loading, error }: FlightScatterPlotProps) {
  const parameterNames = useMemo(() => data.map((d) => d.parameter), [data]);

  const [xParam, setXParam] = useState<string | null>(null);
  const [yParam, setYParam] = useState<string | null>(null);

  // Auto-select defaults when data arrives
  const xSelected = xParam && parameterNames.includes(xParam) ? xParam : parameterNames[0] ?? null;
  const ySelected = yParam && parameterNames.includes(yParam) ? yParam : parameterNames[1] ?? null;

  const { trace, pointCount } = useMemo(() => {
    if (!xSelected || !ySelected) return { trace: null, pointCount: 0 };

    const xData = data.find((d) => d.parameter === xSelected);
    const yData = data.find((d) => d.parameter === ySelected);
    if (!xData || !yData || xData.points.length === 0 || yData.points.length === 0)
      return { trace: null, pointCount: 0 };

    // Use X parameter timestamps as base, interpolate Y values at those timestamps
    const xTimes = xData.points.map((p) => p.time);
    const xValues = xData.points.map((p) => p.value);
    const yValues = interpolateAt(yData.points, xTimes);

    // Normalize time for color: 0→1
    const tMin = xTimes[0];
    const tMax = xTimes[xTimes.length - 1];
    const tRange = tMax - tMin || 1;
    const colors = xTimes.map((t) => (t - tMin) / tRange);

    const scatterTrace: Data = {
      x: xValues,
      y: yValues,
      type: 'scattergl' as const,
      mode: 'markers' as const,
      marker: {
        size: 2.5,
        color: colors,
        cmin: 0,
        cmax: 1,
        colorscale: [
          [0, '#064e3b'],
          [0.25, '#059669'],
          [0.5, '#34d399'],
          [0.75, '#fbbf24'],
          [1, '#f472b6'],
        ],
        opacity: 0.7,
        colorbar: {
          title: { text: 'Time', font: { color: '#6b7280', family: 'JetBrains Mono, monospace', size: 10 } },
          tickfont: { color: '#6b7280', family: 'JetBrains Mono, monospace', size: 9 },
          tickvals: [0, 0.25, 0.5, 0.75, 1],
          ticktext: ['start', '25%', '50%', '75%', 'end'],
          len: 0.6,
          thickness: 12,
          outlinewidth: 0,
          bgcolor: 'transparent',
        },
      },
      hovertemplate: `${xSelected}: %{x:.2f}<br>${ySelected}: %{y:.2f}<extra></extra>`,
    };

    return { trace: scatterTrace, pointCount: xValues.length };
  }, [data, xSelected, ySelected]);

  const layout: Partial<Layout> = useMemo(
    () => ({
      autosize: true,
      height: 560,
      margin: { l: 60, r: 80, t: 20, b: 50 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      xaxis: {
        title: { text: xSelected ?? '' },
        ...DARK_AXIS,
      },
      yaxis: {
        title: { text: ySelected ?? '' },
        ...DARK_AXIS,
      },
      hoverlabel: HOVER_LABEL,
      hovermode: 'closest',
    }),
    [xSelected, ySelected]
  );

  if (loading) return <ChartLoading />;

  if (error) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-lg border border-red-500/20 bg-zinc-950">
        <div className="text-center font-mono">
          <div className="mb-2 text-sm text-red-400">ERROR</div>
          <p className="text-xs text-zinc-500">{error}</p>
        </div>
      </div>
    );
  }

  if (data.length === 0 || data.every((d) => d.points.length === 0)) return <ChartEmpty />;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-4 font-mono text-xs">
        <label className="flex items-center gap-2">
          <span className="text-zinc-500">X</span>
          <select
            value={xSelected ?? ''}
            onChange={(e) => setXParam(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-emerald-400 outline-none focus:border-emerald-500/50"
          >
            {parameterNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <span className="text-zinc-600">vs</span>

        <label className="flex items-center gap-2">
          <span className="text-zinc-500">Y</span>
          <select
            value={ySelected ?? ''}
            onChange={(e) => setYParam(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-emerald-400 outline-none focus:border-emerald-500/50"
          >
            {parameterNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-zinc-600">
            <span className="text-zinc-400">{formatCount(pointCount)}</span> points rendered
          </span>
          {pointCount >= 50_000 && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">WebGL</span>
          )}
        </div>
      </div>

      {/* Chart */}
      <Suspense fallback={<ChartLoading />}>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2">
          {trace ? (
            <Plot
              data={[trace]}
              layout={layout}
              useResizeHandler
              style={{ width: '100%' }}
              config={{ responsive: true, displayModeBar: true, displaylogo: false }}
            />
          ) : (
            <div className="flex h-[560px] items-center justify-center font-mono text-xs text-zinc-600">
              Select parameters to plot
            </div>
          )}
        </div>
      </Suspense>
    </div>
  );
}
