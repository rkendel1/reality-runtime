import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRealityRuntime } from '../../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HEALTHCARE_FLOW_PATH = path.resolve(HERE, 'healthcare.flow');

export const TIMELINE = {
  encounterCreated: '2026-01-15T10:00:00.000Z',
  coverageChecked: '2026-01-15T10:02:00.000Z',
  authorizationSubmitted: '2026-01-15T10:04:00.000Z',
  authorizationReviewed: '2026-01-15T10:06:00.000Z',
  authorizationApproved: '2026-01-15T10:07:00.000Z',
  claimSubmitted: '2026-01-15T10:20:00.000Z',
  claimProcessed: '2026-01-15T10:22:00.000Z',
};

export const HEALTHCARE_IDS = {
  employer: 'employer-acme',
  healthPlan: 'health-plan-acme',
  benefitPlan: 'benefit-plan-gold',
  member: 'member-alice',
  memberOther: 'member-bob',
  provider: 'provider-dr-smith',
  coverage: 'coverage-alice',
  coverageOther: 'coverage-bob',
  encounter: 'encounter-alice-procedure',
  authorization: 'authorization-alice-procedure',
  claim: 'claim-alice-procedure',
  careJourney: 'care-journey-alice-procedure',
};

export const HEALTHCARE_PARTICIPANTS = {
  member: { kind: 'person', id: 'participant-member-alice', displayName: 'Alice', role: 'member' },
  provider: { kind: 'person', id: 'participant-provider-smith', displayName: 'Dr. Smith', role: 'provider' },
  healthPlan: { kind: 'organization', id: 'participant-health-plan', displayName: 'Acme Health Plan', role: 'health-plan' },
  employer: { kind: 'organization', id: 'participant-employer', displayName: 'Acme Corp', role: 'employer' },
  developer: { kind: 'person', id: 'participant-developer', displayName: 'Platform Developer', role: 'developer' },
};

const STATIC_COLLECTIONS = ['Participant', 'Employer', 'HealthPlan', 'BenefitPlan', 'Member', 'Provider'];
const REPLAY_COLLECTIONS = ['Coverage', 'Encounter', 'Authorization', 'Claim', 'CareJourney'];

export async function createHealthcareDemoRuntime({ dataPath, namespace = 'reality-runtime-healthcare-demo' } = {}) {
  return createRealityRuntime({
    namespace,
    path: dataPath,
    flowPath: HEALTHCARE_FLOW_PATH,
    listActions: snapshot => listHealthcareActions(snapshot),
    act: async ({ db, experience, action }) => applyHealthcareAction(db, experience, action),
    materializeWorld: async ({ experience, defaultMaterializeWorld }) => {
      const liveWorld = await defaultMaterializeWorld();
      if (experience?.modeState?.kind !== 'replay') return liveWorld;
      return projectHistoricalWorld(liveWorld, experience.modeState.at);
    },
  });
}

export async function seedHealthcareWorld(runtime) {
  for (const participant of Object.values(HEALTHCARE_PARTICIPANTS)) {
    await runtime.ensureParticipant({ participant });
  }

  await insertIfMissing(runtime.db.collection('Employer'), HEALTHCARE_IDS.employer, {
    id: HEALTHCARE_IDS.employer,
    name: 'Acme Corp',
    created_at: TIMELINE.encounterCreated,
  });
  await insertIfMissing(runtime.db.collection('HealthPlan'), HEALTHCARE_IDS.healthPlan, {
    id: HEALTHCARE_IDS.healthPlan,
    name: 'Acme Health Plan',
    created_at: TIMELINE.encounterCreated,
  });
  await insertIfMissing(runtime.db.collection('BenefitPlan'), HEALTHCARE_IDS.benefitPlan, {
    id: HEALTHCARE_IDS.benefitPlan,
    employer: HEALTHCARE_IDS.employer,
    health_plan: HEALTHCARE_IDS.healthPlan,
    name: 'Gold PPO',
    status: 'active',
    created_at: TIMELINE.encounterCreated,
  });
  await insertIfMissing(runtime.db.collection('Member'), HEALTHCARE_IDS.member, {
    id: HEALTHCARE_IDS.member,
    employer: HEALTHCARE_IDS.employer,
    benefit_plan: HEALTHCARE_IDS.benefitPlan,
    display_name: 'Alice',
    member_number: 'MEM-1001',
    created_at: TIMELINE.encounterCreated,
  });
  await insertIfMissing(runtime.db.collection('Member'), HEALTHCARE_IDS.memberOther, {
    id: HEALTHCARE_IDS.memberOther,
    employer: HEALTHCARE_IDS.employer,
    benefit_plan: HEALTHCARE_IDS.benefitPlan,
    display_name: 'Bob Example',
    member_number: 'MEM-2002',
    created_at: TIMELINE.encounterCreated,
  });
  await insertIfMissing(runtime.db.collection('Provider'), HEALTHCARE_IDS.provider, {
    id: HEALTHCARE_IDS.provider,
    display_name: 'Dr. Smith',
    specialty: 'Orthopedics',
    created_at: TIMELINE.encounterCreated,
  });

  await upsertHealthcareRecord(runtime.db.collection('Coverage'), coverageRecord({
    id: HEALTHCARE_IDS.coverage,
    member: HEALTHCARE_IDS.member,
    status: 'active',
  }));
  await upsertHealthcareRecord(runtime.db.collection('Coverage'), coverageRecord({
    id: HEALTHCARE_IDS.coverageOther,
    member: HEALTHCARE_IDS.memberOther,
    status: 'active',
  }));
  await upsertHealthcareRecord(runtime.db.collection('Encounter'), encounterRecord({
    status: 'documented',
    updatedAt: TIMELINE.encounterCreated,
  }));
  await upsertHealthcareRecord(runtime.db.collection('Authorization'), authorizationRecord({
    status: 'draft',
    decisionReason: 'Awaiting submission',
    evidence: 'Clinical notes collected',
    updatedAt: TIMELINE.encounterCreated,
  }));
  await upsertHealthcareRecord(runtime.db.collection('Claim'), claimRecord({
    status: 'not-submitted',
    updatedAt: TIMELINE.encounterCreated,
  }));
  await upsertHealthcareRecord(runtime.db.collection('CareJourney'), careJourneyRecord({
    status: 'coverage-checked',
    updatedAt: TIMELINE.coverageChecked,
  }));

  await recordHealthcareEvent(runtime.db, {
    id: 'healthcare-event-001',
    sequence: '001',
    actor_id: HEALTHCARE_PARTICIPANTS.provider.id,
    actor_role: HEALTHCARE_PARTICIPANTS.provider.role,
    kind: 'encounter-created',
    entity_type: 'Encounter',
    entity_id: HEALTHCARE_IDS.encounter,
    summary: 'Provider documented the procedure encounter.',
    created_at: TIMELINE.encounterCreated,
    effect: {
      upserts: {
        Encounter: [encounterRecord({ status: 'documented', updatedAt: TIMELINE.encounterCreated })],
        Authorization: [authorizationRecord({
          status: 'draft',
          decisionReason: 'Awaiting submission',
          evidence: 'Clinical notes collected',
          updatedAt: TIMELINE.encounterCreated,
        })],
        Claim: [claimRecord({ status: 'not-submitted', updatedAt: TIMELINE.encounterCreated })],
        CareJourney: [careJourneyRecord({ status: 'encounter-created', updatedAt: TIMELINE.encounterCreated })],
      },
    },
  });
  await recordHealthcareEvent(runtime.db, {
    id: 'healthcare-event-002',
    sequence: '002',
    actor_id: HEALTHCARE_PARTICIPANTS.healthPlan.id,
    actor_role: HEALTHCARE_PARTICIPANTS.healthPlan.role,
    kind: 'coverage-checked',
    entity_type: 'Coverage',
    entity_id: HEALTHCARE_IDS.coverage,
    summary: 'Coverage was checked before authorization submission.',
    created_at: TIMELINE.coverageChecked,
    effect: {
      upserts: {
        Coverage: [
          coverageRecord({
            id: HEALTHCARE_IDS.coverage,
            member: HEALTHCARE_IDS.member,
            status: 'active',
            updatedAt: TIMELINE.coverageChecked,
          }),
          coverageRecord({
            id: HEALTHCARE_IDS.coverageOther,
            member: HEALTHCARE_IDS.memberOther,
            status: 'active',
            updatedAt: TIMELINE.coverageChecked,
          }),
        ],
        CareJourney: [careJourneyRecord({ status: 'coverage-checked', updatedAt: TIMELINE.coverageChecked })],
      },
    },
  });
}

export async function seedHealthcareJourneys(runtime) {
  return {
    member: await runtime.createJourney({
      id: 'journey-member-care',
      subject: HEALTHCARE_PARTICIPANTS.member,
      goal: 'Get my procedure covered and understand what I owe.',
    }),
    provider: await runtime.createJourney({
      id: 'journey-provider-care',
      subject: HEALTHCARE_PARTICIPANTS.provider,
      goal: 'Get Alice the treatment she needs.',
    }),
    healthPlan: await runtime.createJourney({
      id: 'journey-plan-authorization',
      subject: HEALTHCARE_PARTICIPANTS.healthPlan,
      goal: 'Determine whether the requested service is covered.',
    }),
    employer: await runtime.createJourney({
      id: 'journey-employer-utilization',
      subject: HEALTHCARE_PARTICIPANTS.employer,
      goal: 'Understand how our benefit plan is performing.',
    }),
    developer: await runtime.createJourney({
      id: 'journey-developer-debug',
      subject: HEALTHCARE_PARTICIPANTS.developer,
      goal: 'Understand why this authorization workflow produced this result.',
    }),
  };
}

export async function focusHealthcareParticipants(experiences) {
  await experiences.member.focus('authorization');
  await experiences.provider.focus('encounter');
  await experiences.healthPlan.focus('coverage');
  await experiences.employer.focus('plan');
  await experiences.developer.focus('workflow');
  return experiences;
}

export async function refreshHealthcareParticipants(experiences) {
  await Promise.all(Object.values(experiences).map(experience => experience.refresh()));
  return experiences;
}

export function projectHealthcareExperience(snapshot) {
  const participants = indexById(snapshot.world.collections.Participant ?? []);
  const members = indexById(snapshot.world.collections.Member ?? []);
  const providers = indexById(snapshot.world.collections.Provider ?? []);
  const plans = indexById(snapshot.world.collections.HealthPlan ?? []);
  const benefitPlans = indexById(snapshot.world.collections.BenefitPlan ?? []);
  const coverage = first(snapshot.world.collections.Coverage);
  const encounter = first(snapshot.world.collections.Encounter);
  const authorization = first(snapshot.world.collections.Authorization);
  const claim = first(snapshot.world.collections.Claim);
  const careJourney = first(snapshot.world.collections.CareJourney);
  const events = [...(snapshot.world.collections.HealthcareEvent ?? [])].sort(compareEvents);
  const role = participants[snapshot.participant.id]?.role ?? snapshot.participant.role ?? 'participant';
  const focus = snapshot.focus?.target ?? defaultFocusForRole(role);
  const participantName = participants[snapshot.participant.id]?.display_name ?? snapshot.participant.id;
  const primaryMember = coverage ? members[coverage.member] : members[HEALTHCARE_IDS.member];
  const employerAggregate = {
    planName: benefitPlans[HEALTHCARE_IDS.benefitPlan]?.name ?? 'Unknown Plan',
    coveredMembers: Object.values(members).filter(member => member.benefit_plan === HEALTHCARE_IDS.benefitPlan).length,
    pendingAuthorizations: (snapshot.world.collections.Authorization ?? []).filter(item => ['submitted', 'under-review'].includes(item.status)).length,
    approvedAuthorizations: (snapshot.world.collections.Authorization ?? []).filter(item => item.status === 'approved').length,
    submittedClaims: (snapshot.world.collections.Claim ?? []).filter(item => item.status === 'submitted').length,
    processedClaims: (snapshot.world.collections.Claim ?? []).filter(item => item.status === 'processed').length,
  };

  const base = {
    participant: participantName,
    role,
    journey: snapshot.journey?.goal ?? 'No journey',
    focus,
    perspective: role,
    reality: snapshot.reality.application,
    mode: formatMode(snapshot.mode),
    timeline: events.map(event => `${formatClock(event.created_at)} ${event.summary}`),
    careJourneyStatus: careJourney?.status ?? 'unknown',
    authorizationStatus: authorization?.status ?? 'unknown',
    claimStatus: claim?.status ?? 'unknown',
    focusTarget: focus,
    availableActions: snapshot.availableActions.map(action => action.type),
  };

  if (role === 'member') {
    return {
      ...base,
      view: {
        memberName: primaryMember?.display_name ?? 'Unknown Member',
        procedure: encounter?.service ?? 'Unknown Service',
        coverageStatus: coverage?.status ?? 'unknown',
        authorizationStatus: authorization?.status ?? 'unknown',
        estimatedResponsibility: coverage?.estimated_member_responsibility ?? 'unknown',
        claimStatus: claim?.status ?? 'unknown',
        memberResponsibility: claim?.member_responsibility ?? 'unknown',
      },
    };
  }

  if (role === 'provider') {
    return {
      ...base,
      view: {
        memberName: primaryMember?.display_name ?? 'Unknown Member',
        procedure: encounter?.service ?? 'Unknown Service',
        encounterStatus: encounter?.status ?? 'unknown',
        clinicalSummary: encounter?.clinical_summary ?? 'unknown',
        authorizationStatus: authorization?.status ?? 'unknown',
        claimStatus: claim?.status ?? 'unknown',
      },
    };
  }

  if (role === 'health-plan') {
    return {
      ...base,
      view: {
        planName: plans[HEALTHCARE_IDS.healthPlan]?.name ?? 'Unknown Plan',
        benefitPlan: benefitPlans[HEALTHCARE_IDS.benefitPlan]?.name ?? 'Unknown Benefit Plan',
        coverageStatus: coverage?.status ?? 'unknown',
        authorizationStatus: authorization?.status ?? 'unknown',
        decisionReason: authorization?.decision_reason ?? 'Pending',
        evidence: authorization?.evidence ?? 'No evidence',
        claimStatus: claim?.status ?? 'unknown',
        claimAmount: claim?.amount ?? 'unknown',
      },
    };
  }

  if (role === 'employer') {
    return {
      ...base,
      view: {
        planName: employerAggregate.planName,
        coveredMembers: employerAggregate.coveredMembers,
        pendingAuthorizations: employerAggregate.pendingAuthorizations,
        approvedAuthorizations: employerAggregate.approvedAuthorizations,
        submittedClaims: employerAggregate.submittedClaims,
        processedClaims: employerAggregate.processedClaims,
      },
    };
  }

  return {
    ...base,
    view: {
      environment: 'demo/test only',
      eventCount: events.length,
      currentAuthorization: authorization?.status ?? 'unknown',
      currentClaim: claim?.status ?? 'unknown',
      latestWorkflowStep: events.at(-1)?.summary ?? 'No workflow steps',
      evidence: authorization?.evidence ?? 'No evidence',
    },
  };
}

export function renderHealthcareExperiencePanel(snapshot) {
  const projected = projectHealthcareExperience(snapshot);
  const lines = [
    `Participant: ${projected.participant}`,
    `Journey: ${projected.journey}`,
    `Perspective: ${projected.perspective}`,
    `Focus: ${projected.focus}`,
    `Mode: ${projected.mode}`,
    `Reality: ${projected.reality}`,
    ...Object.entries(projected.view).map(([key, value]) => `${humanize(key)}: ${String(value)}`),
    'Timeline:',
    ...projected.timeline.slice(-4).map(item => `- ${item}`),
    `Actions: ${projected.availableActions.join(', ') || 'none'}`,
  ];
  return renderBox(`${projected.role.toUpperCase()}`, lines, 48);
}

export async function runHealthcareDemo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reality-runtime-healthcare-'));
  const dataPath = path.join(root, 'db');
  const runtime = await createHealthcareDemoRuntime({ dataPath });
  await seedHealthcareWorld(runtime);
  const journeys = await seedHealthcareJourneys(runtime);

  const experiences = await spawnHealthcareParticipants(runtime, journeys);
  await focusHealthcareParticipants(experiences);

  logStep('1 — Enter', 'Member, Provider, Health Plan, Employer, and Developer enter one shared synthetic healthcare reality.');
  console.log(renderPanels(experiencesToSnapshots(experiences)));

  logStep('2 — Different journeys and focus', 'Each participant keeps a different journey and focus while inhabiting the same durable reality.');
  console.log(renderPanels(experiencesToSnapshots(experiences)));

  const memberSawSubmission = waitForAuthorizationStatus(experiences.member, 'submitted');
  const planSawSubmission = waitForAuthorizationStatus(experiences.healthPlan, 'submitted');
  const developerSawSubmission = waitForAuthorizationStatus(experiences.developer, 'submitted');
  await experiences.provider.act({ type: 'submit-authorization' });
  await Promise.all([memberSawSubmission, planSawSubmission, developerSawSubmission]);
  await refreshHealthcareParticipants(experiences);
  logStep('3 — Provider submits authorization', 'One mutation updates the shared reality and multiple participant experiences react without polling.');
  console.log(renderPanels(experiencesToSnapshots(experiences)));

  const memberSawApproval = waitForAuthorizationStatus(experiences.member, 'approved');
  const providerSawApproval = waitForAuthorizationStatus(experiences.provider, 'approved');
  await experiences.healthPlan.act({ type: 'review-authorization' });
  await experiences.healthPlan.act({ type: 'approve-authorization' });
  await Promise.all([memberSawApproval, providerSawApproval]);
  await refreshHealthcareParticipants(experiences);
  logStep('4 — Health plan reviews and approves', 'The plan action becomes durable state, then Member and Provider observe the same approval from their own experiences.');
  console.log(renderPanels(experiencesToSnapshots(experiences)));

  logStep('5 — Employer boundary', 'Employer sees benefit-plan utilization and status counts, not member clinical detail.');
  console.log(renderHealthcareExperiencePanel(experiences.employer.snapshot()));

  logStep('6 — Developer replay @ 10:04', 'Replay reconstructs the same historical reality for five participants at the authorization-submitted moment.');
  const replaySnapshots = await replayHealthcareSnapshots(experiences, TIMELINE.authorizationSubmitted);
  console.log(renderPanels(replaySnapshots));

  logStep('7 — Restart and reconstruct', 'A fresh runtime reconstructs all journeys and experiences from durable state.');
  const restartedRuntime = await createHealthcareDemoRuntime({ dataPath });
  const resumed = await enterHealthcareParticipants(restartedRuntime, journeys);
  await focusHealthcareParticipants(resumed);
  await refreshHealthcareParticipants(resumed);
  console.log(renderPanels(experiencesToSnapshots(resumed)));

  const memberSawClaim = waitForClaimStatus(resumed.member, 'submitted');
  const planSawClaim = waitForClaimStatus(resumed.healthPlan, 'submitted');
  await resumed.provider.act({ type: 'submit-claim' });
  await Promise.all([memberSawClaim, planSawClaim]);
  await refreshHealthcareParticipants(resumed);
  logStep('8 — Current action after replay', 'Replay stays read-only; an authorized current participant acts on live reality and everyone updates again.');
  console.log(renderPanels(experiencesToSnapshots(resumed)));

  return { root, dataPath };
}

export async function spawnHealthcareParticipants(runtime, journeys) {
  return {
    member: await runtime.spawn({ participant: HEALTHCARE_PARTICIPANTS.member, journeyId: journeys.member.id }),
    provider: await runtime.spawn({ participant: HEALTHCARE_PARTICIPANTS.provider, journeyId: journeys.provider.id }),
    healthPlan: await runtime.spawn({ participant: HEALTHCARE_PARTICIPANTS.healthPlan, journeyId: journeys.healthPlan.id }),
    employer: await runtime.spawn({ participant: HEALTHCARE_PARTICIPANTS.employer, journeyId: journeys.employer.id }),
    developer: await runtime.spawn({ participant: HEALTHCARE_PARTICIPANTS.developer, journeyId: journeys.developer.id }),
  };
}

export async function enterHealthcareParticipants(runtime, journeys) {
  return {
    member: await runtime.enter({ participant: HEALTHCARE_PARTICIPANTS.member, journeyId: journeys.member.id }),
    provider: await runtime.enter({ participant: HEALTHCARE_PARTICIPANTS.provider, journeyId: journeys.provider.id }),
    healthPlan: await runtime.enter({ participant: HEALTHCARE_PARTICIPANTS.healthPlan, journeyId: journeys.healthPlan.id }),
    employer: await runtime.enter({ participant: HEALTHCARE_PARTICIPANTS.employer, journeyId: journeys.employer.id }),
    developer: await runtime.enter({ participant: HEALTHCARE_PARTICIPANTS.developer, journeyId: journeys.developer.id }),
  };
}

export async function replayHealthcareSnapshots(experiences, at) {
  const replayed = await Promise.all(Object.values(experiences).map(experience => experience.replay(at)));
  return replayed.map(experience => experience.snapshot());
}

function listHealthcareActions(snapshot) {
  if (snapshot.mode?.kind === 'replay') return [];
  const participant = findParticipant(snapshot);
  const authorization = first(snapshot.world.collections.Authorization);
  const claim = first(snapshot.world.collections.Claim);
  if (!participant || !authorization || !claim) return [];

  if (participant.role === 'provider' && authorization.status === 'draft') {
    return [{ type: 'submit-authorization' }];
  }
  if (participant.role === 'health-plan' && authorization.status === 'submitted') {
    return [{ type: 'review-authorization' }];
  }
  if (participant.role === 'health-plan' && authorization.status === 'under-review') {
    return [{ type: 'approve-authorization' }];
  }
  if (participant.role === 'provider' && authorization.status === 'approved' && claim.status === 'not-submitted') {
    return [{ type: 'submit-claim' }];
  }
  if (participant.role === 'health-plan' && claim.status === 'submitted') {
    return [{ type: 'process-claim' }];
  }
  return [];
}

async function applyHealthcareAction(db, experience, action) {
  const participant = await db.collection('Participant').get(experience.participant.id);
  const timestamp = actionTimestamp(action?.type);
  if (action?.type === 'submit-authorization') {
    const authorization = authorizationRecord({
      status: 'submitted',
      decisionReason: 'Pending plan review',
      evidence: 'Provider submitted encounter and coverage context',
      updatedAt: timestamp,
    });
    const careJourney = careJourneyRecord({ status: 'authorization-submitted', updatedAt: timestamp });
    await upsertHealthcareRecord(db.collection('Authorization'), authorization);
    await upsertHealthcareRecord(db.collection('CareJourney'), careJourney);
    await recordHealthcareEvent(db, {
      id: 'healthcare-event-003',
      sequence: '003',
      actor_id: experience.participant.id,
      actor_role: participant?.role ?? 'provider',
      kind: 'authorization-submitted',
      entity_type: 'Authorization',
      entity_id: HEALTHCARE_IDS.authorization,
      summary: 'Provider submitted the prior authorization request.',
      created_at: timestamp,
      effect: {
        upserts: {
          Authorization: [authorization],
          CareJourney: [careJourney],
        },
      },
    });
    return { ok: true };
  }

  if (action?.type === 'review-authorization') {
    const authorization = authorizationRecord({
      status: 'under-review',
      decisionReason: 'Health plan review started',
      evidence: 'Medical necessity review in progress',
      reviewedBy: participant?.display_name ?? 'Plan Reviewer',
      updatedAt: timestamp,
    });
    const careJourney = careJourneyRecord({ status: 'authorization-review', updatedAt: timestamp });
    await upsertHealthcareRecord(db.collection('Authorization'), authorization);
    await upsertHealthcareRecord(db.collection('CareJourney'), careJourney);
    await recordHealthcareEvent(db, {
      id: 'healthcare-event-004',
      sequence: '004',
      actor_id: experience.participant.id,
      actor_role: participant?.role ?? 'health-plan',
      kind: 'authorization-reviewed',
      entity_type: 'Authorization',
      entity_id: HEALTHCARE_IDS.authorization,
      summary: 'Health plan reviewer opened the authorization request.',
      created_at: timestamp,
      effect: {
        upserts: {
          Authorization: [authorization],
          CareJourney: [careJourney],
        },
      },
    });
    return { ok: true };
  }

  if (action?.type === 'approve-authorization') {
    const authorization = authorizationRecord({
      status: 'approved',
      decisionReason: 'Covered service approved under Gold PPO.',
      evidence: 'Coverage confirmed and procedure approved',
      reviewedBy: participant?.display_name ?? 'Plan Reviewer',
      updatedAt: timestamp,
    });
    const careJourney = careJourneyRecord({ status: 'authorized', updatedAt: timestamp });
    await upsertHealthcareRecord(db.collection('Authorization'), authorization);
    await upsertHealthcareRecord(db.collection('CareJourney'), careJourney);
    await recordHealthcareEvent(db, {
      id: 'healthcare-event-005',
      sequence: '005',
      actor_id: experience.participant.id,
      actor_role: participant?.role ?? 'health-plan',
      kind: 'authorization-approved',
      entity_type: 'Authorization',
      entity_id: HEALTHCARE_IDS.authorization,
      summary: 'Health plan approved the authorization request.',
      created_at: timestamp,
      effect: {
        upserts: {
          Authorization: [authorization],
          CareJourney: [careJourney],
        },
      },
    });
    return { ok: true };
  }

  if (action?.type === 'submit-claim') {
    const claim = claimRecord({
      status: 'submitted',
      updatedAt: timestamp,
    });
    const careJourney = careJourneyRecord({ status: 'claim-submitted', updatedAt: timestamp });
    await upsertHealthcareRecord(db.collection('Claim'), claim);
    await upsertHealthcareRecord(db.collection('CareJourney'), careJourney);
    await recordHealthcareEvent(db, {
      id: 'healthcare-event-006',
      sequence: '006',
      actor_id: experience.participant.id,
      actor_role: participant?.role ?? 'provider',
      kind: 'claim-submitted',
      entity_type: 'Claim',
      entity_id: HEALTHCARE_IDS.claim,
      summary: 'Provider submitted the post-procedure claim.',
      created_at: timestamp,
      effect: {
        upserts: {
          Claim: [claim],
          CareJourney: [careJourney],
        },
      },
    });
    return { ok: true };
  }

  if (action?.type === 'process-claim') {
    const claim = claimRecord({
      status: 'processed',
      updatedAt: timestamp,
    });
    const careJourney = careJourneyRecord({ status: 'claim-processed', updatedAt: timestamp });
    await upsertHealthcareRecord(db.collection('Claim'), claim);
    await upsertHealthcareRecord(db.collection('CareJourney'), careJourney);
    await recordHealthcareEvent(db, {
      id: 'healthcare-event-007',
      sequence: '007',
      actor_id: experience.participant.id,
      actor_role: participant?.role ?? 'health-plan',
      kind: 'claim-processed',
      entity_type: 'Claim',
      entity_id: HEALTHCARE_IDS.claim,
      summary: 'Health plan processed the submitted claim.',
      created_at: timestamp,
      effect: {
        upserts: {
          Claim: [claim],
          CareJourney: [careJourney],
        },
      },
    });
    return { ok: true };
  }

  throw new Error(`Unknown healthcare action: ${action?.type}`);
}

function projectHistoricalWorld(liveWorld, at) {
  const collections = {};
  for (const name of STATIC_COLLECTIONS) {
    collections[name] = sortCollection(name, [...(liveWorld.collections[name] ?? [])]);
  }
  for (const name of REPLAY_COLLECTIONS) {
    collections[name] = [];
  }

  const mutableMaps = Object.fromEntries(REPLAY_COLLECTIONS.map(name => [name, new Map()]));
  const events = [...(liveWorld.collections.HealthcareEvent ?? [])]
    .filter(event => Date.parse(event.created_at) <= at)
    .sort(compareEvents);

  for (const event of events) {
    const effect = JSON.parse(event.effect_json ?? '{}');
    for (const [collectionName, records] of Object.entries(effect.upserts ?? {})) {
      const map = mutableMaps[collectionName];
      if (!map) continue;
      for (const record of records) {
        map.set(record.id, record);
      }
    }
    for (const [collectionName, ids] of Object.entries(effect.deletes ?? {})) {
      const map = mutableMaps[collectionName];
      if (!map) continue;
      for (const id of ids) {
        map.delete(id);
      }
    }
  }

  for (const name of REPLAY_COLLECTIONS) {
    collections[name] = sortCollection(name, [...mutableMaps[name].values()]);
  }
  collections.HealthcareEvent = events;
  return { collections };
}

function coverageRecord({ id = HEALTHCARE_IDS.coverage, member = HEALTHCARE_IDS.member, status = 'active', updatedAt = TIMELINE.coverageChecked } = {}) {
  return {
    id,
    member,
    benefit_plan: HEALTHCARE_IDS.benefitPlan,
    health_plan: HEALTHCARE_IDS.healthPlan,
    status,
    service: 'Outpatient knee procedure',
    deductible_remaining: member === HEALTHCARE_IDS.member ? '$500' : '$0',
    estimated_member_responsibility: member === HEALTHCARE_IDS.member ? '$250' : '$0',
    updated_at: updatedAt,
  };
}

function encounterRecord({ status = 'documented', updatedAt = TIMELINE.encounterCreated } = {}) {
  return {
    id: HEALTHCARE_IDS.encounter,
    member: HEALTHCARE_IDS.member,
    provider: HEALTHCARE_IDS.provider,
    service: 'Outpatient knee procedure',
    status,
    clinical_summary: 'MRI-confirmed knee injury requiring outpatient repair.',
    updated_at: updatedAt,
  };
}

function authorizationRecord({
  status = 'draft',
  decisionReason = 'Awaiting submission',
  evidence = 'Clinical notes collected',
  reviewedBy,
  updatedAt = TIMELINE.encounterCreated,
} = {}) {
  return {
    id: HEALTHCARE_IDS.authorization,
    member: HEALTHCARE_IDS.member,
    provider: HEALTHCARE_IDS.provider,
    health_plan: HEALTHCARE_IDS.healthPlan,
    encounter: HEALTHCARE_IDS.encounter,
    requested_service: 'Outpatient knee procedure',
    status,
    decision_reason: decisionReason,
    evidence,
    reviewed_by: reviewedBy,
    updated_at: updatedAt,
  };
}

function claimRecord({ status = 'not-submitted', updatedAt = TIMELINE.encounterCreated } = {}) {
  return {
    id: HEALTHCARE_IDS.claim,
    member: HEALTHCARE_IDS.member,
    provider: HEALTHCARE_IDS.provider,
    health_plan: HEALTHCARE_IDS.healthPlan,
    encounter: HEALTHCARE_IDS.encounter,
    status,
    amount: '$1,800',
    member_responsibility: '$250',
    updated_at: updatedAt,
  };
}

function careJourneyRecord({ status = 'encounter-created', updatedAt = TIMELINE.encounterCreated } = {}) {
  return {
    id: HEALTHCARE_IDS.careJourney,
    member: HEALTHCARE_IDS.member,
    encounter: HEALTHCARE_IDS.encounter,
    authorization: HEALTHCARE_IDS.authorization,
    claim: HEALTHCARE_IDS.claim,
    status,
    updated_at: updatedAt,
  };
}

async function recordHealthcareEvent(db, event) {
  const collection = db.collection('HealthcareEvent');
  const existing = await collection.get(event.id);
  const record = {
    id: event.id,
    sequence: event.sequence,
    actor_id: event.actor_id,
    actor_role: event.actor_role,
    kind: event.kind,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    summary: event.summary,
    effect_json: JSON.stringify(event.effect),
    created_at: event.created_at,
  };
  if (existing) {
    await collection.update(event.id, record);
  } else {
    await collection.insert(record, event.id);
  }
}

async function insertIfMissing(collection, id, value) {
  const existing = await collection.get(id);
  if (!existing) {
    await collection.insert(value, id);
  }
}

async function upsertHealthcareRecord(collection, value) {
  const existing = await collection.get(value.id);
  if (existing) {
    await collection.update(value.id, value);
  } else {
    await collection.insert(value, value.id);
  }
}

function findParticipant(snapshot) {
  return (snapshot.world.collections.Participant ?? []).find(item => item.id === snapshot.participant.id);
}

function defaultFocusForRole(role) {
  return {
    member: 'authorization',
    provider: 'encounter',
    'health-plan': 'coverage',
    employer: 'plan',
    developer: 'workflow',
  }[role] ?? 'reality';
}

function actionTimestamp(type) {
  return {
    'submit-authorization': TIMELINE.authorizationSubmitted,
    'review-authorization': TIMELINE.authorizationReviewed,
    'approve-authorization': TIMELINE.authorizationApproved,
    'submit-claim': TIMELINE.claimSubmitted,
    'process-claim': TIMELINE.claimProcessed,
  }[type] ?? new Date().toISOString();
}

function experiencesToSnapshots(experiences) {
  return Object.values(experiences).map(experience => experience.snapshot());
}

function renderPanels(snapshots) {
  const panels = snapshots.map(renderHealthcareExperiencePanel);
  const height = Math.max(...panels.map(panel => panel.length));
  return Array.from({ length: height }, (_, index) => panels.map(panel => panel[index] ?? ' '.repeat(panel[0].length)).join('  ')).join('\n');
}

function renderBox(title, lines, width = 48) {
  const header = ` ${title} `;
  const top = `┌${header.padEnd(width - 2, '─')}┐`;
  const body = lines.map(line => `│ ${String(line).slice(0, width - 4).padEnd(width - 4)} │`);
  return [top, ...body, `└${'─'.repeat(width - 2)}┘`];
}

function first(values) {
  return values?.[0];
}

function indexById(values) {
  return Object.fromEntries(values.map(value => [value.id, value]));
}

function compareEvents(left, right) {
  return Date.parse(left.created_at) - Date.parse(right.created_at)
    || String(left.sequence).localeCompare(String(right.sequence));
}

function sortCollection(name, values) {
  if (name === 'HealthcareEvent') return values.sort(compareEvents);
  return values.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function formatMode(mode) {
  if (mode?.kind === 'replay') return `REPLAY @ ${formatClock(mode.at)}`;
  return 'LIVE';
}

function formatClock(value) {
  return new Date(value).toISOString().slice(11, 16);
}

function humanize(value) {
  return value.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, char => char.toUpperCase());
}

function logStep(title, description) {
  console.log(`\n${title}`);
  console.log(description);
}

export function waitForAuthorizationStatus(experience, status) {
  return new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = experience.observe(snapshot => {
      const authorization = first(snapshot.world.collections.Authorization);
      if (authorization?.status === status) {
        unsubscribe();
        resolve(snapshot);
      }
    });
  });
}

export function waitForClaimStatus(experience, status) {
  return new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = experience.observe(snapshot => {
      const claim = first(snapshot.world.collections.Claim);
      if (claim?.status === status) {
        unsubscribe();
        resolve(snapshot);
      }
    });
  });
}

export function makeHealthcareEventId() {
  return `healthcare-event-${randomUUID()}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runHealthcareDemo().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
