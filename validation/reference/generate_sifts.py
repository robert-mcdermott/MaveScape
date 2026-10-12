"""Residue-level SIFTS of the examples' PDB entries, as PDBe publishes it
(validation/reference/sifts.json).

Run from the repository root (any Python with gemmi; `python -m venv env && env/bin/pip install
gemmi`):

    env/bin/python -I validation/reference/generate_sifts.py

For each PDB entry the validation keeps for an example protein (validation/structure-cases.mjs),
PDBe's updated mmCIF (https://www.ebi.ac.uk/pdbe/entry-files/download/<id>_updated.cif.gz) is
downloaded and read with gemmi (MPL-2.0), an mmCIF reader independent of MaveScape's. Its
_pdbx_sifts_xref_db category gives SIFTS's mapping of every residue of the entry's sequence
(chain, by its label_asym_id, and sequence number, label_seq_id) to a UniProt residue (accession,
number, amino acid) and whether it is observed. web/lib/mapping.js, which aligns each example's
target to the entry's chains instead, must place every residue where SIFTS does (validation suite
`structures`). The file's SHA-256 and the date it was retrieved are recorded.
"""

import datetime
import gzip
import hashlib
import json
import os
import urllib.request

import gemmi

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "validation", "reference", "sifts.json")
ENTRIES = ["2VWF", "1JM7", "2CG9", "1RX2", "1RFN", "1TUP", "1D5R"]
AGENT = "MaveScape validation (validation/reference/generate_sifts.py)"


def residues(block):
    table = block.find("_pdbx_sifts_xref_db.", ["asym_id", "seq_id", "mon_id", "unp_acc", "unp_num", "unp_res", "observed"])
    out = {}
    for row in table:
        asym, seq, mon, acc, num, res, observed = (gemmi.cif.as_string(row[i]) for i in range(7))
        if not acc or acc in ("?", ".") or not num or num in ("?", "."):
            continue
        key = (asym, int(seq))
        value = [acc, int(num), res, observed == "y"]
        # One row per residue and cross-referenced domain: the UniProt columns repeat.
        if key in out and out[key] != value:
            raise ValueError(f"{key}: {out[key]} and {value}")
        out[key] = value
    chains = {}
    for (asym, seq), (acc, num, res, observed) in sorted(out.items()):
        chains.setdefault(asym, []).append([seq, acc, num, res, observed])
    return chains


def main():
    entries = {}
    for entry in ENTRIES:
        url = f"https://www.ebi.ac.uk/pdbe/entry-files/download/{entry.lower()}_updated.cif.gz"
        request = urllib.request.Request(url, headers={"User-Agent": AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        text = gzip.decompress(data).decode("utf-8")
        block = gemmi.cif.read_string(text).sole_block()
        # The label chain each author chain is (pdbx_poly_seq_scheme), to name both.
        scheme = block.find("_pdbx_poly_seq_scheme.", ["asym_id", "pdb_strand_id"])
        authors = {gemmi.cif.as_string(r[0]): gemmi.cif.as_string(r[1]) for r in scheme}
        chains = residues(block)
        entries[entry] = {
            "url": url,
            "sha256": hashlib.sha256(data).hexdigest(),
            "chains": {asym: {"author": authors.get(asym, ""), "residues": rows} for asym, rows in chains.items()},
        }
        print(entry, {asym: len(rows) for asym, rows in chains.items()})
    out = {
        "source": "PDBe's updated mmCIF of each entry, its _pdbx_sifts_xref_db category read with gemmi: each residue of the entry's sequence by label_asym_id and label_seq_id, as [label_seq_id, UniProt accession, UniProt number, UniProt residue, observed]",
        "retrieved": datetime.date.today().isoformat(),
        "tool": {"name": "gemmi", "version": gemmi.__version__},
        "entries": entries,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
