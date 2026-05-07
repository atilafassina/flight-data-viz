import { useMemo, useCallback, lazy, Suspense } from 'react';
import type { Data, Layout, PlotRelayoutEvent } from 'plotly.js';
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

interface FlightTimeSeriesProps {
  data: ParameterData[];
  loading?: boolean;
  error?: string | null;
  onViewportChange?: (startTime: number, endTime: number) => void;
}

/** Assign Y-axis: binary/discrete signals on right axis, continuous on left */
function getYAxis(parameter: string): string {
  const rightAxisParams = ['in_air'];
  return rightAxisParams.includes(parameter) ? 'y2' : 'y';
}

const COLORS = ['#34d399', '#fbbf24', '#60a5fa', '#f472b6', '#a78bfa'];

const DARK_AXIS = {
  gridcolor: '#1f2937',
  zerolinecolor: '#1f2937',
  tickfont: { color: '#6b7280', family: 'JetBrains Mono, monospace', size: 10 },
  titlefont: { color: '#6b7280', family: 'JetBrains Mono, monospace', size: 10 },
};

const HOVER_LABEL = {
  bgcolor: '#111',
  bordercolor: '#374151',
  font: { color: '#d1d5db', family: 'JetBrains Mono, monospace', size: 11 },
};

function buildTraces(data: ParameterData[]): Data[] {
  return data.map((param, i) => ({
    x: param.points.map((p) => new Date(p.time)),
    y: param.points.map((p) => p.value),
    type: 'scattergl' as const,
    mode: 'lines' as const,
    name: param.parameter,
    yaxis: getYAxis(param.parameter),
    line: { color: COLORS[i % COLORS.length], width: 1.5 },
  }));
}

export function FlightTimeSeries({ data, loading, error, onViewportChange }: FlightTimeSeriesProps) {
  const traces = useMemo(() => buildTraces(data), [data]);

  const handleRelayout = useCallback(
    (event: PlotRelayoutEvent) => {
      const xStart = event['xaxis.range[0]'] as string | undefined;
      const xEnd = event['xaxis.range[1]'] as string | undefined;
      if (xStart && xEnd) {
        onViewportChange?.(new Date(xStart).getTime(), new Date(xEnd).getTime());
      }
    },
    [onViewportChange]
  );

  const overviewLayout: Partial<Layout> = useMemo(
    () => ({
      autosize: true,
      height: 160,
      margin: { l: 50, r: 50, t: 8, b: 28 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      xaxis: { type: 'date', rangeslider: { visible: true, bgcolor: '#0a0a0a', bordercolor: '#1f2937' }, ...DARK_AXIS },
      yaxis: { title: { text: '' }, side: 'left', ...DARK_AXIS },
      yaxis2: { title: { text: '' }, side: 'right', overlaying: 'y', ...DARK_AXIS },
      showlegend: false,
      hovermode: 'x unified' as const,
      hoverlabel: HOVER_LABEL,
    }),
    []
  );

  const detailLayout: Partial<Layout> = useMemo(
    () => ({
      autosize: true,
      height: 380,
      margin: { l: 50, r: 50, t: 8, b: 40 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      xaxis: {
        title: { text: '' },
        type: 'date',
        ...DARK_AXIS,
      },
      yaxis: { title: { text: '' }, side: 'left', ...DARK_AXIS },
      yaxis2: {
        title: { text: '' },
        side: 'right',
        overlaying: 'y',
        range: [-0.1, 1.1],
        ...DARK_AXIS,
      },
      legend: {
        orientation: 'h',
        y: -0.15,
        font: { color: '#9ca3af', family: 'JetBrains Mono, monospace', size: 10 },
        bgcolor: 'transparent',
      },
      hovermode: 'x unified' as const,
      hoverlabel: HOVER_LABEL,
    }),
    []
  );

  if (loading) {
    return <ChartLoading />;
  }

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

  if (data.length === 0 || data.every((d) => d.points.length === 0)) {
    return <ChartEmpty />;
  }

  return (
    <Suspense fallback={<ChartLoading />}>
      <div className="space-y-3">
        {/* Overview chart with range slider */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2">
          <Plot
            data={traces}
            layout={overviewLayout}
            useResizeHandler
            style={{ width: '100%' }}
            config={{ responsive: true, displayModeBar: false }}
            onRelayout={handleRelayout}
          />
        </div>

        {/* Detail chart */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2">
          <Plot
            data={traces}
            layout={detailLayout}
            useResizeHandler
            style={{ width: '100%' }}
            config={{ responsive: true, displayModeBar: true, displaylogo: false }}
            onRelayout={handleRelayout}
          />
        </div>
      </div>
    </Suspense>
  );
}
