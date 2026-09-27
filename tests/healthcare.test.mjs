import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ReplayReadOnlyError,
  UnauthorizedPerspectiveError,
} from '../src/index.js';
import {
  HEALTHCARE_PARTICIPANTS,
  TIMELINE,
  createHealthcareDemoRuntime,
  enterHealthcareParticipants,
  focusHealthcareParticipants,
  projectHealthcareExperience,
  refreshHealthcareParticipants,
  replayHealthcareSnapshots,
  seedHealthcareJourneys,
  seedHealthcareWorld,
  spawnHealthcareParticipants,
  waitForAuthorizationStatus,
  waitForClaimStatus,
} from '../examples/reality-runtime-healthcare/demo.mjs';

async function makeHealthcareRuntime(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));
  const dataPath = path.join(root, 'db');
  const runtime = await createHealthcareDemoRuntime({
    dataPath,
    namespace: `healthcare-${label}`,
  });
  return { root, dataPath, runtime };
}

async function seedHealthcare(label) {
  const context = await makeHealthcareRuntime(label);
  await seedHealthcareWorld(context.runtime);
  const journeys = await seedHealthcareJourneys(context.runtime);
  const experiences = await spawnHealthcareParticipants(context.runtime, journeys);
  await focusHealthcareParticipants(experiences);
  return { ...context, journeys, experiences };
}

test('five healthcare participants inhabit one durable reality with different journeys and focus', async () => {
  const { experiences } = await seedHealthcare('shared-reality');
  const projected = Object.fromEntries(
    Object.entries(experiences).map(([name, experience]) => [name, projectHealthcareExperience(experience.snapshot())]),
  );

  const realities = new Set(Object.values(experiences).map(experience => experience.reality.application));
  assert.equal(realities.size, 1);
  assert.equal(projected.member.focus, 'authorization');
  assert.equal(projected.provider.focus, 'encounter');
  assert.equal(projected.healthPlan.focus, 'coverage');
  assert.equal(projected.employer.focus, 'plan');
  assert.equal(projected.developer.focus, 'workflow');
  assert.notEqual(projected.member.journey, projected.provider.journey);
  assert.notEqual(projected.provider.journey, projected.healthPlan.journey);
});

test('provider authorization submission propagates across shared healthcare experiences', async () => {
  const { experiences } = await seedHealthcare('observe-authorization');

  const memberSawSubmission = waitForAuthorizationStatus(experiences.member, 'submitted');
  const planSawSubmission = waitForAuthorizationStatus(experiences.healthPlan, 'submitted');
  const developerSawSubmission = waitForAuthorizationStatus(experiences.developer, 'submitted');
  await experiences.provider.act({ type: 'submit-authorization' });
  await Promise.all([memberSawSubmission, planSawSubmission, developerSawSubmission]);
  await refreshHealthcareParticipants(experiences);

  const memberView = projectHealthcareExperience(experiences.member.snapshot());
  const planView = projectHealthcareExperience(experiences.healthPlan.snapshot());
  const employerView = projectHealthcareExperience(experiences.employer.snapshot());
  const developerView = projectHealthcareExperience(experiences.developer.snapshot());

  assert.equal(memberView.view.authorizationStatus, 'submitted');
  assert.equal(planView.view.authorizationStatus, 'submitted');
  assert.equal(employerView.view.pendingAuthorizations, 1);
  assert.ok(developerView.timeline.some(item => item.toLowerCase().includes('request')));
});

test('plan approval updates member/provider and employer remains aggregate-only in the demo projection', async () => {
  const { experiences } = await seedHealthcare('approval-boundary');
  const memberSawApproval = waitForAuthorizationStatus(experiences.member, 'approved');
  const providerSawApproval = waitForAuthorizationStatus(experiences.provider, 'approved');
  await experiences.provider.act({ type: 'submit-authorization' });
  await experiences.healthPlan.act({ type: 'review-authorization' });
  await experiences.healthPlan.act({ type: 'approve-authorization' });
  await Promise.all([memberSawApproval, providerSawApproval]);
  await refreshHealthcareParticipants(experiences);

  const memberView = projectHealthcareExperience(experiences.member.snapshot());
  const providerView = projectHealthcareExperience(experiences.provider.snapshot());
  const planView = projectHealthcareExperience(experiences.healthPlan.snapshot());
  const employerView = projectHealthcareExperience(experiences.employer.snapshot());

  assert.equal(memberView.view.authorizationStatus, 'approved');
  assert.equal(providerView.view.authorizationStatus, 'approved');
  assert.equal(planView.view.authorizationStatus, 'approved');
  assert.ok(providerView.view.clinicalSummary.includes('knee injury'));
  assert.ok(!('clinicalSummary' in employerView.view));
  assert.ok(!('memberName' in employerView.view));
  assert.ok(!('clinicalSummary' in planView.view));
  assert.ok(!JSON.stringify(providerView).includes('Bob Example'));
});

test('replay reconstructs historical experiences by participant and remains read-only', async () => {
  const { experiences } = await seedHealthcare('replay');
  await experiences.provider.act({ type: 'submit-authorization' });
  await experiences.healthPlan.act({ type: 'review-authorization' });
  await experiences.healthPlan.act({ type: 'approve-authorization' });
  await experiences.provider.act({ type: 'submit-claim' });

  const replaySnapshots = await replayHealthcareSnapshots(experiences, TIMELINE.authorizationSubmitted);
  const projected = replaySnapshots.map(snapshot => projectHealthcareExperience(snapshot));
  const memberReplay = projected.find(view => view.role === 'member');
  const providerReplay = projected.find(view => view.role === 'provider');
  const employerReplay = projected.find(view => view.role === 'employer');
  const developerReplay = projected.find(view => view.role === 'developer');

  assert.equal(memberReplay.mode, 'REPLAY @ 10:04');
  assert.equal(memberReplay.view.authorizationStatus, 'submitted');
  assert.equal(providerReplay.view.authorizationStatus, 'submitted');
  assert.equal(employerReplay.view.pendingAuthorizations, 1);
  assert.ok(developerReplay.timeline.some(item => item.includes('10:04')));

  const replayMember = await experiences.member.replay(TIMELINE.authorizationSubmitted);
  await assert.rejects(
    replayMember.act({ type: 'submit-claim' }),
    error => error instanceof ReplayReadOnlyError,
  );
});

test('restart reconstructs all healthcare journeys and allows a current live action after replay', async () => {
  const { dataPath, journeys, experiences } = await seedHealthcare('restart');
  await experiences.provider.act({ type: 'submit-authorization' });
  await experiences.healthPlan.act({ type: 'review-authorization' });
  await experiences.healthPlan.act({ type: 'approve-authorization' });
  for (const experience of Object.values(experiences)) {
    await experience.leave();
  }

  const restarted = await createHealthcareDemoRuntime({
    dataPath,
    namespace: 'healthcare-restart',
  });
  const resumed = await enterHealthcareParticipants(restarted, journeys);
  await focusHealthcareParticipants(resumed);

  const resumedMemberView = projectHealthcareExperience(resumed.member.snapshot());
  assert.equal(resumedMemberView.view.authorizationStatus, 'approved');
  assert.equal(resumed.member.journey.id, journeys.member.id);
  assert.equal(resumed.provider.journey.id, journeys.provider.id);
  assert.equal(resumed.healthPlan.journey.id, journeys.healthPlan.id);
  assert.equal(resumed.employer.journey.id, journeys.employer.id);
  assert.equal(resumed.developer.journey.id, journeys.developer.id);

  const memberSawClaim = waitForClaimStatus(resumed.member, 'submitted');
  const planSawClaim = waitForClaimStatus(resumed.healthPlan, 'submitted');
  await resumed.provider.act({ type: 'submit-claim' });
  await Promise.all([memberSawClaim, planSawClaim]);
  await refreshHealthcareParticipants(resumed);

  const memberClaimView = projectHealthcareExperience(resumed.member.snapshot());
  const employerClaimView = projectHealthcareExperience(resumed.employer.snapshot());
  assert.equal(memberClaimView.view.claimStatus, 'submitted');
  assert.equal(employerClaimView.view.submittedClaims, 1);
});

test('perspective remains self-only and developer stays in the synthetic healthcare reality', async () => {
  const { experiences } = await seedHealthcare('perspective');

  await assert.rejects(
    experiences.member.viewAs(HEALTHCARE_PARTICIPANTS.provider),
    error => error instanceof UnauthorizedPerspectiveError,
  );

  const developerView = projectHealthcareExperience(experiences.developer.snapshot());
  assert.equal(developerView.view.environment, 'demo/test only');
  assert.equal(experiences.developer.reality.application, 'HealthcareDemoReality');
});
