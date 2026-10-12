// The charts of each quality-control finding (wave 6, slice 2): from the QC results (lib/qc.js) and
// the thresholds, which charts a finding's plot draws and what each holds, as specifications for
// lib/plots.js. The QC view draws them beside its tables (ui/mode-qc.js), and a figure's QC panel
// draws the same (lib/figure-plots.js). Pure.

import { categoricalColor } from './colormaps.js';
import { KIND } from './variants.js';
import { log10, pow } from './dmath.js';
import { PLOT_LIGHT } from './plots.js';

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pct = (x) => (Number.isFinite(x) ? `${(100 * x).toFixed(x < 0.1 ? 1 : 0)}%` : '—');
export function formatCount(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return Math.round(n).toLocaleString('en-US');
}

// The plots findings draw (lib/findings.js's plot), in words.
export const QC_PLOTS = {
  missingness: 'Missing variants by sample',
  depth: 'Reads per variant by sample',
  counts: 'Count distributions and rank abundance',
  'bin-occupancy': 'Each bin\'s share',
  'cells-per-bin': 'Cells sorted per variant into each bin',
  'barcodes-per-variant': 'Barcodes per variant',
  'barcode-agreement': 'Barcodes\' agreement (φ)',
  'time-points': 'Fits on fewer time points',
  'time-fit': 'Departure of the time courses from their lines',
  coverage: 'Coverage',
  agreement: 'Replicate agreement',
  variance: 'Variance beyond counting',
  'leave-one-out': 'Leave-one-out variance by replicate',
  controls: 'Scores of the control classes',
  uncertainty: 'Score against its SE',
  flow: 'The filter flow',
};

const status = (value, review, fail, higherIsWorse = true) => {
  if (!Number.isFinite(value)) return '';
  if (higherIsWorse) return value > fail ? 'fail' : value > review ? 'review' : '';
  return value < fail ? 'fail' : value < review ? 'review' : '';
};

// A finding's charts: { charts: [{ kind: 'bar' | 'line' | 'scatter' | 'histogram' | 'flow' |
// 'coverage', spec, heading?, legend? }], reason? (why there is none) }. options: { theme (for the
// colors of reference lines), pair (the agreement plot's pair of replicates, an index) }.
export function qcCharts(plot, qc, t, options = {}) {
  const theme = options.theme ?? PLOT_LIGHT;
  const lines = (key) => [{ value: t[key].review, kind: 'review' }, { value: t[key].fail, kind: 'fail' }];
  const none = (reason) => ({ charts: [], reason });
  switch (plot) {
    case 'missingness':
      return { charts: [{ kind: 'bar', spec: { items: qc.samples.map((s) => ({ label: s.name, value: s.missingFraction, status: s.counted === 0 ? 'fail' : '' })), label: 'Fraction of variants missing, by sample', format: pct } }] };
    case 'depth':
      return { charts: [{ kind: 'bar', spec: { items: qc.samples.map((s) => ({ label: s.name, value: s.readsPerVariant, status: status(s.readsPerVariant, t.readsPerVariant.review, t.readsPerVariant.fail, false) })), log: true, lines: lines('readsPerVariant'), label: 'Reads per counted variant, by sample (log scale), with the review and fail thresholds', format: (v) => formatCount(Math.round(v)) } }] };
    case 'counts': {
      const inputs = qc.samples.filter((s) => s.input && s.counted);
      const shown = (inputs.length ? inputs : qc.samples.filter((s) => s.counted)).slice(0, 12);
      return {
        charts: [
          { kind: 'line', heading: 'Count distributions', legend: shown.map((s, i) => ({ label: `${s.name}: ${pct(s.lowFraction)} below ${t.lowCount}`, color: categoricalColor(i) })), spec: { series: shown.map((s, i) => ({ label: s.name, color: categoricalColor(i), points: s.histogram.map((f, b) => [b / 4, f]) })), xLabel: 'log₁₀(count + 1)', yLabel: 'fraction', label: 'Distribution of counts per variant in the samples before selection', vlines: [{ value: log10(t.lowCount + 1), kind: 'review' }] } },
          { kind: 'line', heading: 'Rank abundance', spec: { series: shown.map((s, i) => ({ label: s.name, color: categoricalColor(i), points: s.rankAbundance.filter((p) => p[1] > 0) })), xLog: true, yLog: true, xLabel: 'rank', yLabel: 'count', label: 'Counts from the most to the least abundant variant' } },
        ],
      };
    }
    case 'bin-occupancy': {
      const bins = qc.bins ?? [];
      if (!bins.length) return none('Needs sorted bins.');
      const items = bins.flatMap((r) => r.bins.map((b) => ({ label: `${r.name}, bin ${b.order}`, value: b.share, status: status(b.share, t.binShare.review, t.binShare.fail, false) })));
      return { charts: [{ kind: 'bar', spec: { items, lines: lines('binShare'), label: `Each bin's share of its replicate's ${bins[0].shareOf}`, format: pct } }] };
    }
    case 'cells-per-bin': {
      const bins = (qc.bins ?? []).filter((r) => r.bins.every((b) => b.cellsPerVariant !== null));
      if (!bins.length) return none('Record the cells sorted into each bin with each sample (the Experiment view) to see them.');
      const items = bins.flatMap((r) => r.bins.map((b) => ({ label: `${r.name}, bin ${b.order}`, value: Math.max(b.cellsPerVariant, 0.1), status: status(b.cellsPerVariant, t.cellsPerVariant.review, t.cellsPerVariant.fail, false) })));
      return { charts: [{ kind: 'bar', spec: { items, log: true, lines: lines('cellsPerVariant'), label: 'Cells sorted per variant into each bin (log scale), with the review and fail thresholds', format: (v) => fmt(v, 0) } }] };
    }
    case 'barcodes-per-variant': {
      const bq = qc.barcodes;
      if (!bq?.replicates.length) return none('Needs a table of barcodes.');
      return { charts: [{ kind: 'line', legend: bq.replicates.map((r, i) => ({ label: `${r.name}: median ${fmt(r.perVariant.median, 0)}, ${pct(r.variants ? r.perVariant.single / r.variants : 0)} with one`, color: categoricalColor(i) })), spec: { series: bq.replicates.map((r, i) => ({ label: r.name, color: categoricalColor(i), markers: true, points: r.perVariant.histogram.slice(1).map((n, k) => [k + 1, r.variants ? n / r.variants : 0]) })), xLabel: 'barcodes per variant (10: ten or more)', yLabel: 'share of variants', label: 'How many barcodes measure each variant, by replicate' } }] };
    }
    case 'barcode-agreement': {
      const reps = (qc.barcodes?.replicates ?? []).filter((r) => Number.isFinite(r.phi));
      if (!reps.length) return none('Needs variants with two or more barcodes counted before and after selection.');
      return { charts: [{ kind: 'bar', spec: { items: reps.map((r) => ({ label: r.name, value: r.phi, status: status(r.phi, t.barcodeExcess.review, t.barcodeExcess.fail) })), lines: [{ value: 1, kind: 'reference' }, ...lines('barcodeExcess')], label: 'How much a variant\'s barcodes disagree beyond counting (φ), by replicate; 1 is counting alone', format: (v) => `${fmt(v, 2)}×` } }] };
    }
    case 'time-points': {
      const ts = qc.timeSeries ?? [];
      if (!ts.length) return none('Needs a run scored by regression on time.');
      return { charts: [{ kind: 'bar', spec: { items: ts.map((r) => ({ label: r.name, value: r.fits ? r.fewer / r.fits : 0, status: r.fits ? status(r.fewer / r.fits, t.fewerPoints.review, t.fewerPoints.fail) : '' })), lines: lines('fewerPoints'), label: 'Fits on fewer time points than the replicate has, by replicate', format: pct } }] };
    }
    case 'time-fit': {
      const ts = (qc.timeSeries ?? []).filter((r) => r.assessed);
      if (!ts.length) return none('Needs fits of three or more time points.');
      return { charts: [{ kind: 'bar', spec: { items: ts.map((r) => ({ label: r.name, value: r.departure, status: status(r.departure, t.timeFit.review, t.timeFit.fail) })), log: true, lines: [{ value: 1, kind: 'reference' }, ...lines('timeFit')], label: 'Median departure of the time courses from their lines, over what counting predicts, by replicate (log scale; 1 is counting alone)', format: (v) => `${fmt(v, 1)}×` } }] };
    }
    case 'coverage':
      if (!qc.coverage?.assessed) return none(`Not assessed: ${qc.coverage?.reason ?? 'no coverage'}.`);
      return { charts: [{ kind: 'coverage', spec: qc.coverage }] };
    case 'agreement': {
      const pairs = qc.conditions.flatMap((c) => c.pairs.map((p) => ({ ...p, condition: c.name })));
      if (!pairs.length) return none('Agreement needs two replicates.');
      const p = pairs[Math.min(Math.max(0, options.pair ?? 0), pairs.length - 1)];
      return { pairs: pairs.map((x) => `${x.a} · ${x.b}`), charts: [{ kind: 'scatter', spec: { points: p.points, xLabel: `${p.a}: log ratio`, yLabel: `${p.b}: log ratio`, diagonal: true, label: `Log ratios of ${p.a} against ${p.b}, ${p.n} variants with at least ${qc.measures.agreementInput} input reads in both: Pearson ${fmt(p.pearson)}` } }] };
    }
    case 'variance': {
      const pairs = qc.conditions.flatMap((c) => c.pairs).filter((p) => p.bins.length);
      const charts = [];
      if (pairs.length) {
        const top = pairs.reduce((a, b) => (b.ratio > a.ratio ? b : a));
        const xs = pairs.flatMap((p) => p.bins.map((b) => b.counting));
        const lo = Math.min(...xs);
        const hi = Math.max(...xs);
        charts.push({
          kind: 'line',
          legend: [...pairs.map((p, i) => ({ label: `${p.a} · ${p.b}: ${fmt(p.ratio, 1)}× (a ${fmt(p.multiplier, 1)}, e ${fmt(p.additive, 3)})`, color: categoricalColor(i) })), { label: 'counting alone', color: theme.muted, dash: true }],
          spec: {
            series: [
              ...pairs.map((p, i) => ({ label: `${p.a} · ${p.b}`, color: categoricalColor(i), markers: true, points: p.bins.map((b) => [b.counting, b.observed]) })),
              { label: 'counting alone', color: theme.muted, dash: true, width: 1.5, points: [[lo, lo], [hi, hi]] },
              { label: `fit for ${top.a} · ${top.b}`, color: theme.danger, width: 1, points: Array.from({ length: 20 }, (_, k) => { const x = lo * pow(hi / lo, k / 19); return [x, top.multiplier * x + top.additive]; }) },
            ],
            xLog: true, yLog: true, xLabel: 'variance from counting', yLabel: 'observed variance', label: 'The variance of replicate differences against what counting predicts, in bins of variants; the dashed line is counting alone',
          },
        });
      }
      const terms = qc.conditions.flatMap((c) => c.errorModel ?? []).flatMap((g) => g.terms ?? []);
      if (terms.length) {
        charts.push({ kind: 'bar', heading: 'DiMSum\'s error model', spec: { items: terms.flatMap((x) => [{ label: `${x.name}, input`, value: x.input, status: status(x.input, t.excessVariance.review, t.excessVariance.fail) }, { label: `${x.name}, output`, value: x.output, status: status(x.output, t.excessVariance.review, t.excessVariance.fail) }]), log: true, lines: [{ value: 1, kind: 'reference' }], label: 'DiMSum\'s multiplicative error terms of each input and output (log scale; 1 is counting alone)', format: (v) => `${fmt(v, 1)}×` } });
      }
      return charts.length ? { charts } : none('Needs two replicates or synonymous variants.');
    }
    case 'leave-one-out': {
      const loo = qc.conditions.flatMap((c) => c.leaveOneOut ?? []);
      if (!loo.length) return none('Needs three replicates measuring the same variants.');
      return { charts: [{ kind: 'bar', spec: { items: loo.map((x) => ({ label: x.id, value: x.ratio, status: status(x.ratio, t.outlierReplicate.review, t.outlierReplicate.fail) })), lines: lines('outlierReplicate'), label: 'Each replicate\'s leave-one-out variance relative to the other replicates\'', format: (v) => `${fmt(v, 1)}×` } }] };
    }
    case 'controls': {
      if (!qc.scores) return none('Needs a score run.');
      return { charts: qc.scores.map((c) => ({ kind: 'histogram', heading: qc.scores.length > 1 ? c.name : null, spec: { groups: [['Synonymous', c.scores.synonymous, 0], ['Nonsense', c.scores.nonsense, 1], ['Missense', c.scores.missense, 2]].map(([label, values, color]) => ({ label, values, color: categoricalColor(color) })), marks: Number.isFinite(c.scores.wt) ? [{ value: c.scores.wt, label: 'wild type' }] : [], label: 'Scores of the control classes' } })) };
    }
    case 'uncertainty': {
      if (!qc.scores) return none('Needs a score run.');
      const colorOf = (k) => categoricalColor(k === KIND.SYNONYMOUS ? 0 : k === KIND.NONSENSE ? 1 : k === KIND.MISSENSE ? 2 : 3);
      return { charts: qc.scores.map((c) => ({ kind: 'scatter', heading: qc.scores.length > 1 ? c.name : null, legend: [['synonymous', 0], ['nonsense', 1], ['missense', 2], ['other', 3]].map(([label, i]) => ({ label, color: categoricalColor(i) })), spec: { points: c.points, colorOf, xLabel: 'score', yLabel: 'SE', label: `Score against its SE for ${c.points.length} scored variants${qc.scores.length > 1 ? ` of ${c.name}` : ''}` } })) };
    }
    case 'flow':
      if (!qc.scores) return none('Needs a score run.');
      return { charts: qc.scores.map((c) => ({ kind: 'flow', heading: qc.scores.length > 1 ? c.name : null, spec: c.flow })) };
    case 'dropout':
      return none('The dropout finding is a table: it has no chart.');
    default:
      return none(`No chart for "${plot}".`);
  }
}

// A QC panel's data (lib/figure-plots.js): the finding's charts with its title, and what it shows
// in words.
export function qcPanelData(finding, qc, t, { pair = 0 } = {}) {
  const { charts, reason } = qcCharts(finding.plot, qc, t, { pair });
  return { title: finding.title, charts, reason, description: `${finding.title} (${finding.status}): ${charts.map((c) => c.spec.label).filter(Boolean).join('. ')}` };
}
