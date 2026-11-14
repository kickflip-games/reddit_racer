import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFeedbackPreferences,
  FEEDBACK_PREFERENCES_KEY,
  type FeedbackPreferencesSnapshot,
  type PreferenceStorage,
  type SystemMotion,
} from '../../src/client/feedback-preferences.ts';

class MotionSource implements SystemMotion {
  reducedMotion = false;
  listeners = new Set<(reduced: boolean) => void>();
  subscribe(listener: (reduced: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  change(reduced: boolean): void {
    this.reducedMotion = reduced;
    for (const listener of this.listeners) listener(reduced);
  }
}
class MemoryStorage implements PreferenceStorage {
  value: string | null = null;
  writes = 0;
  getItem(key: string): string | null {
    assert.equal(key, FEEDBACK_PREFERENCES_KEY);
    return this.value;
  }
  setItem(key: string, value: string): void {
    assert.equal(key, FEEDBACK_PREFERENCES_KEY);
    this.value = value;
    this.writes++;
  }
}

void test('preferences default to system motion, subscribe immediately, and follow live device changes', () => {
  const system = new MotionSource();
  const storage = new MemoryStorage();
  const preferences = createFeedbackPreferences({
    systemMotion: system,
    storage,
  });
  const snapshots: Readonly<FeedbackPreferencesSnapshot>[] = [];
  const unsubscribe = preferences.subscribe((snapshot) =>
    snapshots.push(snapshot)
  );
  assert.deepEqual(snapshots, [
    { muted: false, motion: 'system', reducedMotion: false },
  ]);
  system.change(true);
  assert.equal(preferences.snapshot.reducedMotion, true);
  assert.equal(storage.writes, 0);
  system.change(false);
  assert.equal(preferences.snapshot.reducedMotion, false);
  preferences.setMuted(true);
  assert.equal(preferences.snapshot.motion, 'system');
  const writes = storage.writes;
  preferences.setMuted(true);
  assert.equal(storage.writes, writes);
  assert.ok(Object.isFrozen(preferences.snapshot));
  unsubscribe();
  const afterUnsubscribe = snapshots.length;
  preferences.setMuted(false);
  assert.equal(snapshots.length, afterUnsubscribe);
  preferences.dispose();
});

void test('validated saved values roundtrip while corrupt/unsupported settings fall back without overwriting', () => {
  const system = new MotionSource();
  for (const value of [
    '{',
    'null',
    '[]',
    '{"schemaVersion":2,"muted":true,"motion":"full"}',
    '{"schemaVersion":1,"muted":"false","motion":"full"}',
    '{"schemaVersion":1,"muted":true,"motion":"unknown"}',
    '{"schemaVersion":1,"muted":true,"motion":"full","extra":true}',
  ]) {
    const storage = new MemoryStorage();
    storage.value = value;
    const preferences = createFeedbackPreferences({
      systemMotion: system,
      storage,
    });
    assert.deepEqual(preferences.snapshot, {
      muted: false,
      motion: 'system',
      reducedMotion: false,
    });
    assert.equal(storage.value, value);
    assert.equal(storage.writes, 0);
    preferences.dispose();
  }
  const storage = new MemoryStorage();
  const first = createFeedbackPreferences({ systemMotion: system, storage });
  first.setMuted(true);
  first.dispose();
  const second = createFeedbackPreferences({ systemMotion: system, storage });
  assert.deepEqual(second.snapshot, {
    muted: true,
    motion: 'system',
    reducedMotion: false,
  });
  second.dispose();
});

void test('storage and subscriber failures do not block in-memory preferences or leak listeners', () => {
  const system = new MotionSource();
  const storage: PreferenceStorage = {
    getItem() {
      throw new Error('Storage blocked');
    },
    setItem() {
      throw new Error('Storage blocked');
    },
  };
  const preferences = createFeedbackPreferences({
    systemMotion: system,
    storage,
  });
  let changes = 0;
  preferences.subscribe(() => {
    throw new Error('UI observer failed');
  });
  preferences.subscribe(() => changes++);
  for (let retry = 0; retry < 30; retry++) {
    preferences.setMuted(retry % 2 === 0);
    assert.equal(system.listeners.size, 1);
  }
  assert.ok(changes > 30);
  preferences.dispose();
  preferences.dispose();
  assert.equal(system.listeners.size, 0);
  const final = preferences.snapshot;
  system.change(true);
  preferences.setMuted(true);
  assert.equal(preferences.snapshot, final);
  preferences.subscribe(() =>
    assert.fail('disposed subscription must not run')
  )();
});

void test('legacy motion overrides are ignored while saved sound remains', () => {
  for (const motion of ['full', 'reduced']) {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({ schemaVersion: 1, muted: true, motion });
    const system = new MotionSource();
    const preferences = createFeedbackPreferences({
      storage,
      systemMotion: system,
    });
    assert.equal(preferences.snapshot.muted, true);
    assert.equal(preferences.snapshot.reducedMotion, false);
    system.change(true);
    assert.equal(preferences.snapshot.reducedMotion, true);
    preferences.dispose();
  }
});
