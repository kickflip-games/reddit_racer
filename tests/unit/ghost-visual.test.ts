import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGhostVisual } from '../../src/client/ghost-visual.ts';
import type { GhostLap } from '../../src/client/best-ghost.ts';
import { CAR_VISUAL_LENGTH } from '../../src/client/car-visual.ts';
void test('ghost uses translucent shared car geometry, correct heading and isolated materials', () => {
  const ghost = createGhostVisual();
  assert.equal(ghost.object.children.length, 1);
  assert.ok(
    ghost.object.children.every((child) => !(child instanceof THREE.Line))
  );
  const lap: GhostLap = {
    ticks: 120,
    points: [
      [0, 0, 0, 0],
      [120, 10, 2, 0],
    ],
  };
  ghost.update(lap, 60, true);
  assert.equal(ghost.object.visible, false);
  const template = new THREE.Group();
  const geometry = new THREE.BoxGeometry(2, 1, 4);
  const material = new THREE.MeshStandardMaterial({ color: 'orange' });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'body';
  template.add(mesh);
  let geometryDisposals = 0,
    sourceDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => sourceDisposals++);
  assert.equal(ghost.installModel(template), true);
  const copied = ghost.object.getObjectByName('body');
  assert.ok(copied instanceof THREE.Mesh);
  assert.equal(copied.geometry, geometry);
  assert.notEqual(copied.material, material);
  assert.ok(copied.material instanceof THREE.MeshBasicMaterial);
  assert.equal(copied.material.opacity, 0.38);
  assert.equal(copied.material.depthWrite, false);
  assert.equal(material.transparent, false);
  const car = ghost.object.getObjectByName('best-lap-ghost-car');
  assert.ok(car);
  const bounds = new THREE.Box3().setFromObject(car);
  assert.ok(
    Math.abs(bounds.getSize(new THREE.Vector3()).z - CAR_VISUAL_LENGTH) < 1e-6
  );
  ghost.update(lap, 60, true);
  assert.equal(ghost.object.visible, true);
  assert.equal(car.position.x, 5);
  assert.equal(car.rotation.y, Math.PI / 2);
  assert.ok(car.rotation.x < 0);
  ghost.update(lap, 60, false);
  assert.equal(ghost.object.visible, false);
  ghost.update(lap, 121, true);
  assert.equal(ghost.object.visible, false);
  ghost.dispose();
  ghost.dispose();
  assert.equal(geometryDisposals, 0);
  assert.equal(sourceDisposals, 0);
  ghost.update(lap, 60, true);
  assert.equal(ghost.object.visible, false);
  geometry.dispose();
  material.dispose();
});
