/**
 * Formats, exports, and renders the O-C history.
 */
import { figureInk } from "../render/canvas/figureInk";
import { drawOcPlotFrame, type OcPlotPoint } from "./ocPlotCanvas";
import type { TransitHistorySeries, TransitHistoryState } from "../../application/runtime/transitHistory";
import type { OcBody, OcCsvOptions, OcTrendMode, OcUnit } from "./ocPlotTypes";

export type { OcBody, OcCsvOptions, OcTrendMode, OcUnit } from "./ocPlotTypes";

type OcPoint = { x: number; y: number; centerSec: number };
type OcStatsOptions = { unit?: OcUnit; trendMode?: OcTrendMode; periodSec?: number };
type OcFit = NonNullable<ReturnType<typeof fitLinearEphemeris>>;
type OcPanelStats = {
  body: OcBody;
  unit: OcUnit;
  trendMode: OcTrendMode;
  n: number;
  latest: number | undefined;
  rms: number | undefined;
  lastDur: number | undefined;
  slopePerEpoch: number | undefined;
  rmsResidual: number | undefined;
  unitTxt: string;
};
type OcCsvRowContext = {
  body: OcBody;
  unit: OcUnit;
  trendMode: OcTrendMode;
  scale: number;
  fitByCenter: Map<number, number>;
  epochByCenter: Map<number, number>;
};
type OcRenderOptions = {
  unit: OcUnit;
  trendMode: OcTrendMode;
  scale: number;
};
type OcCanvasMetrics = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
};

function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function fmt(v: number | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toExponential(3) : "n/a";
}

function getOcSeries(state: TransitHistoryState, body: OcBody): TransitHistorySeries {
  return body === "moon" ? state.moon : state.planet;
}

function unitScale(unit: OcUnit): number {
  return unit === "ms" ? 1000 : 1;
}

function unitLabel(unit: OcUnit): string {
  return unit === "ms" ? "ms" : "s";
}

function fmtWithUnit(v: number | undefined, unit: OcUnit): string {
  const s = unitScale(unit);
  return fmt(typeof v === "number" ? v * s : undefined);
}

/**
 * Collects finite O-C points with their transit epoch as the fit coordinate.
 *
 * Fitting O-C against absolute time gives a slope dominated by the magnitude of t, so
 * the x-coordinate is the epoch E = round((center - center0) / P), giving a slope in
 * seconds/epoch. Recorded events are not consecutive epochs: at high time speed transits
 * are skipped, so the ordinal of the recorded event is used only when no period is known.
 */
export function collectFiniteOcPoints(series: TransitHistorySeries, periodSec?: number): OcPoint[] {
  const period = finite(periodSec);
  const out: OcPoint[] = [];
  let center0: number | undefined;
  for (const e of series.events) {
    const oc = finite(e.ocSec);
    const center = finite(e.centerSec);
    if (oc === undefined || center === undefined) continue;
    center0 ??= center;
    const epoch = period && period > 0 ? Math.round((center - center0) / period) : out.length;
    out.push({ x: epoch, y: oc, centerSec: center });
  }
  return out;
}

function fitLinearEphemeris(points: Array<{ x: number; y: number }>):
  | {
      slope: number;
      intercept: number;
      rmsResidual: number;
    }
  | undefined {
  if (points.length < 2) return undefined;
  const n = points.length;
  const xMean = points.reduce((a, p) => a + p.x, 0) / n;
  const yMean = points.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - xMean;
    sxx += dx * dx;
    sxy += dx * (p.y - yMean);
  }
  if (!(sxx > 0)) return undefined;

  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;
  let rss = 0;
  for (const p of points) {
    const r = p.y - (intercept + slope * p.x);
    rss += r * r;
  }
  return { slope, intercept, rmsResidual: Math.sqrt(rss / Math.max(1, n - 2)) };
}

export function formatOcPanelStats(
  state: TransitHistoryState,
  body: OcBody,
  opts: OcStatsOptions = {},
): string {
  const stats = ocPanelStats(state, body, opts);
  if (stats.trendMode === "raw") return formatRawOcPanelStats(stats);
  if (stats.trendMode === "fit") return formatFitOcPanelStats(stats);
  return formatDetrendedOcPanelStats(stats);
}

function ocPanelStats(state: TransitHistoryState, body: OcBody, opts: OcStatsOptions): OcPanelStats {
  const unit = opts.unit ?? "s";
  const trendMode = opts.trendMode ?? "raw";
  const series = getOcSeries(state, body);
  const points = collectFiniteOcPoints(series, opts.periodSec);
  const fit = ocPanelFit(points, trendMode);
  const n = series.events.length;
  return {
    body,
    unit,
    trendMode,
    n,
    latest: series.latestOcSec,
    rms: series.rmsOcSec,
    lastDur: finite(series.events[n - 1]?.durationSec),
    slopePerEpoch: fit ? fit.slope : undefined,
    rmsResidual: fit ? fit.rmsResidual : undefined,
    unitTxt: unitLabel(unit),
  };
}

function ocPanelFit(points: OcPoint[], trendMode: OcTrendMode): OcFit | undefined {
  return trendMode === "raw" ? undefined : fitLinearEphemeris(points);
}

function formatRawOcPanelStats(stats: OcPanelStats): string {
  return `${stats.body} events=${stats.n} latest=${fmtWithUnit(stats.latest, stats.unit)} rms=${fmtWithUnit(stats.rms, stats.unit)} dur=${fmt(stats.lastDur)} s [${stats.unitTxt}]`;
}

function formatFitOcPanelStats(stats: OcPanelStats): string {
  return `${stats.body} events=${stats.n} latest=${fmtWithUnit(stats.latest, stats.unit)} rms=${fmtWithUnit(stats.rms, stats.unit)} slope=${fmtWithUnit(stats.slopePerEpoch, stats.unit)}/epoch`;
}

function formatDetrendedOcPanelStats(stats: OcPanelStats): string {
  return `${stats.body} events=${stats.n} detrendedRms=${fmtWithUnit(stats.rmsResidual, stats.unit)} slope=${fmtWithUnit(stats.slopePerEpoch, stats.unit)}/epoch`;
}

export function formatOcFitSummary(
  state: TransitHistoryState,
  body: OcBody,
  opts: { unit?: OcUnit; periodSec?: number } = {},
): string {
  const unit = opts.unit ?? "s";
  const points = collectFiniteOcPoints(getOcSeries(state, body), opts.periodSec);
  const fit = fitLinearEphemeris(points);
  if (!fit) return `${body} fit: n/a`;
  const slopePerEpoch = fit.slope;
  return `${body} fit slope=${fmtWithUnit(slopePerEpoch, unit)}/epoch intercept=${fmtWithUnit(fit.intercept, unit)} rms=${fmtWithUnit(fit.rmsResidual, unit)}`;
}

function buildOcCsv(state: TransitHistoryState, body: OcBody, opts: OcCsvOptions = {}): string {
  const unit = opts.unit ?? "s";
  const trendMode = opts.trendMode ?? "raw";
  const scale = unitScale(unit);
  const series = getOcSeries(state, body);
  const points = collectFiniteOcPoints(series, opts.periodSec);
  const fit = fitLinearEphemeris(points);
  const fitByCenter = fitValuesByCenter(points, fit);
  const epochByCenter = new Map(points.map((point) => [point.centerSec, point.x]));
  const context: OcCsvRowContext = { body, unit, trendMode, scale, fitByCenter, epochByCenter };

  const header =
    "body,index,epoch,center_sec,oc_raw_sec,oc_fit_sec,oc_residual_sec,oc_display,duration_sec,ingress_sec,egress_sec,detected_at_sec,unit,trend_mode";
  const rows = series.events.map((event, index) => ocCsvRow(event, index, context));
  return `${header}\n${rows.join("\n")}\n`;
}

function fitValuesByCenter(points: OcPoint[], fit: OcFit | undefined): Map<number, number> {
  const fitByCenter = new Map<number, number>();
  if (!fit) return fitByCenter;
  for (const point of points) {
    fitByCenter.set(point.centerSec, fit.intercept + fit.slope * point.x);
  }
  return fitByCenter;
}

function ocCsvRow(
  event: TransitHistorySeries["events"][number],
  index: number,
  context: OcCsvRowContext,
): string {
  const raw = finite(event.ocSec);
  const fitSec = context.fitByCenter.get(event.centerSec);
  const residual = ocResidual(raw, fitSec);
  const display = ocDisplayValue(raw, residual, context);
  return [
    context.body,
    String(index),
    csvValue(context.epochByCenter.get(event.centerSec)),
    String(event.centerSec),
    csvValue(raw),
    csvValue(fitSec),
    csvValue(residual),
    csvValue(display),
    csvValue(event.durationSec),
    csvValue(event.ingressSec),
    csvValue(event.egressSec),
    event.detectedAtSec,
    context.unit,
    context.trendMode,
  ].join(",");
}

function ocResidual(raw: number | undefined, fitSec: number | undefined): number | undefined {
  return raw !== undefined && fitSec !== undefined ? raw - fitSec : undefined;
}

function ocDisplayValue(
  raw: number | undefined,
  residual: number | undefined,
  context: OcCsvRowContext,
): number | undefined {
  const displayRaw = context.trendMode === "detrended" ? residual : raw;
  return displayRaw !== undefined ? displayRaw * context.scale : undefined;
}

function csvValue(value: number | undefined): number | "" {
  return value ?? "";
}

export function exportOcCsv(state: TransitHistoryState, body: OcBody, opts: OcCsvOptions = {}): void {
  const csv = buildOcCsv(state, body, opts);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oc-history-${body}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Delay revocation so the browser has time to initiate the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function renderOcHistoryCanvas(
  canvas: HTMLCanvasElement | null,
  state: TransitHistoryState,
  body: OcBody,
  opts: OcStatsOptions = {},
): void {
  const renderOptions = ocRenderOptions(opts);
  const metrics = canvas ? prepareOcCanvas(canvas) : undefined;
  if (!metrics) return;
  const { ctx, w, h } = metrics;
  drawOcBackground(ctx, w, h);

  const series = getOcSeries(state, body);
  const points = collectFiniteOcPoints(series, opts.periodSec);
  const fit = ocPanelFit(points, renderOptions.trendMode);
  const pointsY = ocDisplayPoints(points, fit, renderOptions.trendMode, renderOptions.scale);
  drawOcPlotFrame({
    ctx,
    w,
    h,
    body,
    pointsY,
    fit,
    trendMode: renderOptions.trendMode,
    scale: renderOptions.scale,
    unit: renderOptions.unit,
  });
}

function ocRenderOptions(opts: { unit?: OcUnit; trendMode?: OcTrendMode }): OcRenderOptions {
  const unit = opts.unit ?? "s";
  return {
    unit,
    trendMode: opts.trendMode ?? "raw",
    scale: unitScale(unit),
  };
}

function prepareOcCanvas(canvas: HTMLCanvasElement): OcCanvasMetrics | undefined {
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  // Apply devicePixelRatio scaling for HiDPI displays.
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  const bufW = Math.round(cssW * dpr);
  const bufH = Math.round(cssH * dpr);

  if (canvas.width !== bufW || canvas.height !== bufH) {
    canvas.width = bufW;
    canvas.height = bufH;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssW, h: cssH };
}

function drawOcBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = figureInk().paper;
  ctx.fillRect(0, 0, w, h);
}

function ocDisplayPoints(
  points: OcPoint[],
  fit: OcFit | undefined,
  trendMode: OcTrendMode,
  scale: number,
): OcPlotPoint[] {
  // Use centerSec for the x-axis display, but epoch index (p.x) for the fit evaluation.
  return points.map((point) => ({
    x: point.centerSec,
    epoch: point.x,
    y: ocDisplayY(point, fit, trendMode, scale),
  }));
}

function ocDisplayY(point: OcPoint, fit: OcFit | undefined, trendMode: OcTrendMode, scale: number): number {
  if (trendMode === "detrended" && fit) {
    return (point.y - (fit.intercept + fit.slope * point.x)) * scale;
  }
  return point.y * scale;
}
