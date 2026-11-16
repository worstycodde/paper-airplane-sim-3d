# PaperFlight — 3D Paper Airplane Flight Lab

Mobile-friendly Three.js flight simulator UI with a pre-folded dart, adjustable launch and atmosphere controls, a lightweight educational aerodynamic model, local design/flight storage, and STL/OBJ import.

## Run locally

```bash
npm install
npm run dev
```

## Deploy with Emergent

Import `worstyccodde/paper-airplane-sim-3d` from GitHub in Emergent and ask it to deploy this Vite + React app. Build command: `npm run build`. Output directory: `dist`. No backend or environment variables are required; saved designs and flight results use the browser's local storage.

## Notes

The aerodynamic model is an educational approximation, not computational fluid dynamics (CFD). The current model import supports viewing the mesh in the 3D scene; aerodynamic parameters continue to use the paper-plane baseline until extended for imported geometry. Camera orbit and pinch zoom work on touch screens.
