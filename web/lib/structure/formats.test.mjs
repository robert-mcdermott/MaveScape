// Copied from Proteoscope 0.10.0 (web/lib/formats.test.mjs, Apache-2.0, the same author): its
// tests of the BinaryCIF reader and of how a structure's format is told, the formats MaveScape
// copies.

import assert from 'node:assert/strict';
import test from 'node:test';
import { binaryCIFToText, decodeData, decodeMessagePack, isBinaryCIF } from './bcif.js';
import { packMessagePack as pack } from './test-data.mjs';
import { detectStructureFormat, parseStructure } from './parse.js';

const bytesOf = (typed) => new Uint8Array(typed.buffer.slice(0));
const int32Column = (name, values) => ({ name, data: { encoding: [{ kind: 'ByteArray', type: 3 }], data: bytesOf(Int32Array.from(values)) }, mask: null });
const stringColumn = (name, values, mask = null) => {
  const unique = [...new Set(values)];
  const offsets = [0];
  for (const item of unique) offsets.push(offsets[offsets.length - 1] + item.length);
  return {
    name,
    data: {
      encoding: [{ kind: 'StringArray', dataEncoding: [{ kind: 'ByteArray', type: 3 }], stringData: unique.join(''), offsetEncoding: [{ kind: 'ByteArray', type: 3 }], offsets: bytesOf(Int32Array.from(offsets)) }],
      data: bytesOf(Int32Array.from(values.map((item) => unique.indexOf(item)))),
    },
    mask: mask ? { encoding: [{ kind: 'ByteArray', type: 4 }], data: Uint8Array.from(mask) } : null,
  };
};
const fixedColumn = (name, values, factor = 1000) => ({
  name,
  data: {
    encoding: [{ kind: 'FixedPoint', factor, srcType: 33 }, { kind: 'Delta', origin: 0, srcType: 3 }, { kind: 'IntegerPacking', byteCount: 1, isUnsigned: false, srcSize: values.length }, { kind: 'ByteArray', type: 1 }],
    data: (() => {
      const ints = values.map((value) => Math.round(value * factor));
      const deltas = ints.map((value, index) => (index ? value - ints[index - 1] : value));
      const packed = [];
      for (const delta of deltas) {
        let rest = delta;
        while (rest >= 127) { packed.push(127); rest -= 127; }
        while (rest <= -128) { packed.push(-128); rest += 128; }
        packed.push(rest);
      }
      return bytesOf(Int8Array.from(packed));
    })(),
  },
  mask: null,
});

test('BinaryCIF decodes every column encoding and becomes parseable mmCIF text', () => {
  assert.deepEqual(Array.from(decodeData({ encoding: [{ kind: 'RunLength', srcType: 3, srcSize: 5 }, { kind: 'ByteArray', type: 3 }], data: bytesOf(Int32Array.from([7, 3, 9, 2])) })), [7, 7, 7, 9, 9]);
  assert.deepEqual(Array.from(decodeData({ encoding: [{ kind: 'IntervalQuantization', min: 0, max: 1, numSteps: 3, srcType: 32 }, { kind: 'ByteArray', type: 4 }], data: Uint8Array.from([0, 1, 2]) })), [0, 0.5, 1]);
  assert.deepEqual(decodeMessagePack(Uint8Array.from([0x92, 0xa1, 0x41, 0xff])), ['A', -1]);

  const atoms = [
    ['ATOM', 'N', 'MET', 'A', 1, 27.34, 24.43, 2.614],
    ['ATOM', 'CA', 'MET', 'A', 1, 26.266, 25.413, 2.842],
    ['HETATM', 'C1', 'HEM', 'A', 142, -5.5, 10.25, -300.125],
  ];
  const file = {
    version: '0.3.0',
    encoder: 'test',
    dataBlocks: [{
      header: '1TST',
      categories: [
        { name: '_entry', rowCount: 1, columns: [stringColumn('id', ['1TST'])] },
        { name: '_struct', rowCount: 1, columns: [stringColumn('title', ["N,N'-dimethyl \"test\" structure"])] },
        {
          name: '_atom_site',
          rowCount: atoms.length,
          columns: [
            stringColumn('group_PDB', atoms.map((atom) => atom[0])),
            int32Column('id', [1, 2, 3]),
            stringColumn('type_symbol', ['N', 'C', 'C']),
            stringColumn('label_atom_id', atoms.map((atom) => atom[1])),
            stringColumn('label_comp_id', atoms.map((atom) => atom[2])),
            stringColumn('label_asym_id', ['A', 'A', 'B']),
            stringColumn('auth_asym_id', atoms.map((atom) => atom[3])),
            int32Column('auth_seq_id', atoms.map((atom) => atom[4])),
            stringColumn('pdbx_PDB_ins_code', ['', '', ''], [2, 2, 2]),
            fixedColumn('Cartn_x', atoms.map((atom) => atom[5])),
            fixedColumn('Cartn_y', atoms.map((atom) => atom[6])),
            fixedColumn('Cartn_z', atoms.map((atom) => atom[7])),
            int32Column('pdbx_PDB_model_num', [1, 1, 1]),
          ],
        },
      ],
    }],
  };
  const bytes = pack(file);
  assert.ok(isBinaryCIF(bytes));
  assert.ok(!isBinaryCIF(new TextEncoder().encode('data_1TST\n')));
  const text = binaryCIFToText(bytes);
  assert.match(text, /^data_1TST/);
  assert.match(text, /"N,N'-dimethyl "test" structure"|\n;N,N'-dimethyl "test" structure\n;/);
  const structure = parseStructure(text, '1tst.cif');
  const [n, ca, heme] = structure.models[0].atoms;
  assert.equal(structure.meta.code, '1TST');
  assert.equal(n.name, 'N');
  assert.equal(ca.x, 26.266);
  assert.equal(heme.z, -300.125);
  assert.equal(heme.resName, 'HEM');
  assert.equal(heme.iCode, '');
});

test('structure format follows the name unless an mmCIF name holds PDB records', () => {
  const pdb = 'ATOM      1  N   MET A   1      28.179   0.444  24.245  1.00 41.86           N\nEND\n';
  const cif = '# written by a predictor\ndata_x\nloop_\n_atom_site.id\nATOM   1    N N . MET A 1 1\n';
  assert.equal(detectStructureFormat(pdb, 'model.pdb').kind, 'pdb');
  assert.equal(detectStructureFormat(pdb, 'result_seed-1.cif').kind, 'pdb', 'no data block: PDB text under a .cif name');
  assert.equal(detectStructureFormat(cif, 'model.cif').kind, 'mmcif');
  assert.equal(detectStructureFormat('', 'empty.cif').kind, 'mmcif', 'nothing to go on: trust the name');
  assert.equal(detectStructureFormat(cif, 'upload').kind, 'mmcif');
  assert.equal(parseStructure(pdb, 'model.cif').models[0].atoms.length, 1);
  // Protenix marks its models in the data block name; their B-factors are pLDDT.
  const protenix = parseStructure(['data_job_sample_0_predicted_by_protenix', 'loop_', ...['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_comp_id', 'label_asym_id', 'label_seq_id', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'B_iso_or_equiv'].map((name) => `_atom_site.${name}`), 'ATOM 1 C CA MET A 1 0.0 0.0 0.0 43.07', ''].join('\n'), 'job_sample_0.cif');
  assert.equal(protenix.meta.isPredicted, true);
});
