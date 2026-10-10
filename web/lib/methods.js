// The methods paragraph (requirement R4), written from what the workspace holds and the run
// actually did: the table and its checksum, the identifiers and target, the design, the scoring
// with every parameter, the QC thresholds and findings, the software, with numbered references
// and their BibTeX. Deterministic for the same inputs. The framework follows CytoWeave 0.8.0's
// web/lib/methods.js; the text and references are MaveScape's own.

import { summarizeDesign } from './design.js';
import { NORMALIZATIONS } from './score-ratio.js';
import { RESCALINGS, withDefaults } from './score.js';
import { describeFilters } from './filters.js';
import { barcodeSentence, binSentence, dimsumSentence, regressionSentence } from './runs.js';

export const REFERENCES = {
  enrich2: { type: 'article', authors: ['Rubin, Alan F', 'Gelman, Hannah', 'Lucas, Nathan', 'Bajjalieh, Sandra M', 'Papenfuss, Anthony T', 'Speed, Terence P', 'Fowler, Douglas M'], title: 'A statistical framework for analyzing deep mutational scanning data', journal: 'Genome Biology', year: 2017, volume: 18, pages: '150', doi: '10.1186/s13059-017-1272-5' },
  reml: { type: 'article', authors: ['Viechtbauer, Wolfgang'], title: 'Bias and efficiency of meta-analytic variance estimators in the random-effects model', journal: 'Journal of Educational and Behavioral Statistics', year: 2005, volume: 30, number: 3, pages: '261--293', doi: '10.3102/10769986030003261' },
  metafor: { type: 'article', authors: ['Viechtbauer, Wolfgang'], title: 'Conducting meta-analyses in R with the metafor package', journal: 'Journal of Statistical Software', year: 2010, volume: 36, number: 3, pages: '1--48', doi: '10.18637/jss.v036.i03' },
  higgins: { type: 'article', authors: ['Higgins, Julian P T', 'Thompson, Simon G'], title: 'Quantifying heterogeneity in a meta-analysis', journal: 'Statistics in Medicine', year: 2002, volume: 21, number: 11, pages: '1539--1558', doi: '10.1002/sim.1186' },
  dimsum: { type: 'article', authors: ['Faure, Andre J', 'Schmiedel, J{\\"o}rn M', 'Baeza-Centurion, Pablo', 'Lehner, Ben'], title: 'DiMSum: an error model and pipeline for analyzing deep mutational scanning data and diagnosing common experimental pathologies', journal: 'Genome Biology', year: 2020, volume: 21, pages: '207', doi: '10.1186/s13059-020-02091-3' },
  vampseq: { type: 'article', authors: ['Matreyek, Kenneth A', 'Starita, Lea M', 'Stephany, Jason J', 'Martin, Beth', 'Chiasson, Melissa A', 'Gray, Vanessa E', 'Kircher, Martin', 'Khechaduri, Arineh', 'Dines, Jennifer N', 'Hause, Ronald J', 'Bhatia, Smita', 'Evans, William E', 'Relling, Mary V', 'Yang, Wenjian', 'Shendure, Jay', 'Fowler, Douglas M'], title: 'Multiplex assessment of protein variant abundance by massively parallel sequencing', journal: 'Nature Genetics', year: 2018, volume: 50, number: 6, pages: '874--882', doi: '10.1038/s41588-018-0122-z' },
  peterman: { type: 'article', authors: ['Peterman, Neil', 'Levine, Erel'], title: 'Sort-seq under the hood: implications of design choices on large-scale characterization of sequence-function relations', journal: 'BMC Genomics', year: 2016, volume: 17, pages: '206', doi: '10.1186/s12864-016-2533-5' },
  dmsVariants: { type: 'software', authors: ['Bloom, Jesse D'], title: 'dms_variants', version: '1.6.0', year: 2024, url: 'https://github.com/jbloomlab/dms_variants' },
  mavedb: { type: 'article', authors: ['Esposito, Daniel', 'Weile, Jochen', 'Shendure, Jay', 'Starita, Lea M', 'Papenfuss, Anthony T', 'Roth, Frederick P', 'Fowler, Douglas M', 'Rubin, Alan F'], title: 'MaveDB: an open-source platform to distribute and interpret data from multiplexed assays of variant effect', journal: 'Genome Biology', year: 2019, volume: 20, pages: '223', doi: '10.1186/s13059-019-1845-6' },
};

const plainAuthors = (authors) => {
  const names = authors.map((a) => {
    const [family, given = ''] = a.split(', ');
    return `${family.replace(/[{}\\"]/g, '')} ${given.split(/[\s-]+/).map((g) => g[0]).join('')}`.trim();
  });
  return names.length > 6 ? `${names.slice(0, 6).join(', ')}, et al.` : names.join(', ');
};

// A reference as text (Vancouver-like).
export function referenceText(ref) {
  if (ref.text) return ref.text;
  if (ref.type === 'software') return `${plainAuthors(ref.authors)}. ${ref.title}, version ${ref.version}. ${ref.year ?? 'n.d.'}. ${ref.url}`;
  const by = plainAuthors(ref.authors);
  return `${by}${by.endsWith('.') ? '' : '.'} ${ref.title}. ${ref.journal}. ${ref.year};${ref.volume}${ref.number ? `(${ref.number})` : ''}:${ref.pages.replace('--', '–')}. doi:${ref.doi}`;
}

const bibKey = (key, ref) => `${(ref.authors?.[0] ?? key).split(',')[0].replace(/[^A-Za-z]/g, '').toLowerCase()}${ref.year ?? ''}${key === 'reml' ? 'a' : key === 'metafor' ? 'b' : ''}`;

export function toBibTeX(refs) {
  return `${refs.map(({ key, ref }) => {
    const fields = [];
    if (ref.authors) fields.push(['author', ref.authors.join(' and ')]);
    fields.push(['title', `{${ref.title ?? ref.text}}`]);
    for (const f of ['journal', 'year', 'volume', 'number', 'pages', 'doi', 'version', 'url', 'note']) if (ref[f] !== undefined && ref[f] !== null) fields.push([f, String(ref[f])]);
    return `@${ref.type === 'software' ? 'software' : ref.type === 'misc' ? 'misc' : 'article'}{${bibKey(key, ref)},\n${fields.map(([k, val]) => `  ${k} = {${val}}`).join(',\n')}\n}`;
  }).join('\n\n')}\n`;
}

// Writes the methods of a run. options: { software: { version, commit }, findings (QC, optional),
// thresholds }. Returns { paragraphs, references: [{ n, key, text }], markdown, bibtex }.
export function writeMethods(ws, run, options = {}) {
  const cited = [];
  const cite = (key, ref = REFERENCES[key]) => {
    let n = cited.findIndex((c) => c.key === key) + 1;
    if (!n) {
      cited.push({ key, ref });
      n = cited.length;
    }
    return `[${n}]`;
  };
  const p = withDefaults(run.inputs.parameters);
  const design = run.inputs.design;
  const source = ws.sources.find((s) => s.sha256 === run.inputs.source.sha256);
  const target = design.targets?.[0];
  const paragraphs = [];

  // The data.
  const summary = source?.summary;
  const data = [];
  data.push(`Variant counts were read from ${run.inputs.source.name} (SHA-256 ${run.inputs.source.sha256}${run.inputs.source.rows ? `; ${run.inputs.source.rows} rows` : ''}).`);
  if (summary) {
    const kinds = Object.entries(summary.byKind ?? {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ');
    data.push(`Variant identifiers in the ${design.variants.column} column were read as MAVE-HGVS, MaveDB's nomenclature ${cite('mavedb')}${run.inputs.mapping.mode === 'lenient' ? ', accepting common legacy forms,' : ' (strict),'} and checked against the target: ${summary.valid} valid${summary.warning ? `, ${summary.warning} read leniently` : ''}${summary.invalid ? `, ${summary.invalid} not valid (not scored)` : ''}${kinds ? ` (${kinds})` : ''}.`);
  }
  if (target) data.push(`The target was ${target.name} (${target.sequenceType === 'dna' ? `${target.sequence.length} nt` : `${target.sequence.length} residues`}${target.offset ? `; position 1 is position ${1 + target.offset} of the reference` : ''}${target.identifiers?.uniprot ? `; UniProt ${target.identifiers.uniprot}` : ''}).`);
  if (design.source?.citation) {
    data.push(`The data are from ${design.source.citation.replace(/,?\s*doi:\s*\S+$/i, '')} ${cite('data', { type: 'misc', text: `${design.source.citation}${design.source.mavedb ? `. MaveDB ${design.source.mavedb}` : ''}${design.source.license ? ` (${design.source.license})` : ''}.`, title: design.source.citation, note: design.source.mavedb ?? null })}${design.source.mavedb ? `, MaveDB ${design.source.mavedb}` : ''}.`);
  }
  paragraphs.push(data.join(' '));

  // The design.
  paragraphs.push(`Design: ${summarizeDesign(design).lines.join(' ')}`);

  // Scoring.
  const scoring = [];
  if (p.model === 'dimsum') {
    scoring.push(dimsumSentence(p, cite('dimsum')).replace(/ \((\[\d+\])\)/, ' $1'));
    // The fitted model, from the run record.
    const fits = (run.output.replicates ?? []).filter((r) => r.dimsum);
    const g = (x) => String(Number(x.toPrecision(3)));
    const list = (f) => fits.map((r) => g(f(r.dimsum))).join(', ');
    const fitted = [];
    if (p.dimsumNormalise && fits.length > 1) fitted.push(`the scales were ${list((d) => d.scale)} and the shifts ${list((d) => d.shift)}`);
    if (fits.length > 1 && fits[0].dimsum.input !== null) fitted.push(`the multiplicative error terms ${list((d) => d.input)} at the input and ${list((d) => d.output)} at the output, and the additive SDs ${list((d) => Math.sqrt(d.reperror))}`);
    if (fitted.length) scoring.push(`For ${fits.map((r) => design.replicates.find((x) => x.id === r.id)?.name ?? r.id).join(', ')} in turn, ${fitted.join('; ')}.`);
  }
  else if (p.model === 'ratio') scoring.push(`Scores are natural-log ratios of each variant's frequency after selection to before${design.model === 'time-series' ? ' (the first and last time points)' : ''} ${cite('enrich2')}, normalized by the ${NORMALIZATIONS[p.normalization]}, with a pseudocount of ${p.pseudocount}; a replicate's standard error is the square root of the summed reciprocal counts${p.normalization === 'synonymous' ? '' : ' and normalizers'}.`);
  else if (p.model === 'wls' || p.model === 'ols') scoring.push(regressionSentence(p, cite('enrich2')).replace(/ \((\[\d+\])\)/, ' $1'));
  else scoring.push(binSentence(p, { average: cite('vampseq'), mle: cite('peterman') }).replace(/ \((\[\d+\])\)/, ' $1'));
  if (design.library?.level === 'barcode') scoring.push(barcodeSentence(p, p.aggregation === 'sum' ? { enrich2: cite('enrich2') } : { dmsVariants: cite('dmsVariants') }).replace(/ \((\[\d+\])\)/, ' $1'));
  scoring.push('Technical replicates were summed before scoring; biological replicates were scored separately.');
  if (p.combination === 'reml') scoring.push(`Replicate scores were combined by inverse-variance weighting with a between-replicate variance τ² estimated by restricted maximum likelihood ${cite('reml')}, by Fisher scoring as in metafor ${cite('metafor')}.`);
  else if (p.combination === 'fixed') scoring.push('Replicate scores were combined by inverse-variance weighting (fixed effects).');
  else if (p.combination === 'mean') scoring.push('Replicate scores were combined by their mean, with SE their standard deviation over the square root of their number.');
  else scoring.push(`Replicate scores were combined by Enrich2's random-effects estimator ${cite('enrich2')} as implemented in Enrich2 2.0.2 (50 iterations from its starting value).`);
  scoring.push(`Heterogeneity is reported as Cochran's Q and I² ${cite('higgins')}, with the largest change in a score when one replicate is left out.`);
  scoring.push(`Filters, in order: ${describeFilters(p.filters, null, p.model === 'wls' || p.model === 'ols', design.library?.level === 'barcode').filter((x) => x.active !== false).map((x) => x.text.charAt(0).toLowerCase() + x.text.slice(1)).join('; ')}. A filtered variant's score is reported as NA with the stage that removed it.`);
  if (p.rescale !== 'none') scoring.push(`Scores were rescaled so that ${RESCALINGS[p.rescale].label}${run.output.conditions[0]?.rescale ? ` (${run.output.conditions[0].rescale.anchors.map((a) => `${a.what} ${Number(a.from.toFixed(4))} to ${a.to}`).join(', ')})` : ''}; the anchors' own uncertainty is not propagated.`);
  const conditions = run.output.conditions.map((c) => `${run.output.conditions.length > 1 ? `${c.name}: ` : ''}${c.scored} of ${run.output.variants} variants scored`).join('; ');
  scoring.push(`${conditions}.`);
  if (run.warnings.length) scoring.push(`Notes: ${run.warnings.map((w) => w.message).join(' ')}`);
  paragraphs.push(scoring.join(' '));

  // Quality control.
  if (options.findings) {
    const f = options.findings;
    const flagged = f.filter((x) => x.status === 'review' || x.status === 'fail');
    const bottleneck = flagged.some((x) => x.id === 'excess-variance');
    paragraphs.push(`Quality control: ${f.filter((x) => x.status === 'pass').length} findings passed, ${f.filter((x) => x.status === 'review').length} were to review and ${f.filter((x) => x.status === 'fail').length} failed${f.some((x) => x.status === 'na') ? ` (${f.filter((x) => x.status === 'na').length} not assessed)` : ''}.${flagged.length ? ` ${flagged.map((x) => `${x.title}: ${x.value} (${x.status}; ${x.threshold})`).join('. ')}.` : ''}${bottleneck ? ` Variance beyond counting is read as in DiMSum's error model ${cite('dimsum')}.` : ''} Thresholds are recorded with the workspace.`);
  }

  // Software.
  const sw = run.software;
  const mavescape = { type: 'software', authors: ['McDermott, Robert'], title: 'MaveScape', version: sw.version, year: Number((run.created ?? '').slice(0, 4)) || null, url: 'https://github.com/robert-mcdermott/mavescape' };
  paragraphs.push(`Analyses were made with MaveScape ${sw.version}${sw.commit ? ` (commit ${sw.commit.slice(0, 12)})` : ''} ${cite('mavescape', mavescape)}, scoring version ${sw.scoring}; the run ${run.id} has output SHA-256 ${run.output.sha256}, and its scores can be recomputed from the recorded inputs. MaveScape reports experimental functional effects for research; it does not classify variants as pathogenic or benign.`);

  const references = cited.map(({ key, ref }, i) => ({ n: i + 1, key, text: referenceText(ref) }));
  const markdown = `# Methods\n\n${paragraphs.join('\n\n')}\n\n## References\n\n${references.map((r) => `${r.n}. ${r.text}`).join('\n')}\n`;
  return { paragraphs, references, markdown, bibtex: toBibTeX(cited) };
}

