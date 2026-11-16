import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { aerodynamicForces, defaultPlane, stepFlight } from './simulation/aerodynamics.js';

const initialControls = { windSpeed: 1.5, windDirection: 0, density: 1.225, launchSpeed: 9, launchAngle: 18, angleOfAttack: 8 };
const initialFlight = { distance: 0, time: 0, speed: 0, lift: 0, drag: 0, ldr: 0 };
const loadJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

function makeDart() {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.15); shape.lineTo(0.72, -0.75); shape.lineTo(0.13, -0.43);
  shape.lineTo(0, -0.72); shape.lineTo(-0.13, -0.43); shape.lineTo(-0.72, -0.75); shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 1);
  geometry.rotateX(-Math.PI / 2);
  const paper = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#edf4ff', roughness: 0.76, side: THREE.DoubleSide }));
  paper.scale.set(0.22, 0.22, 0.22);
  paper.position.y = 0.025;
  group.add(paper);
  const creasePoints = [new THREE.Vector3(0, 0.03, -0.25), new THREE.Vector3(0, 0.03, 0.25)];
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(creasePoints), new THREE.LineBasicMaterial({ color: '#56c8f2' })));
  return group;
}

function normalizeObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z) || 1;
  object.scale.multiplyScalar(0.9 / largest);
  const centered = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
  object.position.sub(centered);
  return object;
}

function FlightScene({ theme, controls, plane, running, resetToken, modelUrl, onTelemetry, onLanded }) {
  const mountRef = useRef(null);
  const dataRef = useRef({ controls, plane, running, modelUrl, onTelemetry, onLanded });
  useEffect(() => { dataRef.current = { controls, plane, running, modelUrl, onTelemetry, onLanded }; }, [controls, plane, running, modelUrl, onTelemetry, onLanded]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme === 'dark' ? '#09111b' : '#eaf2fa');
    scene.fog = new THREE.Fog(scene.background, 24, 110);
    const camera = new THREE.PerspectiveCamera(52, mount.clientWidth / mount.clientHeight, 0.1, 400);
    camera.position.set(4, 3, 7);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true; orbit.target.set(0, 1, 0); orbit.maxPolarAngle = Math.PI * 0.49;
    scene.add(new THREE.HemisphereLight(0xd8edff, 0x24303a, 2.1));
    const light = new THREE.DirectionalLight(0xffffff, 2.3); light.position.set(-5, 9, 5); scene.add(light);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: theme === 'dark' ? '#101d29' : '#d8e5ee', roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; scene.add(ground);
    const grid = new THREE.GridHelper(120, 60, theme === 'dark' ? '#327a96' : '#73a2b7', theme === 'dark' ? '#203643' : '#b8cbd3'); grid.position.y = 0; scene.add(grid);
    const ambientGroup = new THREE.Group(); scene.add(ambientGroup);
    let model = makeDart(); ambientGroup.add(model);
    const state = { position: new THREE.Vector3(0, 1.2, 0), velocity: new THREE.Vector3(), elapsed: 0, distance: 0, launched: false };
    let frame = 0; let last = performance.now(); let telemetryAt = 0; let disposed = false;
    let importedObject = null;

    const loadModel = async (url) => {
      if (!url) return;
      try {
        const response = await fetch(url); const blob = await response.blob();
        let object;
        if (blob.name?.toLowerCase().endsWith('.obj') || url.toLowerCase().includes('.obj')) {
          object = new OBJLoader().parse(await blob.text());
        } else {
          const geometry = new STLLoader().parse(await blob.arrayBuffer());
          geometry.computeVertexNormals();
          object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#dceaff', roughness: 0.55, metalness: 0.12, side: THREE.DoubleSide }));
        }
        if (disposed) return;
        if (importedObject) ambientGroup.remove(importedObject);
        importedObject = normalizeObject(object); importedObject.traverse((child) => { if (child.isMesh && !child.material) child.material = new THREE.MeshStandardMaterial({ color: '#dceaff', side: THREE.DoubleSide }); });
        ambientGroup.remove(model); model = importedObject; ambientGroup.add(model);
      } catch (error) { console.error('Model import failed', error); }
    };
    if (dataRef.current.modelUrl) loadModel(dataRef.current.modelUrl);

    const animate = (now) => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const dt = Math.min((now - last) / 1000, 0.035); last = now;
      const current = dataRef.current;
      if (current.running && state.launched) {
        const obj = { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z };
        const aero = stepFlight({ position: { x: state.position.x, y: state.position.y, z: state.position.z }, velocity: obj }, current.controls, current.plane, dt);
        state.velocity.set(obj.x, obj.y, obj.z);
        const previous = state.position.clone();
        state.position.set(state.position.x + obj.x * dt, state.position.y + obj.y * dt, state.position.z + obj.z * dt);
        state.distance += state.position.distanceTo(previous); state.elapsed += dt;
        model.position.copy(state.position);
        model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, -Math.atan2(state.velocity.y, Math.max(0.1, Math.hypot(state.velocity.x, state.velocity.z))), 0.08);
        model.rotation.y = Math.atan2(state.velocity.x, -state.velocity.z);
        const speed = state.velocity.length();
        if (now - telemetryAt > 100) { telemetryAt = now; current.onTelemetry({ distance: state.distance, time: state.elapsed, speed, lift: aero.lift, drag: aero.drag, ldr: aero.ldr }); }
        if (state.position.y < 0.04 || state.elapsed > 45 || state.position.length() > 200) {
          state.position.y = Math.max(0, state.position.y); state.launched = false; current.onLanded();
        }
        // Follow camera smoothly while preserving orbit controls.
        orbit.target.lerp(state.position, 0.035);
      }
      orbit.update(); renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);
    const resize = () => { const w = mount.clientWidth, h = mount.clientHeight; if (!w || !h) return; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    const observer = new ResizeObserver(resize); observer.observe(mount);
    const launch = () => {
      const c = dataRef.current.controls; state.position.set(0, 1.2, 0); state.elapsed = 0; state.distance = 0;
      const angle = c.launchAngle * Math.PI / 180; state.velocity.set(0, Math.sin(angle) * c.launchSpeed, -Math.cos(angle) * c.launchSpeed);
      state.launched = true; model.position.copy(state.position); orbit.target.copy(state.position);
    };
    const reset = () => { state.position.set(0, 1.2, 0); state.velocity.set(0, 0, 0); state.elapsed = 0; state.distance = 0; state.launched = false; model.position.copy(state.position); };
    mount.__launch = launch; mount.__reset = reset;
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); orbit.dispose(); renderer.dispose(); if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement); scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }); };
  }, [theme, resetToken]);

  useEffect(() => { if (!modelUrl || !mountRef.current) return; const mount = mountRef.current; const load = async () => { try { const response = await fetch(modelUrl); const blob = await response.blob(); let object; if (modelUrl.toLowerCase().includes('.obj')) object = new OBJLoader().parse(await blob.text()); else { const geometry = new STLLoader().parse(await blob.arrayBuffer()); object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#dceaff', side: THREE.DoubleSide })); } const current = mount.__setModel; if (current) current(normalizeObject(object)); } catch (e) { console.error(e); } }; load(); }, [modelUrl]);

  // Keep scene commands on the mount; the active model can be replaced without rebuilding the renderer.
  useEffect(() => { const mount = mountRef.current; if (!mount) return; mount.__setModel = (next) => { mount.__replaceModel?.(next); }; }, []);
  useEffect(() => { const mount = mountRef.current; if (!mount) return; const launch0 = mount.__launch; const reset0 = mount.__reset; if (resetToken > 0) reset0?.(); mount.dataset.ready = String(Boolean(launch0)); }, [resetToken]);
  return <div className="scene-wrap"><div className="scene" ref={mountRef} /><div className="scene-help">DRAG TO ORBIT <span>·</span> PINCH TO ZOOM</div></div>;
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('pf-theme') || 'dark');
  const [lang, setLang] = useState(() => localStorage.getItem('pf-lang') || 'tr');
  const [controls, setControls] = useState(initialControls);
  const [plane, setPlane] = useState(defaultPlane);
  const [running, setRunning] = useState(false);
  const [flight, setFlight] = useState(initialFlight);
  const [resetToken, setResetToken] = useState(0);
  const [modelUrl, setModelUrl] = useState('');
  const [saved, setSaved] = useState(() => loadJSON('paperflight-designs', []));
  const [records, setRecords] = useState(() => loadJSON('paperflight-records', []));
  const [toast, setToast] = useState('');
  const pickerRef = useRef(null); const mountRef = useRef(null);
  const words = useMemo(() => lang === 'tr' ? {
    title: 'PaperFlight', subtitle: 'KAĞIT UÇAK · UÇUŞ LABORATUVARI', launch: 'UÇAĞI FIRLAT', reset: 'SIFIRLA', pause: 'DURAKLAT', resume: 'DEVAM ET', setup: 'UÇUŞ AYARLARI', atmosphere: 'Atmosfer', wind: 'Rüzgâr hızı', direction: 'Rüzgâr yönü', density: 'Hava yoğunluğu', launchSpeed: 'Fırlatma hızı', launchAngle: 'Fırlatma açısı', aoa: 'Hücum açısı', telemetry: 'CANLI TELEMETRİ', distance: 'MESAFE', time: 'SÜRE', speed: 'HIZ', drag: 'SÜRÜKLEME', lift: 'KALDIRMA', ratio: 'KALDIRMA / SÜRÜKLEME', design: 'UÇAK TASARIMI', default: 'Dart-01 · Ön katlanmış', import: '3D MODEL İÇE AKTAR', save: 'TASARIMI KAYDET', best: 'EN İYİ UÇUŞ', theme: 'Görünüm', light: 'Açık', dark: 'Koyu', language: 'Dil', ready: 'Fırlatmaya hazır', flying: 'Uçuşta', landed: 'Uçuş tamamlandı', saved: 'Tasarım kaydedildi', file: 'STL veya OBJ seç', tip: 'Eğitsel yaklaşık simülasyon · gerçek CFD değildir', flight: 'Uçuşlar', designs: 'Tasarımlar'
  } : {
    title: 'PaperFlight', subtitle: 'PAPER AIRCRAFT · FLIGHT LAB', launch: 'LAUNCH AIRCRAFT', reset: 'RESET', pause: 'PAUSE', resume: 'RESUME', setup: 'FLIGHT SETUP', atmosphere: 'Atmosphere', wind: 'Wind speed', direction: 'Wind direction', density: 'Air density', launchSpeed: 'Launch speed', launchAngle: 'Launch angle', aoa: 'Angle of attack', telemetry: 'LIVE TELEMETRY', distance: 'DISTANCE', time: 'TIME', speed: 'SPEED', drag: 'DRAG', lift: 'LIFT', ratio: 'LIFT / DRAG', design: 'AIRCRAFT DESIGN', default: 'Dart-01 · Pre-folded', import: 'IMPORT 3D MODEL', save: 'SAVE DESIGN', best: 'BEST FLIGHT', theme: 'Appearance', light: 'Light', dark: 'Dark', language: 'Language', ready: 'Ready to launch', flying: 'In flight', landed: 'Flight complete', saved: 'Design saved', file: 'Choose STL or OBJ', tip: 'Educational approximation · not a CFD solver', flight: 'Flights', designs: 'Designs'
  }, [lang]);

  useEffect(() => { localStorage.setItem('pf-theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('pf-lang', lang); }, [lang]);
  useEffect(() => { localStorage.setItem('paperflight-designs', JSON.stringify(saved)); }, [saved]);
  useEffect(() => { localStorage.setItem('paperflight-records', JSON.stringify(records)); }, [records]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 2200); return () => clearTimeout(id); }, [toast]);

  const onTelemetry = useCallback((data) => setFlight(data), []);
  const finish = useCallback(() => { setRunning(false); setRecords((old) => { const next = [{ distance: flight.distance, time: flight.time, date: new Date().toISOString() }, ...old].slice(0, 10); return next; }); }, [flight.distance, flight.time]);
  const change = (key, value) => setControls((old) => ({ ...old, [key]: Number(value) }));
  const launch = () => { if (mountRef.current?.__launch) { setFlight(initialFlight); setRunning(true); mountRef.current.__launch(); } };
  const reset = () => { setRunning(false); setFlight(initialFlight); setResetToken((x) => x + 1); };
  const saveDesign = () => { const next = [{ id: Date.now(), name: plane.name, plane, controls, date: new Date().toISOString() }, ...saved].slice(0, 12); setSaved(next); setToast(words.saved); };
  const importFile = (file) => { if (!file) return; const ext = file.name.split('.').pop().toLowerCase(); if (!['stl', 'obj'].includes(ext)) { setToast('STL / OBJ'); return; } const url = URL.createObjectURL(file); setModelUrl(url); setPlane((p) => ({ ...p, name: file.name.replace(/\.[^.]+$/, '') })); };
  const best = records.reduce((n, r) => Math.max(n, r.distance || 0), 0);

  return <div className={`app ${theme}`}>
    <header className="topbar"><div className="brand"><div className="brand-icon">✈</div><div><div className="brand-title">{words.title}<span>3D</span></div><div className="brand-subtitle">{words.subtitle}</div></div></div><div className="top-actions"><div className="status"><i className={running ? 'live' : ''} />{running ? words.flying : words.ready}</div><button className="icon-button" aria-label={words.theme} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☼' : '◐'}</button><select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={words.language}><option value="tr">TR</option><option value="en">EN</option></select></div></header>
    <main className="layout">
      <section className="visual-column"><div className="scene-card"><div className="scene-label"><div><span className="overline">SIMULATION VIEW</span><h2>{plane.name || 'Dart-01'}</h2></div><span className="view-pill">● 3D VIEW</span></div><div ref={mountRef} className="scene-holder"><FlightScene theme={theme} controls={controls} plane={plane} running={running} resetToken={resetToken} modelUrl={modelUrl} onTelemetry={onTelemetry} onLanded={finish} /></div><div className="scene-footer"><span>↗ {words.tip}</span><span>SI UNITS · {plane.mass.toFixed(3)} kg</span></div></div>
        <section className="telemetry"><div className="section-heading"><div><span className="overline">FLIGHT DATA</span><h3>{words.telemetry}</h3></div><span className="live-tag"><i /> LIVE</span></div><div className="metric-grid"><Metric label={words.distance} value={`${flight.distance.toFixed(1)}`} unit="m" icon="↗" /><Metric label={words.time} value={`${flight.time.toFixed(1)}`} unit="s" icon="◷" /><Metric label={words.speed} value={`${flight.speed.toFixed(1)}`} unit="m/s" icon="⌁" /><Metric label={words.lift} value={`${flight.lift.toFixed(3)}`} unit="N" icon="↑" /><Metric label={words.drag} value={`${flight.drag.toFixed(3)}`} unit="N" icon="⇢" /><Metric label={words.ratio} value={`${flight.ldr.toFixed(2)}`} unit="L/D" icon="⌗" /></div></section>
      </section>
      <aside className="control-column">
        <section className="panel action-panel"><div className="panel-heading"><div><span className="overline">PILOT CONTROLS</span><h3>{words.setup}</h3></div><span className="number-mark">01</span></div><button className="launch-button" onClick={running ? () => setRunning(false) : launch}><span className="launch-symbol">{running ? 'Ⅱ' : '▶'}</span>{running ? words.pause : words.launch}<span className="button-arrow">→</span></button><button className="secondary-button" onClick={() => { if (!running && flight.time > 0) { setRunning(true); } else reset(); }}>{running ? words.resume : words.reset}</button>
          <div className="control-group"><div className="group-title"><span>◉</span>{words.atmosphere}</div><Slider label={words.wind} value={controls.windSpeed} min={0} max={15} step={0.1} unit="m/s" onChange={(v) => change('windSpeed', v)} /><Slider label={words.direction} value={controls.windDirection} min={0} max={360} step={1} unit="°" onChange={(v) => change('windDirection', v)} /><Slider label={words.density} value={controls.density} min={0.7} max={1.5} step={0.01} unit="kg/m³" onChange={(v) => change('density', v)} /></div>
          <div className="control-group"><div className="group-title"><span>↗</span>LAUNCH PARAMETERS</div><Slider label={words.launchSpeed} value={controls.launchSpeed} min={3} max={18} step={0.1} unit="m/s" onChange={(v) => change('launchSpeed', v)} /><Slider label={words.launchAngle} value={controls.launchAngle} min={0} max={50} step={1} unit="°" onChange={(v) => change('launchAngle', v)} /><Slider label={words.aoa} value={controls.angleOfAttack} min={-5} max={18} step={1} unit="°" onChange={(v) => change('angleOfAttack', v)} /></div>
        </section>
        <section className="panel design-panel"><div className="panel-heading"><div><span className="overline">AIRFRAME LAB</span><h3>{words.design}</h3></div><span className="number-mark">02</span></div><div className="aircraft-card"><div className="plane-preview">✈</div><div className="aircraft-info"><strong>{plane.name || 'Dart-01'}</strong><span>{modelUrl ? 'IMPORTED MODEL' : words.default}</span></div><span className="aircraft-check">✓</span></div><div className="spec-row"><span>WING AREA <b>{plane.wingArea.toFixed(3)} m²</b></span><span>ASPECT RATIO <b>{plane.aspectRatio.toFixed(2)}</b></span></div><input ref={pickerRef} className="hidden" type="file" accept=".stl,.obj,model/stl,model/obj" onChange={(e) => importFile(e.target.files?.[0])} /><button className="secondary-button import-button" onClick={() => pickerRef.current?.click()}><span>＋</span>{words.import}<small>STL · OBJ</small></button><button className="save-button" onClick={saveDesign}>♡ &nbsp;{words.save}</button>
          {(saved.length > 0 || records.length > 0) && <div className="saved-summary"><span>{words.designs.toUpperCase()} <b>{saved.length}</b></span><span>{words.flight.toUpperCase()} <b>{records.length}</b></span><span>{words.best.toUpperCase()} <b>{best.toFixed(1)} m</b></span></div>}
        </section>
      </aside>
    </main>
    {toast && <div className="toast">✓ &nbsp;{toast}</div>}
    <footer className="footer"><span>PAPERFLIGHT SIMULATOR <i>·</i> EDUCATIONAL FLIGHT MODEL</span><span>DESIGNED FOR THE CURIOUS <b>✳</b></span></footer>
  </div>;
}

function Slider({ label, value, min, max, step, unit, onChange }) {
  const percentage = ((value - min) / (max - min)) * 100;
  return <label className="slider-control"><span className="slider-label">{label}<b>{Number(value).toFixed(step < 1 ? 1 : 0)} <small>{unit}</small></b></span><input type="range" min={min} max={max} step={step} value={value} style={{ '--range-progress': `${percentage}%` }} onChange={(e) => onChange(e.target.value)} /></label>;
}
function Metric({ label, value, unit, icon }) { return <div className="metric"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><div className="metric-value">{value}<small>{unit}</small></div></div>; }

export default App;
