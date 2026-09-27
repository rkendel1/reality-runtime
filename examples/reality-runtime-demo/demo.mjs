import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRealityRuntime } from '../../src/index.js';

const WORKSPACE_ID = 'workspace-1';
const ROOM_ID = 'room-1';
const EQUIPMENT_ID = 'project-board';
const TASK_IDS = ['task-1', 'task-2', 'task-3'];

export const DEMO_PARTICIPANTS = {
  alice: { kind: 'person', id: 'alice', displayName: 'Alice', role: 'reviewer' },
  bob: { kind: 'person', id: 'bob', displayName: 'Bob', role: 'implementer' },
  agent: { kind: 'agent', id: 'agent-1', displayName: 'Agent', role: 'automation' },
};

export async function createDemoRuntime({ dataPath, namespace = 'reality-runtime-demo' } = {}) {
  return createRealityRuntime({
    namespace,
    path: dataPath,
    listActions: snapshot => listDemoActions(snapshot),
    act: async ({ db, experience, action }) => applyDemoAction(db, experience, action),
  });
}

export async function seedDemoWorld(runtime) {
  for (const participant of Object.values(DEMO_PARTICIPANTS)) {
    await runtime.ensureParticipant({
      participant,
      displayName: participant.displayName,
      role: participant.role,
    });
  }

  await insertIfMissing(runtime.db.collection('Workspace'), WORKSPACE_ID, {
    id: WORKSPACE_ID,
    name: 'Acme Project',
    status: 'active',
    owner: 'alice',
    created_at: new Date().toISOString(),
  });

  await insertIfMissing(runtime.db.collection('Room'), ROOM_ID, {
    id: ROOM_ID,
    workspace: WORKSPACE_ID,
    name: 'Delivery',
    created_at: new Date().toISOString(),
  });

  await insertIfMissing(runtime.db.collection('Equipment'), EQUIPMENT_ID, {
    id: EQUIPMENT_ID,
    workspace: WORKSPACE_ID,
    room: ROOM_ID,
    name: 'Project Board',
    status: 'tracking',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const tasks = [
    { id: TASK_IDS[0], summary: 'Review requirements', status: 'open', assigned_to: 'alice' },
    { id: TASK_IDS[1], summary: 'Implement task pipeline', status: 'working', assigned_to: 'bob' },
    { id: TASK_IDS[2], summary: 'Claim next available task', status: 'open', assigned_to: undefined },
  ];

  for (const task of tasks) {
    await insertIfMissing(runtime.db.collection('WorkOrder'), task.id, {
      id: task.id,
      workspace: WORKSPACE_ID,
      equipment: EQUIPMENT_ID,
      summary: task.summary,
      status: task.status,
      assigned_to: task.assigned_to,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}

export async function seedDemoJourneys(runtime) {
  return {
    alice: await runtime.createJourney({
      id: 'journey-alice',
      subject: DEMO_PARTICIPANTS.alice,
      goal: 'Review project status',
    }),
    bob: await runtime.createJourney({
      id: 'journey-bob',
      subject: DEMO_PARTICIPANTS.bob,
      goal: 'Complete assigned work',
    }),
    agent: await runtime.createJourney({
      id: 'journey-agent',
      subject: DEMO_PARTICIPANTS.agent,
      goal: 'Implement the next task',
    }),
  };
}

export function projectExperience(snapshot) {
  const participants = snapshot.world.collections.Participant ?? [];
  const participantRecord = participants.find(item => item.id === snapshot.participant.id);
  const workspace = snapshot.world.collections.Workspace?.find(item => item.id === WORKSPACE_ID)
    ?? snapshot.world.collections.Workspace?.[0];
  const tasks = [...(snapshot.world.collections.WorkOrder ?? [])].sort((left, right) => left.id.localeCompare(right.id));
  const focus = snapshot.focus?.target ?? 'workspace';
  let visibleTasks = tasks;
  if (focus.startsWith('task:')) {
    visibleTasks = tasks.filter(task => task.id === focus.slice('task:'.length));
  } else if (focus === 'assigned-work') {
    visibleTasks = tasks.filter(task => task.assigned_to === snapshot.participant.id);
  } else if (focus === 'unassigned-work') {
    visibleTasks = tasks.filter(task => !task.assigned_to);
  }

  return {
    participant: participantRecord?.display_name ?? snapshot.participant.id,
    kind: snapshot.participant.kind,
    journey: snapshot.journey?.goal ?? 'No journey',
    focus,
    reality: snapshot.reality.application,
    project: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          status: workspace.status ?? 'unknown',
          owner: workspace.owner ?? 'unknown',
        }
      : undefined,
    tasks: visibleTasks.map(task => ({
      id: task.id,
      title: task.summary,
      status: task.status,
      assignee: task.assigned_to ?? 'unassigned',
    })),
    authoritativeTaskIds: tasks.map(task => task.id),
  };
}

export function renderExperiencePanel(snapshot) {
  const view = projectExperience(snapshot);
  return renderBox(`${view.participant} (${view.kind})`, [
    `Journey: ${view.journey}`,
    `Focus: ${view.focus}`,
    `Reality: ${view.reality}`,
    `Project: ${view.project?.name ?? 'missing'}`,
    `Status: ${view.project?.status ?? 'unknown'}`,
    `Owner: ${view.project?.owner ?? 'unknown'}`,
    'Tasks:',
    ...view.tasks.map(task => `- ${task.id} ${task.status} @ ${task.assignee}`),
  ]);
}

export async function runDemo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reality-runtime-demo-'));
  const dataPath = path.join(root, 'db');
  const runtime = await createDemoRuntime({ dataPath });
  await seedDemoWorld(runtime);
  const journeys = await seedDemoJourneys(runtime);

  const alice = await runtime.spawn({ participant: DEMO_PARTICIPANTS.alice, journeyId: journeys.alice.id });
  const bob = await runtime.spawn({ participant: DEMO_PARTICIPANTS.bob, journeyId: journeys.bob.id });
  const agent = await runtime.spawn({ participant: DEMO_PARTICIPANTS.agent, journeyId: journeys.agent.id });

  logStep('1 — Enter', `${DEMO_PARTICIPANTS.alice.displayName}, ${DEMO_PARTICIPANTS.bob.displayName}, and ${DEMO_PARTICIPANTS.agent.displayName} enter the same reality.`);
  console.log(renderPanels([alice.snapshot(), bob.snapshot(), agent.snapshot()]));

  await alice.focus('project');
  await bob.focus('task:task-2');
  await agent.focus('unassigned-work');
  logStep('2 — Same reality, different journeys, different focus', 'All three participants share one authoritative Acme Project, but their experiences diverge by journey and focus.');
  console.log(renderPanels([alice.snapshot(), bob.snapshot(), agent.snapshot()]));

  const bobSawReview = waitForTaskState(bob, 'task-1', 'reviewing');
  const agentSawReview = waitForTaskState(agent, 'task-1', 'reviewing');
  await alice.act({ type: 'update-task-status', taskId: 'task-1', status: 'reviewing' });
  await Promise.all([bobSawReview, agentSawReview]);
  logStep('3 — Shared mutation', 'Alice updates Task 1 through her Experience. Bob and Agent observe the same authoritative mutation reactively.');
  console.log(renderPanels([alice.snapshot(), bob.snapshot(), agent.snapshot()]));

  const aliceSawClaim = waitForTaskAssignment(alice, 'task-3', 'agent-1');
  const bobSawClaim = waitForTaskAssignment(bob, 'task-3', 'agent-1');
  await agent.act({ type: 'claim-task', taskId: 'task-3' });
  await Promise.all([aliceSawClaim, bobSawClaim]);
  logStep('4 — Agent parity', 'The agent participant uses the same runtime primitive to claim shared work.');
  console.log(renderPanels([alice.snapshot(), bob.snapshot(), agent.snapshot()]));

  let denial;
  try {
    await bob.viewAs(DEMO_PARTICIPANTS.alice);
  } catch (error) {
    denial = `${error.name}: ${error.message}`;
  }
  logStep('5 — Unauthorized perspective', denial ?? 'Expected Bob.viewAs(Alice) to be denied.');

  await bob.leave();
  logStep('6 — Leave', 'Bob leaves. The shared world, his journey, and the authoritative state remain.');

  const restartedRuntime = await createDemoRuntime({ dataPath });
  const resumedAlice = await restartedRuntime.enter({ participant: DEMO_PARTICIPANTS.alice, journeyId: journeys.alice.id });
  const resumedBob = await restartedRuntime.enter({ participant: DEMO_PARTICIPANTS.bob, journeyId: journeys.bob.id });
  const resumedAgent = await restartedRuntime.enter({ participant: DEMO_PARTICIPANTS.agent, journeyId: journeys.agent.id });
  logStep('7 — Restart and re-enter', 'A new runtime instance reconstructs Bob from FeltDB + .flow + participant + journey history.');
  console.log(renderPanels([resumedAlice.snapshot(), resumedBob.snapshot(), resumedAgent.snapshot()]));

  return { root, dataPath };
}

function listDemoActions(snapshot) {
  const taskId = snapshot.focus?.target?.startsWith('task:') ? snapshot.focus.target.slice('task:'.length) : undefined;
  return [
    { type: 'update-project-status', workspaceId: WORKSPACE_ID, status: 'review' },
    { type: 'update-task-status', taskId: taskId ?? 'task-1', status: 'reviewing' },
    { type: 'claim-task', taskId: 'task-3' },
  ];
}

async function applyDemoAction(db, experience, action) {
  const workspaceCollection = db.collection('Workspace');
  const workOrders = db.collection('WorkOrder');
  const events = db.collection('WorkspaceEvent');
  const timestamp = new Date().toISOString();

  if (action?.type === 'update-project-status') {
    await workspaceCollection.update(action.workspaceId ?? WORKSPACE_ID, { status: action.status });
    await events.insert({
      id: makeEventId(),
      workspace: action.workspaceId ?? WORKSPACE_ID,
      participant_id: experience.participant.id,
      kind: action.type,
      details: `${experience.participant.id} set project status to ${action.status}`,
      created_at: timestamp,
    });
    return { ok: true };
  }

  if (action?.type === 'update-task-status') {
    await workOrders.update(action.taskId, {
      status: action.status,
      updated_at: timestamp,
    });
    await events.insert({
      id: makeEventId(),
      workspace: WORKSPACE_ID,
      participant_id: experience.participant.id,
      kind: action.type,
      details: `${experience.participant.id} set ${action.taskId} to ${action.status}`,
      created_at: timestamp,
    });
    return { ok: true };
  }

  if (action?.type === 'claim-task') {
    await workOrders.update(action.taskId, {
      assigned_to: experience.participant.id,
      status: 'working',
      updated_at: timestamp,
    });
    await events.insert({
      id: makeEventId(),
      workspace: WORKSPACE_ID,
      participant_id: experience.participant.id,
      kind: action.type,
      details: `${experience.participant.id} claimed ${action.taskId}`,
      created_at: timestamp,
    });
    return { ok: true };
  }

  throw new Error(`Unknown demo action: ${action?.type}`);
}

async function insertIfMissing(collection, id, value) {
  const existing = await collection.get(id);
  if (!existing) {
    await collection.insert(value, id);
  }
}

function renderPanels(snapshots) {
  const panels = snapshots.map(renderExperiencePanel);
  const height = Math.max(...panels.map(panel => panel.length));
  return Array.from({ length: height }, (_, index) => panels.map(panel => panel[index] ?? ' '.repeat(panel[0].length)).join('  ')).join('\n');
}

function renderBox(title, lines, width = 40) {
  const header = ` ${title} `;
  const top = `┌${header.padEnd(width - 2, '─')}┐`;
  const body = lines.map(line => `│ ${String(line).slice(0, width - 4).padEnd(width - 4)} │`);
  return [top, ...body, `└${'─'.repeat(width - 2)}┘`];
}

function logStep(title, description) {
  console.log(`\n${title}`);
  console.log(description);
}

function makeEventId() {
  return `event-${randomUUID()}`;
}

function waitForTaskState(experience, taskId, status) {
  return new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = experience.observe(snapshot => {
      const task = snapshot.world.collections.WorkOrder.find(item => item.id === taskId);
      if (task?.status === status) {
        unsubscribe();
        resolve(snapshot);
      }
    });
  });
}

function waitForTaskAssignment(experience, taskId, assignee) {
  return new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = experience.observe(snapshot => {
      const task = snapshot.world.collections.WorkOrder.find(item => item.id === taskId);
      if (task?.assigned_to === assignee) {
        unsubscribe();
        resolve(snapshot);
      }
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDemo().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
