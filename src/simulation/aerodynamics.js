const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export const defaultPlane = {
  name: 'Dart-01', mass: 0.006, wingArea: 0.022, span: 0.32, chord: 0.11,
  aspectRatio: 4.65, angleOfAttack: 8
};

// A deliberately lightweight, educational model: forces use dynamic pressure and
// are integrated in SI units. It is not a CFD solver or a substitute for testing.
export function aerodynamicForces({ velocity, plane, density, angleOfAttack }) {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const q = 0.5 * density * speed * speed;
  const aoa = clamp(angleOfAttack, -12, 20) * Math.PI / 180;
  const cl = clamp(0.10 + aoa * 2.4, -0.55, 0.85);
  const cd = 0.075 + (cl * cl) / (Math.PI * Math.max(1, plane.aspectRatio) * 0.78);
  const lift = Math.max(0, q * plane.wingArea * cl);
  const drag = q * plane.wingArea * cd;
  return { lift, drag, speed, cl, cd, ldr: lift / Math.max(drag, 0.0001) };
}

export function stepFlight(state, controls, plane, dt) {
  const windAngle = controls.windDirection * Math.PI / 180;
  const wind = { x: Math.sin(windAngle) * controls.windSpeed, y: 0, z: Math.cos(windAngle) * controls.windSpeed };
  const relative = { x: state.velocity.x - wind.x, y: state.velocity.y, z: state.velocity.z - wind.z };
  const aero = aerodynamicForces({ velocity: relative, plane, density: controls.density, angleOfAttack: controls.angleOfAttack });
  const speed = Math.max(0.001, aero.speed);
  const invMass = 1 / plane.mass;
  // Drag opposes relative airflow; lift is approximated upward for this paper-plane model.
  state.velocity.x += (-aero.drag * relative.x / speed) * invMass * dt;
  state.velocity.z += (-aero.drag * relative.z / speed) * invMass * dt;
  state.velocity.y += (aero.lift - plane.mass * 9.81) * invMass * dt;
  state.position.x += state.velocity.x * dt;
  state.position.y += state.velocity.y * dt;
  state.position.z += state.velocity.z * dt;
  return aero;
}
