import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  InvalidPerspectiveError,
  PresenceNotFoundError,
  UnauthorizedActionError,
  UnauthorizedPerspectiveError,
  createRealityRuntime,
} from '../src/index.js';

async function makeRuntime(label, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));
  const runtime = await createRealityRuntime({
    namespace: 'reality-runtime-tests',
    path: path.join(root, 'db'),
    ...options,
  });
  return { root, runtime };
}

async function seedWorkspace(runtime) {
  const workspaceId = 'workspace-1';
  const roomId = 'room-1';
  const equipmentId = 'machine-17';
  await runtime.db.collection('Workspace').insert({
    id: workspaceId,
    name: 'Assembly Floor',
    created_at: new Date().toISOString(),
  }, workspaceId);
  await runtime.db.collection('Room').insert({
    id: roomId,
    workspace: workspaceId,
    name: 'Line A',
    created_at: new Date().toISOString(),
  }, roomId);
  await runtime.db.collection('Equipment').insert({
    id: equipmentId,
    workspace: workspaceId,
    room: roomId,
    name: 'Machine 17',
    status: 'faulted',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, equipmentId);
  await runtime.db.collection('WorkOrder').insert({
    id: 'work-order-1',
    workspace: workspaceId,
    equipment: equipmentId,
    summary: 'Repair machine 17',
    status: 'open',
    assigned_to: 'tech-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, 'work-order-1');
  return { workspaceId, roomId, equipmentId };
}

test('two participants inhabit one reality with independent durable Presence records', async () => {
  const { runtime } = await makeRuntime('presence');
  await seedWorkspace(runtime);
  const journey = await runtime.createJourney({
    subject: { kind: 'person', id: 'alice' },
    goal: 'repair-machine-17',
  });

  const alice = await runtime.spawn({ participant: { kind: 'person', id: 'alice' }, journeyId: journey.id });
  const bob = await runtime.spawn({ participant: { kind: 'person', id: 'bob' }, reality: alice.reality });

  assert.equal(alice.reality.application, bob.reality.application);
  assert.notEqual(alice.presence.id, bob.presence.id);
  assert.equal(alice.presence.participant.id, 'alice');
  assert.equal(bob.presence.participant.id, 'bob');
  assert.deepEqual(alice.world.collections.Workspace, bob.world.collections.Workspace);
});

test('viewAs rejects cross-participant escalation and preserves safe semantics', async () => {
  const { runtime } = await makeRuntime('view-as');
  await seedWorkspace(runtime);
  const alice = await runtime.spawn({ participant: { kind: 'person', id: 'alice' } });

  await assert.rejects(
    alice.viewAs({ kind: 'person', id: 'bob' }),
    error => error instanceof UnauthorizedPerspectiveError && /principal-scoped/i.test(error.message),
  );

  const self = await alice.viewAsSelf();
  assert.equal(self.participant.id, 'alice');
});

test('journey reconstruction survives runtime recreation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'journey-reconstruction-'));
  const first = await createRealityRuntime({
    namespace: 'reality-runtime-tests',
    path: path.join(root, 'db'),
  });
  await seedWorkspace(first);
  const journey = await first.createJourney({
    subject: { kind: 'person', id: 'alice' },
    goal: 'repair-machine-17',
  });
  const experience = await first.spawn({
    participant: { kind: 'person', id: 'alice' },
    journeyId: journey.id,
  });
  await experience.leave();

  const second = await createRealityRuntime({
    namespace: 'reality-runtime-tests',
    path: path.join(root, 'db'),
  });
  const resumed = await second.enter({
    participant: { kind: 'person', id: 'alice' },
    journeyId: journey.id,
  });

  assert.equal(resumed.journey.id, journey.id);
  assert.equal(resumed.world.collections.WorkOrder[0].summary, 'Repair machine 17');
  assert.ok(resumed.presence.id);
});

test('enter restores journey association from prior Presence when journeyId is omitted', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'journey-implicit-enter-'));
  const first = await createRealityRuntime({
    namespace: 'reality-runtime-tests',
    path: path.join(root, 'db'),
  });
  await seedWorkspace(first);
  const journey = await first.createJourney({
    subject: { kind: 'person', id: 'alice' },
    goal: 'repair-machine-17',
  });
  const experience = await first.spawn({
    participant: { kind: 'person', id: 'alice' },
    journeyId: journey.id,
  });
  await experience.leave();

  const second = await createRealityRuntime({
    namespace: 'reality-runtime-tests',
    path: path.join(root, 'db'),
  });
  const resumed = await second.enter({
    participant: { kind: 'person', id: 'alice' },
  });

  assert.equal(resumed.journey.id, journey.id);
  assert.equal(resumed.presence.journeyId, journey.id);
});

test('enter fails when no durable Presence history exists', async () => {
  const { runtime } = await makeRuntime('missing-presence');
  await assert.rejects(
    runtime.enter({ participant: { kind: 'person', id: 'nobody' }, journeyId: 'journey-missing' }),
    error => error instanceof PresenceNotFoundError,
  );
});

test('enter restores persisted reality and rejects ambiguous multi-reality history', async () => {
  const { runtime } = await makeRuntime('enter-reality');
  await runtime.db.collection('Presence').insert({
    id: 'presence-1',
    participant_id: 'alice',
    participant_kind: 'person',
    journey_id: undefined,
    reality_application: 'archived-reality',
    reality_environment: 'preview',
    reality_flow_revision: '7',
    entered_at: new Date(Date.now() - 1_000).toISOString(),
    exited_at: new Date(Date.now() - 500).toISOString(),
  }, 'presence-1');

  const restored = await runtime.enter({ participant: { kind: 'person', id: 'alice' } });
  assert.equal(restored.reality.application, 'archived-reality');
  assert.equal(restored.reality.environment, 'preview');
  assert.equal(restored.reality.flowRevision, '7');

  await runtime.db.collection('Presence').insert({
    id: 'presence-2',
    participant_id: 'alice',
    participant_kind: 'person',
    journey_id: undefined,
    reality_application: 'current-reality',
    reality_environment: 'production',
    reality_flow_revision: '9',
    entered_at: new Date().toISOString(),
    exited_at: undefined,
  }, 'presence-2');

  await assert.rejects(
    runtime.enter({ participant: { kind: 'person', id: 'alice' } }),
    error => error instanceof InvalidPerspectiveError,
  );
});

test('shared reality updates propagate through FeltDB subscriptions with no polling cache', async () => {
  const { runtime } = await makeRuntime('observe', {
    act: async ({ db }) => {
      await db.collection('Equipment').update('machine-17', {
        status: 'running',
        updated_at: new Date().toISOString(),
      });
      await db.collection('WorkOrder').update('work-order-1', {
        status: 'completed',
        updated_at: new Date().toISOString(),
      });
    },
  });
  const { equipmentId, workspaceId } = await seedWorkspace(runtime);

  const alice = await runtime.spawn({ participant: { kind: 'person', id: 'alice' } });
  const bob = await runtime.spawn({
    participant: { kind: 'agent', id: 'maintenance-bot' },
    reality: alice.reality,
  });

  const snapshots = [];
  const done = new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = alice.observe(snapshot => {
      snapshots.push(snapshot.world.collections.WorkOrder.map(item => item.status).join(','));
      if (snapshots.includes('completed')) {
        unsubscribe();
        resolve();
      }
    });
  });

  await bob.act({ type: 'complete-work-order' });
  await done;
  assert.ok(snapshots.includes('completed'));
  const order = await runtime.db.collection('WorkOrder').get('work-order-1');
  assert.equal(order.workspace, workspaceId);
  assert.equal(order.equipment, equipmentId);
});

test('act rejects when no FeltDB-backed action handler is configured', async () => {
  const { runtime } = await makeRuntime('act');
  await seedWorkspace(runtime);
  const alice = await runtime.spawn({ participant: { kind: 'person', id: 'alice' } });

  await assert.rejects(
    alice.act({ type: 'unauthorized' }),
    error => error instanceof UnauthorizedActionError && /unauthorized/i.test(error.message),
  );

  const workOrder = await runtime.db.collection('WorkOrder').get('work-order-1');
  assert.equal(workOrder.status, 'open');
});

test('focus is session state, survives authoritative updates, and does not block non-human participants', async () => {
  const { runtime } = await makeRuntime('focus', {
    act: async ({ db }) => {
      await db.collection('Equipment').update('machine-17', {
        status: 'maintenance',
        updated_at: new Date().toISOString(),
      });
    },
  });
  await seedWorkspace(runtime);
  const agent = await runtime.spawn({ participant: { kind: 'agent', id: 'maintenance-bot' } });
  await agent.focus('machine-17');
  assert.equal(agent.snapshot().focus.target, 'machine-17');

  const changed = new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = agent.observe(snapshot => {
      const equipment = snapshot.world.collections.Equipment.find(item => item.id === 'machine-17');
      if (equipment?.status === 'maintenance') {
        unsubscribe();
        resolve(snapshot);
      }
    });
  });

  await agent.act({ type: 'mark-maintenance' });
  const snapshot = await changed;
  assert.equal(snapshot.focus.target, 'machine-17');
});
