"""Brnich et al. 2019's modeled OddsPath, read from the paper's own spreadsheet
(validation/reference/brnich-oddspath.json).

Brnich SE, Abou Tayoun AN, Couch FJ, et al. Recommendations for application of the functional
evidence PS3/BS3 criterion using the ACMG/AMP sequence variant interpretation framework. Genome
Medicine 2020;12:3 (published 31 December 2019). doi:10.1186/s13073-019-0690-2. Open access,
CC BY 4.0. Additional file 1 (13073_2019_690_MOESM1_ESM.xlsx, MD5 d6be13538a2721ab0a5716d550c9841a)
models the OddsPath an assay's classified controls give: Table S1 a perfect binary readout, Table
S2 one control (benign or pathogenic) indeterminate. Europe PMC serves it:

    curl -L -o supp.zip https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6938631/supplementaryFiles
    unzip supp.zip 13073_2019_690_MOESM1_ESM.xlsx

Run with any Python 3 (the standard library only), from the repository root:

    python3 -I validation/reference/extract_brnich_oddspath.py path/to/13073_2019_690_MOESM1_ESM.xlsx

Each row is written with its counts (total, pathogenic, benign; functionally abnormal,
indeterminate, normal) and the two OddsPath values the spreadsheet computed and saved (its columns
"Pathogenic" and "Benign" under OddsPath: the abnormal readout's and the normal readout's), as the
spreadsheet holds them. In the paper's model the abnormal readouts are pathogenic controls and the
normal ones benign: P1 is the pathogenic share of all controls, P2 the abnormal readouts' share
with one misclassified control added, E / (E + 1), or that of the added pathogenic control among
the normal readouts, 1 / (N + 1). MaveScape must give the same (validation suite `calibration`).
"""

import json
import os
import sys
import zipfile
from xml.etree import ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "validation", "reference", "brnich-oddspath.json")
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def sheets(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    book = ET.fromstring(z.read("xl/workbook.xml"))
    out = {}
    for k, sheet in enumerate(book.find("m:sheets", NS), 1):
        cells = {}
        for c in ET.fromstring(z.read(f"xl/worksheets/sheet{k}.xml")).iter("{%s}c" % NS["m"]):
            v = c.find("m:v", NS)
            if v is None or v.text is None:
                continue
            cells[c.get("r")] = shared[int(v.text)] if c.get("t") == "s" else float(v.text)
        out[sheet.get("name")] = cells
    return out


def rows(cells, columns, first=7, last=200):
    """The table's rows: a number in the pathogenic column; the total carried down its group."""
    out = []
    total = None
    for r in range(first, last):
        if isinstance(cells.get(f"A{r}"), float):
            total = cells[f"A{r}"]
        if not isinstance(cells.get(f"{columns['P']}{r}"), float):
            continue
        row = {"row": r, "total": int(total)}
        for name, col in columns.items():
            value = cells[f"{col}{r}"]
            row[name] = int(value) if name not in ("abnormalOddsPath", "normalOddsPath", "prior") else value
        out.append(row)
    return out


def main():
    book = sheets(sys.argv[1])
    s1 = book["SuppTable1_Perfect_Binary"]
    s2 = book["SuppTable2_One_Indeterminate"]
    table1 = rows(s1, {"P": "B", "B": "C", "prior": "D", "abnormal": "E", "normal": "F", "abnormalOddsPath": "I", "normalOddsPath": "J"})
    table2 = rows(s2, {"P": "B", "B": "C", "prior": "D", "abnormal": "E", "indeterminate": "F", "normal": "G", "abnormalOddsPath": "J", "normalOddsPath": "K"})
    with open(OUT, "w", encoding="utf8") as f:
        json.dump({
            "source": "Brnich et al. 2019, Genome Medicine 12:3, doi:10.1186/s13073-019-0690-2, Additional file 1 (13073_2019_690_MOESM1_ESM.xlsx, MD5 d6be13538a2721ab0a5716d550c9841a), CC BY 4.0",
            "method": "Each table's rows as the spreadsheet holds them: its counts and the OddsPath values it computed and saved, OddsPath = [P2 x (1 - P1)] / [(1 - P2) x P1], P1 = P / total, P2 = abnormal / (abnormal + 1) for the abnormal readouts and 1 / (normal + 1) for the normal ones.",
            "table3": "Evidence strength equivalent of OddsPath (the paper's Table 3): < 0.053 BS3; < 0.23 BS3_moderate; < 0.48 BS3_supporting; 0.48-2.1 Indeterminate; > 2.1 PS3_supporting; > 4.3 PS3_moderate; > 18.7 PS3; > 350 PS3_very_strong. No benign code beyond strong.",
            "tableS1": table1,
            "tableS2": table2,
        }, f, indent=1)
        f.write("\n")
    print(f"Wrote {len(table1)} rows of Table S1 and {len(table2)} of Table S2 to {OUT}")


if __name__ == "__main__":
    main()
