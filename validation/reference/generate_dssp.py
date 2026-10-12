"""DSSP's secondary structure and solvent accessibility of the examples' PDB entries, as the DSSP
databank publishes them (validation/reference/dssp.json).

Run from the repository root (any Python with gemmi; `python -m venv env && env/bin/pip install
gemmi`):

    env/bin/python -I validation/reference/generate_dssp.py

For each PDB entry the validation keeps for an example protein (validation/structure-cases.mjs),
the DSSP databank's file (https://pdb-redo.eu/dssp/db/<id>/mmcif: mkdssp's own output for the
entry, DSSP 4) is downloaded and read with gemmi (MPL-2.0), an mmCIF reader independent of
MaveScape's. Its _dssp_struct_summary category gives, for every residue of the entry's protein
chains (by label_asym_id and label_seq_id), DSSP's secondary structure code (H, G, I, P, E, B, T,
S, or none) and its accessibility (Å², water-accessible surface, DSSP's own atom radii).
web/lib/structure-evidence.js must assign the same secondary structure with Proteoscope's dssp.js
and find accessibility as DSSP does (validation suite `structures`). The file's SHA-256, the DSSP
version that wrote it and the date it was retrieved are recorded.
"""

import datetime
import hashlib
import json
import os
import urllib.request

import gemmi

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "validation", "reference", "dssp.json")
ENTRIES = ["2VWF", "1JM7", "2CG9", "1RX2", "1RFN", "1TUP", "1D5R"]
AGENT = "MaveScape validation (validation/reference/generate_dssp.py)"


def summary(block):
    table = block.find("_dssp_struct_summary.", ["label_asym_id", "label_seq_id", "label_comp_id", "secondary_structure", "accessibility"])
    chains = {}
    for row in table:
        asym, seq, comp, ss, acc = (gemmi.cif.as_string(row[i]) for i in range(5))
        code = "" if ss in ("", ".", "?") else ss
        accessibility = None if acc in ("", ".", "?") else float(acc)
        chains.setdefault(asym, []).append([int(seq), comp, code, accessibility])
    return chains


def version(block):
    table = block.find("_software.", ["name", "version"])
    for row in table:
        if gemmi.cif.as_string(row[0]).upper() == "DSSP":
            return gemmi.cif.as_string(row[1])
    return ""


def main():
    entries = {}
    for entry in ENTRIES:
        url = f"https://pdb-redo.eu/dssp/db/{entry.lower()}/mmcif"
        request = urllib.request.Request(url, headers={"User-Agent": AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        block = gemmi.cif.read_string(data.decode("utf-8")).sole_block()
        scheme = block.find("_pdbx_poly_seq_scheme.", ["asym_id", "pdb_strand_id"])
        authors = {gemmi.cif.as_string(r[0]): gemmi.cif.as_string(r[1]) for r in scheme}
        chains = summary(block)
        entries[entry] = {
            "url": url,
            "sha256": hashlib.sha256(data).hexdigest(),
            "dssp": version(block),
            "chains": {asym: {"author": authors.get(asym, ""), "residues": rows} for asym, rows in chains.items()},
        }
        print(entry, entries[entry]["dssp"], {asym: len(rows) for asym, rows in chains.items()})
    out = {
        "source": "The DSSP databank's mmCIF of each entry (mkdssp's output), its _dssp_struct_summary category read with gemmi: each residue of the entry's protein chains by label_asym_id, as [label_seq_id, residue, secondary structure code ('' for none), accessibility in Å² (null where DSSP gives none)]",
        "retrieved": datetime.date.today().isoformat(),
        "tool": {"name": "gemmi", "version": gemmi.__version__},
        "entries": entries,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
