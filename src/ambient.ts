/** Small CSS 3D scenes: no video, external assets, or animation loop. */
export function ambientScene() {
  const scene = document.createElement('div');
  scene.className = 'ambient-scene';
  scene.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    const floater = document.createElement('div');
    floater.className = `ambient-floater floater-${i}`;
    const cube = document.createElement('div');
    cube.className = 'ambient-cube';
    for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      const side = document.createElement('span');
      side.className = `cube-side cube-${face}`;
      cube.append(side);
    }
    const orbit = document.createElement('div');
    orbit.className = 'ambient-orbit';
    orbit.append(document.createElement('span'));
    floater.append(cube, orbit);
    scene.append(floater);
  }
  return scene;
}
