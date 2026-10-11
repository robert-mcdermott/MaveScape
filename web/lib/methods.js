// The methods paragraph (requirement R4), written from what the workspace holds and the run
// actually did: the table and its checksum, the identifiers and target, the design, the scoring
// with every parameter, the QC thresholds and findings, the software, with numbered references
// and their BibTeX. Deterministic for the same inputs. The framework follows CytoWeave 0.8.0's
// web/lib/methods.js; the text and references are MaveScape's own.

import { summarizeDesign } from './design.js';
import { NORMALIZATIONS } from './score-ratio.js';
import { RESCALINGS, withDefaults } from './score.js';
import { describeFilters } from './filters.js';
import { barcodeSentence, binSentence, differentialSentence, dimsumSentence, regressionSentence, unitOf } from './runs.js';
import { notRecorded, readiness } from './readiness.js';
import { anchorUncertainty } from './anchors.js';

export const REFERENCES = {
  enrich2: { type: 'article', authors: ['Rubin, Alan F', 'Gelman, Hannah', 'Lucas, Nathan', 'Bajjalieh, Sandra M', 'Papenfuss, Anthony T', 'Speed, Terence P', 'Fowler, Douglas M'], title: 'A statistical framework for analyzing deep mutational scanning data', journal: 'Genome Biology', year: 2017, volume: 18, pages: '150', doi: '10.1186/s13059-017-1272-5' },
  reml: { type: 'article', authors: ['Viechtbauer, Wolfgang'], title: 'Bias and efficiency of meta-analytic variance estimators in the random-effects model', journal: 'Journal of Educational and Behavioral Statistics', year: 2005, volume: 30, number: 3, pages: '261--293', doi: '10.3102/10769986030003261' },
  metafor: { type: 'article', authors: ['Viechtbauer, Wolfgang'], title: 'Conducting meta-analyses in R with the metafor package', journal: 'Journal of Statistical Software', year: 2010, volume: 36, number: 3, pages: '1--48', doi: '10.18637/jss.v036.i03' },
  higgins: { type: 'article', authors: ['Higgins, Julian P T', 'Thompson, Simon G'], title: 'Quantifying heterogeneity in a meta-analysis', journal: 'Statistics in Medicine', year: 2002, volume: 21, number: 11, pages: '1539--1558', doi: '10.1002/sim.1186' },
  dimsum: { type: 'article', authors: ['Faure, Andre J', 'Schmiedel, J{\\"o}rn M', 'Baeza-Centurion, Pablo', 'Lehner, Ben'], title: 'DiMSum: an error model and pipeline for analyzing deep mutational scanning data and diagnosing common experimental pathologies', journal: 'Genome Biology', year: 2020, volume: 21, pages: '207', doi: '10.1186/s13059-020-02091-3' },
  vampseq: { type: 'article', authors: ['Matreyek, Kenneth A', 'Starita, Lea M', 'Stephany, Jason J', 'Martin, Beth', 'Chiasson, Melissa A', 'Gray, Vanessa E', 'Kircher, Martin', 'Khechaduri, Arineh', 'Dines, Jennifer N', 'Hause, Ronald J', 'Bhatia, Smita', 'Evans, William E', 'Relling, Mary V', 'Yang, Wenjian', 'Shendure, Jay', 'Fowler, Douglas M'], title: 'Multiplex assessment of protein variant abundance by massively parallel sequencing', journal: 'Nature Genetics', year: 2018, volume: 50, number: 6, pages: '874--882', doi: '10.1038/s41588-018-0122-z' },
  peterman: { type: 'article', authors: ['Peterman, Neil', 'Levine, Erel'], title: 'Sort-seq under the hood: implications of design choices on large-scale characterization of sequence-function relations', journal: 'BMC Genomics', year: 2016, volume: 17, pages: '206', doi: '10.1186/s12864-016-2533-5' },
  dmsVariants: { type: 'software', authors: ['Bloom, Jesse D'], title: 'dms_variants', version: '1.6.0', year: 2024, url: 'https://github.com/jbloomlab/dms_variants' },
  limma: { type: 'article', authors: ['Smyth, Gordon K'], title: 'Linear models and empirical Bayes methods for assessing differential expression in microarray experiments', journal: 'Statistical Applications in Genetics and Molecular Biology', year: 2004, volume: 3, number: 1, pages: 'Article 3', doi: '10.2202/1544-6115.1027' },
  voom: { type: 'article', authors: ['Law, Charity W', 'Chen, Yunshun', 'Shi, Wei', 'Smyth, Gordon K'], title: 'voom: precision weights unlock linear model analysis tools for RNA-seq read counts', journal: 'Genome Biology', year: 2014, volume: 15, pages: 'R29', doi: '10.1186/gb-2014-15-2-r29' },
  mutscan: { type: 'article', authors: ['Soneson, Charlotte', 'Bendel, Alexandra M', 'Diss, Guillaume', 'Stadler, Michael B'], title: 'mutscan—a flexible R package for efficient end-to-end analysis of multiplexed assays of variant effect data', journal: 'Genome Biology', year: 2023, volume: 24, pages: '132', doi: '10.1186/s13059-023-02967-0' },
  bh: { type: 'article', authors: ['Benjamini, Yoav', 'Hochberg, Yosef'], title: 'Controlling the false discovery rate: a practical and powerful approach to multiple testing', journal: 'Journal of the Royal Statistical Society: Series B (Methodological)', year: 1995, volume: 57, number: 1, pages: '289--300', doi: '10.1111/j.2517-6161.1995.tb02031.x' },
  uniprot: { type: 'article', authors: ['{The UniProt Consortium}'], title: 'UniProt: the Universal Protein Knowledgebase in 2025', journal: 'Nucleic Acids Research', year: 2025, volume: 53, number: 'D1', pages: 'D609--D617', doi: '10.1093/nar/gkae1010' },
  // Wave 3, slice 3: nucleotide variants' protein changes, targets named by a transcript, and
  // MaveDB's mapped variants. Long author lists end with "others" (BibTeX's et al.).
  hgvs: { type: 'article', authors: ['Hart, Reece K', 'Rico, Rudolph', 'Hare, Emily', 'Garcia, John', 'Westbrook, Jody', 'Fusaro, Vincent A'], title: 'A Python package for parsing, validating, mapping and formatting sequence variants using HGVS nomenclature', journal: 'Bioinformatics', year: 2015, volume: 31, number: 2, pages: '268--270', doi: '10.1093/bioinformatics/btu630' },
  refseq: { type: 'article', authors: ['O\'Leary, Nuala A', 'Wright, Mathew W', 'Brister, J Rodney', 'Ciufo, Stacy', 'Haddad, Diana', 'McVeigh, Rich', 'Rajput, Bhanu', 'others'], title: 'Reference sequence (RefSeq) database at NCBI: current status, taxonomic expansion, and functional annotation', journal: 'Nucleic Acids Research', year: 2016, volume: 44, number: 'D1', pages: 'D733--D745', doi: '10.1093/nar/gkv1189' },
  ensembl: { type: 'article', authors: ['Harrison, Peter W', 'Amode, M Ridwan', 'Austine-Orimoloye, Olanrewaju', 'Azov, Andrey G', 'Barba, Matthieu', 'Barnes, If', 'Becker, Arne', 'others'], title: 'Ensembl 2024', journal: 'Nucleic Acids Research', year: 2024, volume: 52, number: 'D1', pages: 'D891--D899', doi: '10.1093/nar/gkad1049' },
  vrs: { type: 'article', authors: ['Wagner, Alex H', 'Babb, Lawrence', 'Alterovitz, Gil', 'Baudis, Michael', 'Brush, Matthew', 'Cameron, Daniel L', 'Cline, Melissa', 'others'], title: 'The GA4GH Variation Representation Specification: a computational framework for variation representation and federated identification', journal: 'Cell Genomics', year: 2021, volume: 1, number: 2, pages: '100027', doi: '10.1016/j.xgen.2021.100027' },
  mavedbMapping: { type: 'article', authors: ['Arbesfeld, Jeremy A', 'Da, Estelle Y', 'Stevenson, James S', 'Kuzma, Kori', 'Paul, Anika', 'Farris, Tierra', 'Capodanno, Benjamin J', 'others'], title: 'Mapping MAVE data for use in human genomics applications', journal: 'Genome Biology', year: 2025, volume: 26, pages: '179', doi: '10.1186/s13059-025-03647-x' },
  // Wave 3, slice 5: the annotations beside the map.
  clinvar: { type: 'article', authors: ['Landrum, Melissa J', 'Lee, Jennifer M', 'Benson, Mark', 'Brown, Garth R', 'Chao, Chen', 'Chitipiralla, Shanmuga', 'Gu, Baoshan', 'others'], title: 'ClinVar: improving access to variant interpretations and supporting evidence', journal: 'Nucleic Acids Research', year: 2018, volume: 46, number: 'D1', pages: 'D1062--D1067', doi: '10.1093/nar/gkx1153' },
  gnomad: { type: 'article', authors: ['Chen, Siwei', 'Francioli, Laurent C', 'Goodrich, Julia K', 'Collins, Ryan L', 'Wang, Qingbo', 'Alf{\\"o}ldi, Jessica', 'Watts, Nicholas A', 'others'], title: 'A genomic mutational constraint map using variation in 76,156 human genomes', journal: 'Nature', year: 2024, volume: 625, pages: '92--100', doi: '10.1038/s41586-023-06045-0' },
  alphamissense: { type: 'article', authors: ['Cheng, Jun', 'Novati, Guido', 'Pan, Joshua', 'Bycroft, Clare', 'Žemgulytė, Akvilė', 'Applebaum, Taylor', 'Pritzel, Alexander', 'others'], title: 'Accurate proteome-wide missense variant effect prediction with AlphaMissense', journal: 'Science', year: 2023, volume: 381, number: 6664, pages: 'eadg7492', doi: '10.1126/science.adg7492' },
  alphafolddb: { type: 'article', authors: ['Varadi, Mihaly', 'Bertoni, Damian', 'Magana, Paulyna', 'Paramval, Urmila', 'Pidruchna, Ivanna', 'Radhakrishnan, Malarvizhi', 'Tsenkov, Maxim', 'others'], title: 'AlphaFold Protein Structure Database in 2024: providing structure coverage for over 214 million protein sequences', journal: 'Nucleic Acids Research', year: 2024, volume: 52, number: 'D1', pages: 'D368--D375', doi: '10.1093/nar/gkad1011' },
  pdbekb: { type: 'article', authors: ['{PDBe-KB consortium}'], title: 'PDBe-KB: collaboratively defining the biological context of structural data', journal: 'Nucleic Acids Research', year: 2022, volume: 50, number: 'D1', pages: 'D534--D542', doi: '10.1093/nar/gkab988' },
  threedpatch: { type: 'article', authors: ['Jakubec, David', 'Vondrášek, Jiří', 'Finn, Robert D'], title: '3DPatch: fast 3D structure visualization with residue conservation', journal: 'Bioinformatics', year: 2019, volume: 35, number: 2, pages: '332--334', doi: '10.1093/bioinformatics/bty464' },
  capra2007: { type: 'article', authors: ['Capra, John A', 'Singh, Mona'], title: 'Predicting functionally important residues from sequence conservation', journal: 'Bioinformatics', year: 2007, volume: 23, number: 15, pages: '1875--1882', doi: '10.1093/bioinformatics/btm270' },
  henikoff1994: { type: 'article', authors: ['Henikoff, Steven', 'Henikoff, Jorja G'], title: 'Position-based sequence weights', journal: 'Journal of Molecular Biology', year: 1994, volume: 243, number: 4, pages: '574--578', doi: '10.1016/0022-2836(94)90032-9' },
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
// thresholds, results (the run's scores, optional: the rescaling anchors' SEs) }. Returns { paragraphs, references: [{ n, key, text }], markdown, bibtex }.
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
  const published = p.model === 'published';
  data.push(`${published ? 'Published scores' : 'Variant counts'} were read from ${run.inputs.source.name} (SHA-256 ${run.inputs.source.sha256}${run.inputs.source.rows ? `; ${run.inputs.source.rows} rows` : ''}).`);
  // A table retrieved from MaveDB (wave 3, slice 2): which record and file, and when.
  const origin = source?.origin;
  if (origin?.database === 'MaveDB' && origin.urns) data.push(`The table is MaveDB's counts of ${origin.urns.join(' and ')}${origin.license ? ` (${origin.license})` : ''}, retrieved ${String(origin.retrieved ?? '').slice(0, 10)}, joined on their variants, each score set's counts a condition.`);
  else if (origin?.database === 'MaveDB') data.push(`The table is MaveDB's ${origin.file} of ${origin.urn}${origin.license ? ` (${origin.license})` : ''}, retrieved ${String(origin.retrieved ?? '').slice(0, 10)}.`);
  if (summary) {
    const kinds = Object.entries(summary.byKind ?? {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ');
    data.push(`Variant identifiers in the ${design.variants.column} column were read as MAVE-HGVS, MaveDB's nomenclature ${cite('mavedb')}${run.inputs.mapping.mode === 'lenient' ? ', accepting common legacy forms,' : ' (strict),'} and checked against the target: ${summary.valid} valid${summary.warning ? `, ${summary.warning} read leniently` : ''}${summary.invalid ? `, ${summary.invalid} not valid (not scored)` : ''}${kinds ? ` (${kinds})` : ''}.`);
  }
  if (target) data.push(`The target was ${target.name} (${target.sequenceType === 'dna' ? `${target.sequence.length} nt` : `${target.sequence.length} residues`}${target.offset ? `; position 1 is position ${1 + target.offset} of the reference` : ''}${target.identifiers?.uniprot ? `; UniProt ${target.identifiers.uniprot}` : ''}).`);
  // Where its sequence came from (wave 3, slice 3), kept with the workspace's target: a GenBank
  // file, NCBI's RefSeq record or Ensembl's transcript.
  const from = target ? (ws.targets ?? []).find((t) => t.id === target.id && t.sequence === target.sequence)?.origin : null;
  if (from) {
    const day = String(from.retrieval?.retrieved ?? '').slice(0, 10);
    if (from.service === 'NCBI') data.push(`Its sequence is the RefSeq transcript ${from.accession} ${cite('refseq')}${day ? `, retrieved from NCBI ${day}` : ''}, numbered from its coding sequence (${from.feature.replace(/^CDS /, '')})${from.check?.status === 'identical' ? ', whose translation is the record\'s protein' : ''}.`);
    else if (from.service === 'Ensembl') data.push(`Its sequence is the Ensembl transcript ${from.accession} ${cite('ensembl')}${day ? `, retrieved ${day}` : ''}${from.versionDiffers ? `; the data name ${from.named}, an earlier version, and every variant's reference base was checked against the one retrieved` : ''}.`);
    else data.push(`Its sequence is ${from.whole ? 'the GenBank record' : `the coding sequence (${from.feature.replace(/^CDS /, '')}) of the GenBank record`} ${from.accession}${from.file ? ` (${from.file})` : ''}${from.check?.status === 'identical' ? ', whose translation is the record\'s protein' : ''}.`);
  }
  // Nucleotide variants read at the protein level (wave 3, slice 3).
  if (design.variants.level !== 'protein' && target?.sequenceType === 'dna') {
    data.push(`Each nucleotide variant was read for the protein change it makes: applied to the target's sequence, the two coding sequences translated and compared as HGVS describes protein changes, as biocommons hgvs does ${cite('hgvs')}. For the map, the nucleotide variants making the same protein change were merged as DiMSum merges them ${cite('dimsum')}: their scores weighted by 1/SE², the merged SE √(1/Σ 1/SE²)${published ? ' (averaged unweighted where the table gives no SE)' : ''}; those changing one amino acid and leaving another codon synonymous were left out, and frameshifts, splice-site, intronic and UTR variants are reported beside the map.`);
  }
  // MaveDB's mapping of the variants to the human reference, kept with the table.
  if (origin?.mapped) data.push(`MaveDB's mapping of the variants to the human reference ${cite('mavedbMapping')}, with each one's GA4GH VRS identifier ${cite('vrs')}, was kept with the table (${origin.mapped.variants} variants${origin.mapped.retrieved ? `, retrieved ${String(origin.mapped.retrieved).slice(0, 10)}` : ''}).`);
  // Its check against its UniProt entry (wave 3, slice 1), kept with the workspace's target, when
  // the run's target is still as it was checked.
  const checked = target ? (ws.targets ?? []).find((t) => t.id === target.id)?.reference : null;
  if (checked && checked.accession === target.identifiers?.uniprot && checked.offset === (target.offset ?? 0)) {
    data.push(`Its position in the reference was checked against UniProt ${checked.accession} ${cite('uniprot')}${checked.release ? `, release ${checked.release}` : ''}${checked.retrieved ? `, retrieved ${checked.retrieved.slice(0, 10)}` : ''}: residues ${checked.start}–${checked.end}${checked.identical ? ', identical' : `, ${checked.differences} difference${checked.differences === 1 ? '' : 's'}`}.`);
  }
  if (design.source?.citation) {
    data.push(`The data are from ${design.source.citation.replace(/,?\s*doi:\s*\S+$/i, '')} ${cite('data', { type: 'misc', text: `${design.source.citation}${design.source.mavedb ? `. MaveDB ${design.source.mavedb}` : ''}${design.source.license ? ` (${design.source.license})` : ''}.`, title: design.source.citation, note: design.source.mavedb ?? null })}${design.source.mavedb ? `, MaveDB ${design.source.mavedb}` : ''}.`);
  }
  paragraphs.push(data.join(' '));

  // The design, and what the assay measures (left out when the design does not say); then what was
  // not recorded with the counts, and what that meant (wave 2, slice 10: never filled by guessing).
  const missing = source ? notRecorded(readiness({ ...ws, design, designSource: source.id }, { design })) : [];
  paragraphs.push(`Design: ${summarizeDesign(design).lines.filter((line) => design.readout || !line.startsWith('Readout:')).join(' ')}${missing.length ? ` Not recorded with the counts: ${missing.join('; ')}.` : ''}`);

  // Scoring.
  const scoring = [];
  if (published) {
    // Published scores (wave 3, slice 2): read, not computed.
    const sc = design.scores ?? {};
    const f = p.filters;
    const left = [f.maxSE !== null ? `SE above ${f.maxSE}` : null, f.excludeKinds.length ? `classes ${f.excludeKinds.join(', ')}` : null, f.exclude.length ? `${f.exclude.length} variants by name` : null].filter(Boolean);
    scoring.push(`Scores are as published, read from the column "${sc.score}"${sc.se ? ` with standard errors from "${sc.se}"` : ' (the table gives no standard errors)'}${sc.ciLow ? ` and 95% intervals from "${sc.ciLow}" and "${sc.ciHigh}"` : sc.se ? '; 95% intervals are ±1.96 SE' : ''}: MaveScape did not rescore them. A variant whose name is not valid against the target, or to which the table gives no score, is reported as NA${left.length ? `, as are those left out by filter (${left.join('; ')})` : ''}.`);
    scoring.push(`${run.output.conditions[0]?.scored ?? 0} of ${run.output.variants} variants have a score.`);
    if (run.warnings.length) scoring.push(`Notes: ${run.warnings.map((w) => w.message).join(' ')}`);
  } else if (p.model === 'dimsum') {
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
  else if (p.model === 'ratio') scoring.push(`Scores are natural-log ratios of each variant's frequency after selection to before${design.model === 'time-series' ? ` (the first and last time points${p.timeScale === 'unit' ? `, over the time between them: a score per ${unitOf(design)}` : ''})` : ''} ${cite('enrich2')}, normalized by the ${NORMALIZATIONS[p.normalization]}, with a pseudocount of ${p.pseudocount}; a replicate's standard error is the square root of the summed reciprocal counts${p.normalization === 'synonymous' ? '' : ' and normalizers'}.`);
  else if (p.model === 'wls' || p.model === 'ols') scoring.push(regressionSentence(p, cite('enrich2'), design).replace(/ \((\[\d+\])\)/, ' $1'));
  else scoring.push(binSentence(p, { average: cite('vampseq'), mle: cite('peterman') }).replace(/ \((\[\d+\])\)/, ' $1'));
  if (!published) countsScoring();
  paragraphs.push(scoring.join(' '));

  // The rest of a run scored from counts: technical and biological replicates, their combination,
  // heterogeneity, filters, rescaling, conditions, and the counts of scored variants.
  function countsScoring() {
  if (design.library?.level === 'barcode') scoring.push(barcodeSentence(p, p.aggregation === 'sum' ? { enrich2: cite('enrich2') } : { dmsVariants: cite('dmsVariants') }).replace(/ \((\[\d+\])\)/, ' $1'));
  scoring.push('Technical replicates were summed before scoring; biological replicates were scored separately.');
  if (p.combination === 'moderated') {
    // The fitted model, from the run record (wave 2, slice 9).
    const models = run.output.conditions.filter((c) => c.errorModel);
    const g = (x) => String(Number(x.toPrecision(3)));
    const fitted = models.map((c) => {
      const m = c.errorModel;
      return `${models.length > 1 ? `in ${c.name}, ` : ''}${m.fitted ? `a = ${g(m.a)} and b = ${g(m.b)}` : 'a = 1 and b = 0 (too few pairs of replicates to fit)'}${m.bReference > 0 ? `, the replicates' shared shift adding ${g(m.bReference)}` : ''}, and a prior dispersion of ${g(m.phiPrior)} on ${Number.isFinite(m.dfPrior) ? g(m.dfPrior) : 'infinite'} degrees of freedom`;
    });
    scoring.push(`Replicate scores were combined under a shared error model, each replicate score's variance a·s² + b with s² its counting variance${p.model === 'wls' || p.model === 'ols' ? ' (a slope\'s from counting alone)' : ''}, fitted to the differences between replicates of the same variant as DiMSum's multiplicative and additive error terms ${cite('dimsum')}; the variation of each replicate's shared shift (its median departure from the variants' means) was added to every replicate's variance. Each variant's dispersion about the model was moderated across variants by empirical Bayes, as limma moderates variances ${cite('limma')}, and 95% intervals use t with the prior's degrees of freedom plus the variant's${models.length ? `: ${fitted.join('; ')}` : ''}.${(run.info ?? []).some((x) => /covariance its counting error implies/.test(x)) ? ' Replicates sharing an input sample were combined with the covariance of its counting error (generalized least squares).' : ''}`);
  } else if (p.combination === 'reml') scoring.push(`Replicate scores were combined by inverse-variance weighting with a between-replicate variance τ² estimated by restricted maximum likelihood ${cite('reml')}, by Fisher scoring as in metafor ${cite('metafor')}.`);
  else if (p.combination === 'fixed') scoring.push('Replicate scores were combined by inverse-variance weighting (fixed effects).');
  else if (p.combination === 'mean') scoring.push('Replicate scores were combined by their mean, with SE their standard deviation over the square root of their number.');
  else scoring.push(`Replicate scores were combined by Enrich2's random-effects estimator ${cite('enrich2')} as implemented in Enrich2 2.0.2 (50 iterations from its starting value).`);
  scoring.push(`Heterogeneity is reported as Cochran's Q and I² ${cite('higgins')}, with the largest change in a score when one replicate is left out.`);
  scoring.push(`Filters, in order: ${describeFilters(p.filters, null, p.model === 'wls' || p.model === 'ols', design.library?.level === 'barcode').filter((x) => x.active !== false).map((x) => x.text.charAt(0).toLowerCase() + x.text.slice(1)).join('; ')}. A filtered variant's score is reported as NA with the stage that removed it.`);
  if (p.rescale !== 'none') {
    // The anchors' uncertainty, shared by every score, reported apart (wave 2, slice 9).
    const scale = options.results ? anchorUncertainty(options.results, design, 0) : null;
    const g = (x) => String(Number(x.toPrecision(2)));
    scoring.push(`Scores were rescaled so that ${RESCALINGS[p.rescale].label}${run.output.conditions[0]?.rescale ? ` (${run.output.conditions[0].rescale.anchors.map((a) => `${a.what} ${Number(a.from.toFixed(4))} to ${a.to}`).join(', ')})` : ''}. The anchors' own uncertainty${scale && scale.anchors.every((a) => Number.isFinite(a.se)) ? ` (SE ${scale.anchors.map((a) => `${g(a.se)} at the ${a.what}${a.what === 'wild type' ? '' : ' median'}`).join(', ')})` : ''}, which moves every score together, was propagated by the delta method and is reported apart from each score's SE (SE_scale).`);
  }
  if (p.differential && (design.conditions?.length ?? 0) >= 2) {
    const strip = (text) => text.replace(/ \((\[\d+\])\)/g, ' $1');
    const keys = p.differential === 'limma' ? { limma: 'limma', voom: 'voom', mutscan: 'mutscan' } : p.differential === 'independent' ? { enrich2: 'enrich2' } : {};
    const cites = Object.fromEntries(Object.entries(keys).map(([k, ref]) => [k, cite(ref)]));
    scoring.push(strip(differentialSentence(p, design, { ...cites, bh: cite('bh') })));
  }
  const conditions = run.output.conditions.map((c) => `${run.output.conditions.length > 1 ? `${c.name}: ` : ''}${c.scored} of ${run.output.variants} variants scored`).join('; ');
  scoring.push(`${conditions}.`);
  if (run.warnings.length) scoring.push(`Notes: ${run.warnings.map((w) => w.message).join(' ')}`);
  }

  // Quality control.
  if (options.findings) {
    const f = options.findings;
    const flagged = f.filter((x) => x.status === 'review' || x.status === 'fail');
    const bottleneck = flagged.some((x) => x.id === 'excess-variance');
    const acknowledged = flagged.filter((x) => x.acknowledged?.current);
    paragraphs.push(`Quality control: ${f.filter((x) => x.status === 'pass').length} findings passed, ${f.filter((x) => x.status === 'review').length} were to review and ${f.filter((x) => x.status === 'fail').length} failed${f.some((x) => x.status === 'na') ? ` (${f.filter((x) => x.status === 'na').length} not assessed)` : ''}.${flagged.length ? ` ${flagged.map((x) => `${x.title}: ${x.value} (${x.status}; ${x.threshold})`).join('. ')}.` : ''}${acknowledged.length ? ` ${acknowledged.length === 1 ? 'One finding was' : `${acknowledged.length} findings were`} acknowledged, ${acknowledged.length === 1 ? 'its status' : 'their statuses'} unchanged: ${acknowledged.map((x) => `${x.title.charAt(0).toLowerCase()}${x.title.slice(1)} ("${x.acknowledged.reason.replace(/[.\s]+$/, '')}")`).join('; ')}.` : ''}${bottleneck ? ` Variance beyond counting is read as in DiMSum's error model ${cite('dimsum')}.` : ''} Thresholds are recorded with the workspace.`);
  }

  // The annotations beside the map (wave 3, slice 5): each one's source, release and date, and
  // how MaveScape read it.
  const annotations = ws.annotations ?? [];
  if (annotations.length) {
    const lines = annotations.map((a) => annotationSentence(a, cite)).filter(Boolean);
    if (lines.length) paragraphs.push(`Annotations shown beside the map: ${lines.join(' ')}`);
  }

  // Software.
  const sw = run.software;
  const mavescape = { type: 'software', authors: ['McDermott, Robert'], title: 'MaveScape', version: sw.version, year: Number((run.created ?? '').slice(0, 4)) || null, url: 'https://github.com/robert-mcdermott/mavescape' };
  paragraphs.push(`Analyses were made with MaveScape ${sw.version}${sw.commit ? ` (commit ${sw.commit.slice(0, 12)})` : ''} ${cite('mavescape', mavescape)}, scoring version ${sw.scoring}; the run ${run.id} has output SHA-256 ${run.output.sha256}, and its scores can be recomputed from the recorded inputs. MaveScape reports experimental functional effects for research; it does not classify variants as pathogenic or benign.`);

  const references = cited.map(({ key, ref }, i) => ({ n: i + 1, key, text: referenceText(ref) }));
  const markdown = `# Methods\n\n${paragraphs.join('\n\n')}\n\n## References\n\n${references.map((r) => `${r.n}. ${r.text}`).join('\n')}\n`;
  return { paragraphs, references, markdown, bibtex: toBibTeX(cited) };
}

// An annotation in the methods: what it is, where from and when, and what MaveScape did with it.
function annotationSentence(a, cite) {
  const r = a.record ?? {};
  const day = r.retrieved ? `, retrieved ${String(r.retrieved).slice(0, 10)}` : '';
  switch (a.provider) {
    case 'uniprot-features':
      return `UniProt ${r.accession}'s features ${cite('uniprot')}${r.release ? ` (release ${r.release}${day})` : day.replace(/^, /, ' (') + (day ? ')' : '')}, placed by the target's offset.`;
    case 'pdbe-conservation':
      return `conservation from PDBe-KB's profile of ${r.accession}'s homologues ${cite('pdbekb')} ${cite('threedpatch')}${day}, each position scored as the Jensen–Shannon divergence of its amino-acid probabilities from the BLOSUM62 background ${cite('capra2007')}.`;
    case 'alphamissense':
      return `AlphaMissense's pathogenicity of ${r.accession}'s substitutions ${cite('alphamissense')}, from AlphaFold DB ${cite('alphafolddb')}${day} (CC BY 4.0; not for clinical use).`;
    case 'clinvar':
      return `ClinVar's records of ${r.gene}'s missense, nonsense and synonymous variants ${cite('clinvar')}${day} (${r.kept ?? '?'} of ${r.records ?? '?'} records read), placed where their protein's residues agree with the target's.`;
    case 'gnomad':
      return `gnomAD v4's allele frequencies of ${r.gene}'s variants on ${r.transcript}${r.mane ? ` (MANE Select, ${r.mane})` : ''} ${cite('gnomad')}${day}, exomes and genomes joined, variants failing gnomAD's filters left out.`;
    case 'mavedb-annotations':
      return `MaveDB's annotations of ${r.urn}'s variants ${cite('mavedbMapping')}${r.clinvar ? `: ClinVar ${r.clinvar} ${cite('clinvar')} and gnomAD ${cite('gnomad')}` : `: gnomAD ${cite('gnomad')}`}${day}.`;
    case 'alignment':
      return `conservation from the alignment ${r.file ?? a.file?.fileName} (SHA-256 ${a.file?.sha256}), scored as Capra and Singh's score_conservation.py scores it by default ${cite('capra2007')}: the Jensen–Shannon divergence from the BLOSUM62 background, with position-based sequence weights ${cite('henikoff1994')}, a gap penalty, columns of more than 30% gaps unscored and a window of 3.`;
    case 'predictor':
      return `a predictor's scores from ${r.file ?? a.file?.fileName} (SHA-256 ${a.file?.sha256}).`;
    case 'custom':
      return `the custom track ${r.file ?? a.file?.fileName} (SHA-256 ${a.file?.sha256}).`;
    default:
      return null;
  }
}

