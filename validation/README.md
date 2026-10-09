# Validation

`node validation/run.mjs [suite …] [--verbose] [--require-data]` runs the validation suites and
exits with status 1 when a check fails. Each check states what is compared, the value found and
the tolerance required.

| Suite | What it checks | Data |
| --- | --- | --- |
| `accessibility` | WCAG AA contrast of every text-on-surface pair in both themes, with color-vision-friendly colors off and on; palettes, status colors and score maps apart in protanopia, deuteranopia and tritanopia (Machado et al. 2009, CIEDE2000) | `web/styles.css` |

Later slices add the reference comparisons (Enrich2, DiMSum, dms_variants, mutscan, mavehgvs),
whose outputs are committed in `validation/reference/` with the tool versions that produced them,
and public data sets fetched and checksummed by `validation/fetch.mjs` into `validation/cache/`
(not stored in the repository). See `mavescape-spec/requirements.md`, T1–T3.
