// The structure viewer (wave 5, slice 1; requirement X1): one structure, drawn by Proteoscope's
// renderers (lib/structure/, copied): WebGPU (impostor spheres and cylinders, the cartoon,
// surfaces, ambient occlusion, picking), or, where the browser offers no WebGPU or ?renderer=canvas
// asks, the Canvas renderer (no surfaces, ambient occlusion or outlines). Rotate by dragging, pan
// with Shift or the right button, zoom with the wheel or a pinch; a click selects a residue (with
// ⌘, Ctrl or Shift, adds it), a double click focuses on its neighborhood. The scene, colors,
// selection flags, labels and camera follow Proteoscope 0.10.0's web/app.js (Apache-2.0, the same
// author), for one structure at a time. Surfaces are computed in a worker
// (workers/surface-worker.js).

import { h } from './dom.js';
import { WorkerClient } from './workers.js';
import { createRenderer, MESH_VERTEX_STRIDE, withTimeout } from '../lib/structure/renderer.js';
import { createCanvasRenderer } from '../lib/structure/renderer-canvas.js';
import { buildCartoon } from '../lib/structure/cartoon.js';
import { buildScene, focusNeighborhood } from '../lib/structure/scene.js';
import { BACKGROUNDS, computeAtomColors } from '../lib/structure/coloring.js';
import { cameraBasis, cameraMatrices, cloneCamera, createCamera, fitCameraToPoints, interpolateCamera, orbitCamera, panCamera, projectToScreen, rollCamera, zoomCamera } from '../lib/structure/camera.js';
import { add, normalize, scale } from '../lib/structure/math3d.js';
import { elementInfo } from '../lib/structure/elements.js';
import { deriveStructure, materializeAssemblyModels } from '../lib/structure/structure.js';
import { ASYMMETRIC_UNIT_ID, residueLabel } from '../lib/structures.js';

// Proteoscope's "standard" lighting.
const LIGHTING = { ambient: 0.42, diffuse: 0.62, specular: 0.22, shininess: 36, ao: 0.75, aoRadius: 5, outline: 0, fog: 0.45, glow: 0, flat: false };

// The styles offered, as Proteoscope's presets: the polymer's, the ligands', and a surface.
export const STYLES = {
  cartoon: { label: 'Cartoon', polymer: 'cartoon', ligand: 'ball-stick' },
  'ball-stick': { label: 'Ball and stick', polymer: 'ball-stick', ligand: 'ball-stick' },
  sticks: { label: 'Sticks', polymer: 'sticks', ligand: 'sticks' },
  spacefill: { label: 'Spacefill', polymer: 'spacefill', ligand: 'spacefill' },
  trace: { label: 'Trace', polymer: 'trace', ligand: 'ball-stick' },
};

export const SURFACES = {
  off: { label: 'No surface', words: 'no surface' },
  ses: { label: 'Molecular surface (SES)', words: 'molecular surface (SES)' },
  sas: { label: 'Solvent-accessible (SAS)', words: 'solvent-accessible surface (SAS)' },
  vdw: { label: 'Van der Waals surface', words: 'van der Waals surface' },
  gaussian: { label: 'Gaussian surface', words: 'Gaussian surface' },
};

const DISPLAY = {
  polymer: 'cartoon',
  ligand: 'ball-stick',
  sidechains: 'focus',
  showWater: false,
  showHydrogen: false,
  bondOrders: 'ligands',
  atomScale: 1,
  bondScale: 1,
  cartoonWidth: 1,
  cartoonQuality: 6,
  visibleChains: null,
  residueFilter: null,
  residueFilterKey: '',
  residueStyles: null,
  hiddenResidues: null,
  overrideKey: '',
};

let surfaceWorker = null;

// options: { onPick(residue | null, { additive }), onFocus(residues), onChange() }.
export function createStructureViewer(options = {}) {
  const canvas = h('canvas.structure-canvas', { tabindex: '0', 'aria-label': 'The structure, drawn in 3D' });
  const labelLayer = h('div.structure-labels', { 'aria-hidden': 'true' });
  const tooltip = h('div.structure-tooltip', { role: 'status' });
  const el = h('div.structure-viewport', canvas, labelLayer, tooltip);
  const state = {
    renderer: null,
    kind: '',
    failure: '',
    structure: null,
    style: 'cartoon',
    display: { ...DISPLAY },
    color: { scheme: 'chain', palette: 'vivid', heteroByElement: true },
    surface: { kind: 'off', opacity: 1, key: '', pending: 0, data: null, status: '', computing: false },
    selection: new Set(),
    focus: null,
    labels: new Set(),
    hover: { atom: -1, residueKey: null },
    camera: createCamera(),
    cameraAnimation: null,
    dirty: { scene: false, colors: false, flags: false, render: false },
    meshes: new Set(),
    atomColors: null,
    atomFlags: null,
    legend: null,
    bounds: null,
    background: 'white',
    attached: false,
    frame: 0,
    drag: null,
    pointers: new Map(),
    pickPending: false,
    // Fit once the canvas has its size (a structure opened while the view is hidden), and again
    // when it changes size, until the camera is moved by hand.
    pendingFit: false,
    fitted: false,
  };
  const ready = initRenderer();

  async function initRenderer() {
    const forced = new URLSearchParams(location.search).get('renderer') === 'canvas';
    try {
      // Why not WebGPU, as a clause: "Surfaces need WebGPU: <failure>."
      if (forced) throw new Error('the Canvas renderer was asked for (?renderer=canvas)');
      if (!navigator.gpu) throw new Error('this browser does not offer WebGPU');
      state.renderer = await withTimeout(createRenderer(canvas, { onDeviceLost: (info) => fail(`the graphics device was lost (${info?.message || 'unknown reason'}): reload the page`) }), 5000, 'WebGPU did not start within 5 seconds');
      state.kind = 'webgpu';
    } catch (error) {
      state.renderer = createCanvasRenderer(canvas);
      state.kind = 'canvas';
      state.failure = error.message;
    }
    return state.kind;
  }

  function fail(message) {
    state.failure = message;
    options.onChange?.();
  }

  // --- The model ---------------------------------------------------------------------------------

  const model = () => state.structure?.models[0] ?? null;

  function markScene() {
    state.dirty.scene = true;
    state.dirty.colors = true;
    state.dirty.flags = true;
    state.dirty.render = true;
  }

  function cartoonFor(m) {
    const d = state.display;
    const key = [m.number, d.overrideKey || '*', d.cartoonWidth.toFixed(2), d.cartoonQuality].join('|');
    const cached = m.cartoonCache.get(key);
    if (cached) return cached;
    const cartoon = buildCartoon(m, { include: (r) => !d.hiddenResidues?.has(r.key), widthScale: d.cartoonWidth, quality: d.cartoonQuality });
    if (m.cartoonCache.size > 6) m.cartoonCache.clear();
    m.cartoonCache.set(key, cartoon);
    return cartoon;
  }

  function rebuildScene() {
    const m = model();
    if (!m) return;
    const cartoon = state.display.polymer === 'cartoon' ? cartoonFor(m) : null;
    const scene = buildScene(m, state.structure, state.display, { cartoon, focusResidues: state.focus?.neighborhood ?? new Set() });
    state.renderer.setSpheres(scene.spheres.data, scene.spheres.count);
    state.renderer.setCylinders(scene.cylinders.data, scene.cylinders.count);
    if (cartoon) {
      state.renderer.setMesh('cartoon', { vertices: cartoon.vertices, indices: cartoon.indices, opacity: 1, atomOffset: 0 });
      state.meshes.add('cartoon');
    } else if (state.meshes.has('cartoon')) {
      state.renderer.setMesh('cartoon', null);
      state.meshes.delete('cartoon');
    }
    state.renderer.setCanvasShapes?.(cartoon?.canvasShapes ?? []);
    state.bounds = m.bounds;
    state.dirty.scene = false;
  }

  function updateColors() {
    const m = model();
    if (!m) return;
    const { colors, legend } = computeAtomColors(m, state.structure, state.color);
    state.atomColors = colors;
    state.legend = legend;
    if (!state.atomFlags || state.atomFlags.length !== m.atoms.length) state.atomFlags = new Uint32Array(Math.max(1, m.atoms.length));
    state.renderer.setAtomData(colors, state.atomFlags);
    state.dirty.colors = false;
    state.dirty.flags = true;
    applySurfaceColors();
  }

  function updateFlags() {
    const m = model();
    if (!m || !state.atomFlags) return;
    const flags = state.atomFlags;
    flags.fill(0);
    const mark = (keys, bit) => {
      for (const key of keys) {
        const residue = m.residueMap.get(key);
        if (residue) for (const atom of residue.atoms) flags[atom.id] |= bit;
      }
    };
    mark(state.selection, 1);
    if (state.hover.residueKey) mark([state.hover.residueKey], 2);
    state.renderer.updateAtomFlags(flags);
    state.dirty.flags = false;
  }

  // --- Drawing -----------------------------------------------------------------------------------

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function currentView() {
    resizeCanvas();
    const matrices = cameraMatrices(state.camera, canvas.width / Math.max(1, canvas.height));
    return { ...matrices, orthographic: state.camera.orthographic };
  }

  function renderSettings() {
    const radius = Math.max(4, state.bounds?.radius ?? 10);
    const basis = cameraBasis(state.camera);
    const depth = state.camera.distance;
    const background = BACKGROUNDS[state.background] ?? BACKGROUNDS.white;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    return {
      clip: { near: depth - radius, far: depth + radius, nearEnabled: false, farEnabled: false },
      lightDirection: normalize(add(add(scale(basis.right, -0.42), scale(basis.up, 0.56)), scale(basis.forward, -0.72))),
      material: { ambient: LIGHTING.ambient, diffuse: LIGHTING.diffuse, specular: LIGHTING.specular, shininess: LIGHTING.shininess },
      flat: LIGHTING.flat,
      highlightColor: [0.35, 1, 0.55],
      highlightStrength: 0.5,
      hoverColor: [1, 0.85, 0.3],
      hoverStrength: 0.38,
      glow: LIGHTING.glow,
      dashPeriod: 0.42,
      fog: { start: depth - radius * 0.3, end: depth + radius * 1.1, strength: LIGHTING.fog * (state.background === 'white' ? 0.5 : 0.85) },
      background: { top: background.top, bottom: background.bottom, alpha: 1 },
      ao: { enabled: true, strength: LIGHTING.ao, radius: LIGHTING.aoRadius, bias: 0.04 + LIGHTING.aoRadius * 0.01 },
      outline: { enabled: false, strength: 0, width: ratio, threshold: 0.8 },
      fxaa: true,
      pixelRatio: ratio,
    };
  }

  function frame(time) {
    if (!state.attached) return;
    state.frame = requestAnimationFrame(frame);
    if (!state.structure || !state.renderer) return;
    if (state.pendingFit && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
      state.pendingFit = false;
      fit(null, { animate: false });
    }
    let animating = false;
    if (state.cameraAnimation) {
      const a = state.cameraAnimation;
      const t = Math.min(1, (time - a.start) / a.duration);
      Object.assign(state.camera, interpolateCamera(a.from, a.to, t));
      if (t >= 1) state.cameraAnimation = null;
      animating = true;
    }
    if (state.dirty.scene) rebuildScene();
    if (state.dirty.colors) updateColors();
    if (state.dirty.flags) updateFlags();
    if (state.dirty.render || animating) {
      state.dirty.render = false;
      state.renderer.render(currentView(), { ...renderSettings(), time: time * 0.001 });
      updateLabels();
    }
  }

  const requestRender = () => {
    state.dirty.render = true;
  };

  // The camera fitted to atoms (all drawn atoms by default), turned to their principal axes unless
  // keepRotation.
  function fit(atoms = null, { animate = true, keepRotation = false } = {}) {
    const m = model();
    if (!m) return;
    const source = atoms ?? m.atoms.filter((a) => a.kind !== 'water' && !state.display.hiddenResidues?.has(a.residueKey));
    if (!source.length) return;
    if (!atoms && !(canvas.clientWidth > 0 && canvas.clientHeight > 0)) {
      state.pendingFit = true;
      return;
    }
    const points = new Float32Array(source.length * 3);
    source.forEach((atom, i) => {
      points[i * 3] = atom.x;
      points[i * 3 + 1] = atom.y;
      points[i * 3 + 2] = atom.z;
    });
    const target = cloneCamera(state.camera);
    target.sceneRadius = m.bounds.radius;
    state.fitted = !atoms;
    fitCameraToPoints(target, points, { width: canvas.clientWidth || 800, height: canvas.clientHeight || 600 }, { keepRotation, padding: atoms ? 4 : 2, sceneRadius: m.bounds.radius });
    if (animate && state.attached) {
      state.cameraAnimation = { from: cloneCamera(state.camera), to: target, start: performance.now(), duration: 450 };
    } else {
      Object.assign(state.camera, target);
      state.cameraAnimation = null;
    }
    requestRender();
  }

  // --- Labels and the tooltip --------------------------------------------------------------------

  function updateLabels() {
    const m = model();
    const pool = labelLayer.children;
    let used = 0;
    if (m && state.labels.size) {
      const view = currentView();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      for (const key of [...state.labels].slice(0, 400)) {
        const residue = m.residueMap.get(key);
        const atom = residue?.representative;
        if (!atom) continue;
        const screen = projectToScreen(view, [atom.x, atom.y, atom.z], width, height);
        if (!screen || screen.x < 0 || screen.y < 0 || screen.x > width || screen.y > height) continue;
        const label = pool[used] ?? labelLayer.appendChild(h('div.structure-label'));
        const text = residueLabel(residue);
        if (label.textContent !== text) label.textContent = text;
        label.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -140%)`;
        used += 1;
      }
    }
    while (pool.length > used) pool[pool.length - 1].remove();
  }

  function residueOf(atomIndex) {
    const m = model();
    if (!m || !Number.isInteger(atomIndex) || atomIndex < 0 || atomIndex >= m.atoms.length) return null;
    return m.residues[m.atomResidue[atomIndex]] ?? null;
  }

  function describeHover(atomIndex) {
    const m = model();
    const atom = m.atoms[atomIndex];
    const residue = residueOf(atomIndex);
    const parts = [`${atom.name} · ${atom.element}`];
    if (residue?.kind === 'protein') parts.push({ helix: 'helix', sheet: 'strand', turn: 'turn' }[residue.ss] ?? 'coil');
    if (state.structure.meta.isPredicted && Number.isFinite(residue?.confidence)) parts.push(`pLDDT ${residue.confidence.toFixed(1)}`);
    else if (Number.isFinite(atom.bFactor)) parts.push(`B ${atom.bFactor.toFixed(1)}`);
    return [residueLabel(residue), parts.join(' · ')];
  }

  function setHover(atomIndex, clientX, clientY) {
    const residue = residueOf(atomIndex);
    if (residue) {
      const [title, detail] = describeHover(atomIndex);
      tooltip.replaceChildren(h('strong', title), h('span', detail));
      const box = el.getBoundingClientRect();
      const x = Math.min(box.width - 220, clientX - box.left + 14);
      tooltip.style.transform = `translate(${Math.max(0, x)}px, ${clientY - box.top + 14}px)`;
      tooltip.classList.add('visible');
    } else {
      tooltip.classList.remove('visible');
    }
    const key = residue?.key ?? null;
    if (state.hover.residueKey !== key) {
      state.hover = { atom: atomIndex, residueKey: key };
      state.dirty.flags = true;
      requestRender();
    }
  }

  // --- Pointer -----------------------------------------------------------------------------------

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / Math.max(1, rect.width)), y: (event.clientY - rect.top) * (canvas.height / Math.max(1, rect.height)) };
  }

  async function pickAt(event) {
    if (!state.renderer) return -1;
    const point = canvasPoint(event);
    try {
      return await state.renderer.pick(point.x, point.y);
    } catch {
      return -1;
    }
  }

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    state.cameraAnimation = null;
    if (state.pointers.size === 2) {
      const [a, b] = [...state.pointers.values()];
      state.drag = { mode: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), moved: true };
      return;
    }
    const mode = event.button === 2 || event.button === 1 || event.shiftKey ? 'pan' : event.altKey ? 'roll' : 'rotate';
    state.drag = { mode, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (state.pointers.has(event.pointerId)) state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const drag = state.drag;
    if (drag) {
      if (drag.mode === 'pinch' && state.pointers.size >= 2) {
        const [a, b] = [...state.pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        zoomCamera(state.camera, drag.distance / Math.max(1, distance));
        drag.distance = distance;
        state.fitted = false;
        requestRender();
        return;
      }
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 4) drag.moved = true;
      if (!drag.moved) return;
      state.fitted = false;
      if (drag.mode === 'pan') panCamera(state.camera, dx, dy, canvas.clientHeight);
      else if (drag.mode === 'roll') rollCamera(state.camera, dx * 0.006);
      else orbitCamera(state.camera, dx, dy);
      tooltip.classList.remove('visible');
      requestRender();
      return;
    }
    if (state.pickPending || !state.structure) return;
    state.pickPending = true;
    const { clientX, clientY } = event;
    requestAnimationFrame(async () => {
      const index = await pickAt({ clientX, clientY });
      state.pickPending = false;
      setHover(index, clientX, clientY);
    });
  });
  const release = async (event) => {
    state.pointers.delete(event.pointerId);
    const drag = state.drag;
    if (state.pointers.size === 0) state.drag = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    if (drag && !drag.moved && drag.mode !== 'pinch' && event.type === 'pointerup' && event.button !== 2) {
      const residue = residueOf(await pickAt(event));
      options.onPick?.(residue, { additive: event.shiftKey || event.metaKey || event.ctrlKey });
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    if (!state.drag) setHover(-1, 0, 0);
  });
  canvas.addEventListener('dblclick', async (event) => {
    const residue = residueOf(await pickAt(event));
    if (residue) {
      api.focus([residue.key]);
      options.onFocus?.([residue]);
    }
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomCamera(state.camera, Math.exp(delta * 0.0012));
    state.cameraAnimation = null;
    state.fitted = false;
    requestRender();
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 30 : 10;
    const turns = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (turns[event.key]) orbitCamera(state.camera, ...turns[event.key]);
    else if (event.key === '+' || event.key === '=') zoomCamera(state.camera, 1 / 1.2);
    else if (event.key === '-') zoomCamera(state.camera, 1.2);
    else if (event.key === 'f' || event.key === 'F') fit();
    else return;
    if (event.key !== 'f' && event.key !== 'F') state.fitted = false;
    event.preventDefault();
    requestRender();
  });
  const resize = new ResizeObserver(() => {
    if (state.fitted && state.structure && !state.focus) fit(null, { animate: false });
    requestRender();
  });
  resize.observe(canvas);

  // --- Surfaces ----------------------------------------------------------------------------------

  async function refreshSurface() {
    const surface = state.surface;
    const m = model();
    if (surface.kind === 'off' || !m) {
      surface.data = null;
      surface.key = '';
      surface.status = '';
      if (state.meshes.has('surface')) {
        state.renderer?.setMesh('surface', null);
        state.meshes.delete('surface');
      }
      requestRender();
      options.onChange?.();
      return;
    }
    if (state.kind !== 'webgpu') {
      surface.status = `Surfaces need WebGPU: ${state.failure}.`;
      options.onChange?.();
      return;
    }
    const atoms = m.atoms.filter((a) => a.kind !== 'water' && !a.isHydrogen && !state.display.hiddenResidues?.has(a.residueKey));
    const key = [state.structure.activeAssemblyId, m.number, surface.kind, state.display.overrideKey || '*', atoms.length].join('|');
    if (key === surface.key && surface.data) return;
    surface.key = key;
    const ticket = (surface.pending += 1);
    const positions = new Float32Array(atoms.length * 3);
    const radii = new Float32Array(atoms.length);
    atoms.forEach((atom, i) => {
      positions[i * 3] = atom.x;
      positions[i * 3 + 1] = atom.y;
      positions[i * 3 + 2] = atom.z;
      radii[i] = elementInfo(atom.element).vdw;
    });
    surface.status = `Computing the ${SURFACES[surface.kind].words} of ${atoms.length.toLocaleString('en-US')} atoms…`;
    surface.computing = true;
    options.onChange?.();
    const started = performance.now();
    try {
      surfaceWorker ??= new WorkerClient('../workers/surface-worker.js', { max: 1 });
      const result = await surfaceWorker.call('surface', { positions, radii, options: { kind: surface.kind } }, { transfer: [positions.buffer, radii.buffer] });
      if (ticket !== surface.pending || model() !== m) return;
      surface.computing = false;
      const ids = new Uint32Array(result.atoms.length);
      for (let i = 0; i < result.atoms.length; i += 1) ids[i] = atoms[result.atoms[i]]?.id ?? 0;
      surface.data = { positions: result.positions, normals: result.normals, indices: result.indices, atoms: ids };
      surface.status = `${(result.indices.length / 3).toLocaleString('en-US')} triangles in ${((performance.now() - started) / 1000).toFixed(1)} s${result.spacing ? `, a grid of ${result.spacing.toFixed(2)} Å` : ''}.`;
      applySurfaceColors();
    } catch (error) {
      if (ticket === surface.pending) {
        surface.computing = false;
        surface.status = `The surface could not be computed: ${error.message}`;
      }
    }
    options.onChange?.();
  }

  // The surface takes each atom's color (the vertex color 0 asks the renderer for its atom's).
  function applySurfaceColors() {
    const data = state.surface.data;
    if (!data || !state.renderer) return;
    const count = data.positions.length / 3;
    const buffer = new ArrayBuffer(count * MESH_VERTEX_STRIDE);
    const floats = new Float32Array(buffer);
    const uints = new Uint32Array(buffer);
    for (let i = 0; i < count; i += 1) {
      const o = i * 8;
      floats[o] = data.positions[i * 3];
      floats[o + 1] = data.positions[i * 3 + 1];
      floats[o + 2] = data.positions[i * 3 + 2];
      floats[o + 3] = data.normals[i * 3];
      floats[o + 4] = data.normals[i * 3 + 1];
      floats[o + 5] = data.normals[i * 3 + 2];
      uints[o + 6] = data.atoms[i];
      uints[o + 7] = 0;
    }
    state.renderer.setMesh('surface', { vertices: buffer, indices: data.indices, opacity: state.surface.opacity, atomOffset: 0 });
    state.meshes.add('surface');
    requestRender();
  }

  // --- What the view asks ------------------------------------------------------------------------

  const api = {
    el,
    ready,
    get kind() {
      return state.kind;
    },
    get failure() {
      return state.failure;
    },
    get structure() {
      return state.structure;
    },
    get model() {
      return model();
    },
    get style() {
      return state.style;
    },
    get colorScheme() {
      return state.color.scheme;
    },
    get surface() {
      return { kind: state.surface.kind, status: state.surface.status, ready: Boolean(state.surface.data) && !state.surface.computing };
    },
    get selection() {
      return new Set(state.selection);
    },
    get focused() {
      return state.focus ? [...state.focus.residues] : [];
    },
    get labels() {
      return new Set(state.labels);
    },
    get legend() {
      return state.legend;
    },
    get styled() {
      return new Map(state.display.residueStyles ?? []);
    },
    // Drawing runs while the viewer is in the page.
    attach() {
      if (state.attached) return;
      state.attached = true;
      state.dirty.render = true;
      state.frame = requestAnimationFrame(frame);
    },
    detach() {
      state.attached = false;
      cancelAnimationFrame(state.frame);
    },
    // A structure (openStructureText's) replaces the one shown: the style kept, the selection,
    // labels and focus cleared. A predicted model starts colored by confidence.
    async show(structure) {
      await ready;
      state.structure = structure;
      state.selection = new Set();
      state.labels = new Set();
      state.focus = null;
      state.display = { ...state.display, residueStyles: null, hiddenResidues: null, overrideKey: '' };
      if (structure.meta.isPredicted && state.color.scheme === 'chain') state.color.scheme = 'plddt';
      else if (!structure.meta.isPredicted && state.color.scheme === 'plddt') state.color.scheme = 'chain';
      state.surface.key = '';
      state.surface.data = null;
      markScene();
      fit(null, { animate: false });
      refreshSurface();
      options.onChange?.();
    },
    clear() {
      state.structure = null;
      for (const id of state.meshes) state.renderer?.setMesh(id, null);
      state.meshes.clear();
      state.renderer?.setSpheres(new ArrayBuffer(0), 0);
      state.renderer?.setCylinders(new ArrayBuffer(0), 0);
      options.onChange?.();
    },
    // An assembly by id (ASYMMETRIC_UNIT_ID for the deposited coordinates).
    setAssembly(id) {
      const structure = state.structure;
      if (!structure || structure.activeAssemblyId === id) return;
      const previous = { id: structure.activeAssemblyId, models: structure.models };
      try {
        structure.activeAssemblyId = id;
        structure.models = materializeAssemblyModels(structure, id);
        deriveStructure(structure, { secondaryMode: 'auto' });
      } catch (error) {
        structure.activeAssemblyId = previous.id;
        structure.models = previous.models;
        throw error;
      }
      state.selection = new Set();
      state.labels = new Set();
      state.focus = null;
      state.display = { ...state.display, residueStyles: null, overrideKey: '' };
      state.surface.key = '';
      state.surface.data = null;
      markScene();
      fit(null, { animate: false });
      refreshSurface();
      options.onChange?.();
    },
    setStyle(name) {
      const style = STYLES[name];
      if (!style) throw new Error(`No style "${name}". Styles: ${Object.keys(STYLES).join(', ')}.`);
      state.style = name;
      state.display.polymer = style.polymer;
      state.display.ligand = style.ligand;
      markScene();
      options.onChange?.();
    },
    setColor(scheme) {
      state.color = { ...state.color, scheme };
      state.dirty.colors = true;
      requestRender();
      options.onChange?.();
    },
    setSurface(kind) {
      if (!SURFACES[kind]) throw new Error(`No surface "${kind}". Surfaces: ${Object.keys(SURFACES).join(', ')}.`);
      state.surface.kind = kind;
      refreshSurface();
    },
    setTheme(dark) {
      state.background = dark ? 'dark' : 'white';
      requestRender();
    },
    // The residues selected (keys), drawn highlighted.
    select(keys, { additive = false } = {}) {
      const m = model();
      if (!m) return;
      const next = additive ? new Set(state.selection) : new Set();
      for (const key of keys) {
        if (!m.residueMap.has(key)) continue;
        if (additive && keys.length === 1 && next.has(key)) next.delete(key);
        else next.add(key);
      }
      state.selection = next;
      state.dirty.flags = true;
      requestRender();
      options.onChange?.();
    },
    // Residues drawn in a style of their own over the rest ('sticks', 'ball-stick', 'spacefill'),
    // or hidden ('hide'), or back to the rest's ('none').
    styleResidues(keys, how) {
      const styles = new Map(state.display.residueStyles ?? []);
      const hidden = new Set(state.display.hiddenResidues ?? []);
      for (const key of keys) {
        styles.delete(key);
        hidden.delete(key);
        if (how === 'hide') hidden.add(key);
        else if (how !== 'none') styles.set(key, how);
      }
      state.display.residueStyles = styles.size ? styles : null;
      state.display.hiddenResidues = hidden.size ? hidden : null;
      state.display.overrideKey = `${[...styles].map(([k, v]) => `${k}=${v}`).join(',')}|${[...hidden].join(',')}`;
      state.surface.key = '';
      if (hidden.size || state.surface.data) state.surface.data = null;
      markScene();
      if (state.surface.kind !== 'off') refreshSurface();
      options.onChange?.();
    },
    label(keys, on = true) {
      for (const key of keys) {
        if (on) state.labels.add(key);
        else state.labels.delete(key);
      }
      requestRender();
      options.onChange?.();
    },
    // The neighborhood of residues (within 5 Å): their side chains drawn, the camera on them.
    focus(keys) {
      const m = model();
      const valid = keys.filter((key) => m?.residueMap.has(key));
      if (!valid.length) return [];
      state.selection = new Set(valid);
      const neighborhood = focusNeighborhood(m, valid, 5);
      state.focus = { residues: new Set(valid), neighborhood };
      fit([...neighborhood].flatMap((key) => m.residueMap.get(key)?.atoms ?? []).filter((a) => !a.isHydrogen), { keepRotation: true });
      markScene();
      options.onChange?.();
      return [...neighborhood];
    },
    clearFocus() {
      state.focus = null;
      markScene();
      options.onChange?.();
    },
    fit,
    // Atoms drawn and residues shown, for the view's words and the checks.
    counts() {
      const m = model();
      return m ? { atoms: m.atoms.length, residues: m.residues.length, renderer: state.kind } : null;
    },
    // An image of what is shown (a PNG blob), `factor` times the canvas's size.
    async capturePNG(factor = 1) {
      const view = currentView();
      const width = Math.round(canvas.width * factor);
      const height = Math.round(canvas.height * factor);
      const image = state.kind === 'webgpu' ? await state.renderer.capture(view, renderSettings(), width, height, 2) : await state.renderer.capture(view, renderSettings(), width, height);
      const out = h('canvas', { width: image.width, height: image.height });
      out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength), image.width, image.height), 0, 0);
      return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    },
    destroy() {
      api.detach();
      resize.disconnect();
    },
  };
  return api;
}

export { ASYMMETRIC_UNIT_ID };
