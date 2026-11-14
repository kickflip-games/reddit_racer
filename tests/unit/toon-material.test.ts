import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { toonMaterial, softCarShadow } from '../../src/client/toon-material';
import { createCarVisual } from '../../src/client/car-visual';

test('toon conversion preserves borrowed palette and alpha without changing source', () => {
  const map = new THREE.Texture();
  const source = new THREE.MeshStandardMaterial({
    color: '#e97e35',
    map,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
  });
  const result = toonMaterial(source);
  assert.ok(result instanceof THREE.MeshToonMaterial);
  assert.equal(result.map, map);
  assert.equal(result.alphaTest, 0.4);
  assert.equal(result.side, THREE.DoubleSide);
  assert.ok(result.color.equals(source.color));
  result.color.set('#ffffff');
  assert.notEqual(result.color.getHex(), source.color.getHex());
  result.dispose();
  source.dispose();
  map.dispose();
});

test('car shadow remains at supporting surface, softens with altitude, and follows sun', () => {
  const car = createCarVisual();
  const frame = {
    x: 10,
    z: 20,
    heading: 0.5,
    distance: 0,
    speed: 0,
    acceleration: 0,
    lateralAcceleration: 0,
    curvature: 0,
    slip: 0,
    held: false,
    racing: false,
    reducedMotion: true,
    deltaSeconds: 0,
    elevation: 4,
    surfaceHeight: 4,
  };
  car.update(frame);
  const shadow = car.object.getObjectByName('car-contact-shadow');
  assert.ok(shadow instanceof THREE.Mesh);
  assert.ok(shadow.material instanceof THREE.ShaderMaterial);
  car.object.updateMatrixWorld(true);
  const grounded = shadow.getWorldPosition(new THREE.Vector3());
  const alpha = shadow.material.uniforms.opacity!.value;
  car.update({ ...frame, elevation: 10, bank: 0.2, jumpPitch: 0.3 });
  car.object.updateMatrixWorld(true);
  const airborne = shadow.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(airborne.y - grounded.y) < 1e-6);
  assert.ok(airborne.x > grounded.x && airborne.z < grounded.z);
  assert.ok(shadow.material.uniforms.opacity!.value < alpha);
  car.dispose();
});

test('shadow adds no lighting pass and does not write depth', () => {
  const material = softCarShadow();
  assert.equal(material.depthWrite, false);
  assert.equal(material.lights, false);
  material.dispose();
});

test('toon ramp is shared, strictly stepped and costs no extra lighting passes', () => {
  const source = new THREE.MeshStandardMaterial();
  const first = toonMaterial(source);
  const second = toonMaterial(source);
  const ramp = first.gradientMap;
  assert.ok(ramp instanceof THREE.DataTexture);
  assert.equal(ramp, second.gradientMap);
  assert.ok(ramp.image.data instanceof Uint8Array);
  assert.deepEqual(Array.from(ramp.image.data), [45, 130, 255]);
  assert.equal(ramp.image.width, 3);
  assert.equal(ramp.magFilter, THREE.NearestFilter);
  assert.equal(ramp.minFilter, THREE.NearestFilter);
  assert.equal(ramp.generateMipmaps, false);
  first.dispose();
  assert.equal(second.gradientMap, ramp);
  second.dispose();
  source.dispose();
});
