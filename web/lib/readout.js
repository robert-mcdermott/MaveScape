// What the assay measures (wave 2, slice 8; requirement E7): the design's readout. A score's sign
// means nothing without the selection: in a selection for function, a variant that becomes rarer
// has lost some of it, but an assay can as well enrich the variants that lose function (a toxic
// protein, a sort for a dim reporter). The readout says which, and the legend, the separation of
// the controls, the methods and the exports read it from here; until it is stated, MaveScape says
// it assumes the common case (a higher score means more of the function) rather than guessing.
//
// The terms are MaveDB's controlled keywords for an experiment (retrieved 2026-10-09 from
// api.mavedb.org, /api/v1/controlled-keywords), which implement the MAVE minimum information's
// controlled vocabulary (Claussnitzer et al. 2024, doi:10.1186/s13059-024-03223-9; the
// vocabulary ave-dcd/mave_vocabulary, CC BY 4.0), so that a design can fill a MaveDB deposit
// (wave 3). A term outside these lists is kept as written, and exported as "Other".

// MaveDB's "Phenotypic Assay Method".
export const ASSAY_METHODS = [
  'Binding assay', 'Bulk RNA-sequencing', 'Cell fitness', 'Cell morphology assay', 'Cell proliferation assay',
  'Cell proliferation assay with genetic complementation', 'Direct protein function', 'Electrophysiological method',
  'Flow cytometry assay', 'Fluorescence in-situ hybridization (FISH) assay', 'Genetic complementation',
  'Homology-directed DNA repair frequency measurement', 'Imaging mass cytometry assay', 'Ion channel assay',
  'Localization assay', 'Multiplexed fluorescent antibody imaging', 'One-hybrid assay', 'Posttranslation modification assay',
  'Promoter activity detection by reporter gene assay', 'Protein stability assay', 'Reporter', 'Reporter gene assay',
  'Single cell imaging', 'Single-cell RNA sequencing assay', 'Survival assessment assay',
  'Systematic evolution of ligands by exponential enrichment assay', 'Other',
];

// MaveDB's "Phenotypic Assay Mechanism": which variants the assay was built to detect.
export const ASSAY_MECHANISMS = ['Loss of function', 'Gain of function', 'Gain or loss of function', 'Dominant-negative effect', 'Loss of function or dominant-negative effect', 'Other'];

// MaveDB's "Phenotypic Assay Model System".
export const MODEL_SYSTEMS = [
  'Bacteria', 'Bacteriophage', 'Yeast', 'Immortalized human cells', 'Induced pluripotent stem cells from human female',
  'Induced pluripotent stem cells from human male', 'Molecular display', 'Murine primary cells',
  'Patient derived primary cells (e.g. T-cells, adipocytes)', 'Other',
];

// MaveDB's "In Vitro Construct Library Method System": how the library was made.
export const LIBRARY_METHODS = [
  'Doped oligo synthesis', 'Error-prone PCR', 'Microarray synthesis', 'Nicking mutagenesis', 'Oligo-directed mutagenic PCR',
  'Oligo pool synthesis', 'Proprietary method', 'Site-directed mutagenesis', 'Other',
];

// Libraries whose variants are mostly one nucleotide away from the wild type: they reach the
// amino-acid substitutions a single base change makes (about a third of all), and the others
// rarely. Coverage is judged against those (qc.js).
export const SINGLE_NUCLEOTIDE_LIBRARIES = new Set(['Error-prone PCR', 'Doped oligo synthesis']);

// A term in running text: its first letter in lower case, an acronym kept ("Error-prone PCR" →
// "error-prone PCR"; "SELEX" stays).
export const inText = (term) => (/^[A-Z][a-z]/.test(term) ? term.charAt(0).toLowerCase() + term.slice(1) : term);

// What a higher score means.
export const DIRECTIONS = {
  'higher-more': 'a higher score means more of the function measured',
  'higher-less': 'a higher score means less of the function measured',
  unsigned: 'the score has no sign: higher means a larger change, either way',
};

// The readout of a design, completed: { phenotype, method, mechanism, modelSystem, direction,
// stated } (stated: the direction was given, not assumed).
export function readoutOf(design) {
  const r = design?.readout ?? {};
  const stated = Object.hasOwn(DIRECTIONS, r.direction);
  return {
    phenotype: r.phenotype ?? null,
    method: r.method ?? null,
    mechanism: r.mechanism ?? null,
    modelSystem: r.modelSystem ?? null,
    direction: stated ? r.direction : 'higher-more',
    stated,
  };
}

// The words for the two ends of the score scale: { low, high }, about the function when the
// direction is stated, plain "lower" and "higher" when it is not.
export function scaleWords(design) {
  const r = readoutOf(design);
  if (!r.stated) return { low: 'lower', high: 'higher', stated: false };
  if (r.direction === 'higher-more') return { low: 'less function', high: 'more function', stated: true };
  if (r.direction === 'higher-less') return { low: 'more function', high: 'less function', stated: true };
  return { low: 'lower', high: 'larger change', stated: true };
}

// Where loss-of-function controls (nonsense variants) should score against the wild type:
// 'below', 'above' or 'either' (no sign), and whether that was stated or assumed.
export function lossSide(design) {
  const r = readoutOf(design);
  return { side: r.direction === 'higher-more' ? 'below' : r.direction === 'higher-less' ? 'above' : 'either', stated: r.stated };
}

// The readout in words, for the design's summary and the methods: "Readout: what was measured.
// Assay: method, in model system, detecting mechanism. What a higher score means."
export function describeReadout(design) {
  const r = readoutOf(design);
  const sentences = [];
  if (r.phenotype) sentences.push(`${r.phenotype.replace(/[.\s]+$/, '')}.`);
  const assay = [r.method, r.modelSystem && `in ${inText(r.modelSystem)}`, r.mechanism && `detecting ${inText(r.mechanism)}`].filter(Boolean);
  if (assay.length) sentences.push(`Assay: ${assay.join(', ')}.`);
  const direction = r.stated ? `${DIRECTIONS[r.direction]}.` : 'its direction is not stated, so a higher score is taken to mean more of the function measured.';
  sentences.push(sentences.length ? direction.charAt(0).toUpperCase() + direction.slice(1) : direction);
  return `Readout: ${sentences.join(' ')}`;
}

// Checks a design's readout and library method into validateDesign's error and warn.
export function checkReadout(design, error, warn) {
  const r = design.readout;
  if (r !== undefined) {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) error('readout', 'The readout is an object: phenotype, method, mechanism, modelSystem, direction.');
    else {
      for (const key of Object.keys(r)) if (!['phenotype', 'method', 'mechanism', 'modelSystem', 'direction'].includes(key)) error(`readout.${key}`, `The readout has no field "${key}".`);
      for (const key of ['phenotype', 'method', 'mechanism', 'modelSystem']) if (r[key] !== undefined && typeof r[key] !== 'string') error(`readout.${key}`, `readout.${key} is text.`);
      if (r.direction !== undefined && !Object.hasOwn(DIRECTIONS, r.direction)) error('readout.direction', `The direction is one of ${Object.keys(DIRECTIONS).join(', ')}.`);
      const lists = { method: ASSAY_METHODS, mechanism: ASSAY_MECHANISMS, modelSystem: MODEL_SYSTEMS };
      for (const [key, list] of Object.entries(lists)) if (typeof r[key] === 'string' && r[key] && !list.includes(r[key])) warn(`readout.${key}`, `"${r[key]}" is not one of MaveDB's terms for the assay's ${key === 'modelSystem' ? 'model system' : key}; it is kept as written, and a MaveDB deposit would say "Other".`);
    }
  }
  const m = design.library?.method;
  if (m !== undefined && (typeof m !== 'string' || !m)) error('library.method', 'The library\'s method is text, as MaveDB names it (Error-prone PCR, Oligo pool synthesis…).');
  else if (m && !LIBRARY_METHODS.includes(m)) warn('library.method', `"${m}" is not one of MaveDB's terms for how a library was made; it is kept as written.`);
}
