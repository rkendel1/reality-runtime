import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createFeltDB, parseFlowSpec } from '@feltdb/core';

const DEFAULT_FLOW_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'feltdb.flow');
const RUNTIME_COLLECTIONS = new Set(['Journey', 'Presence']);
const PARTICIPANT_KINDS = new Set(['person', 'agent', 'device', 'organization']);
const JOURNEY_STATUSES = new Set(['active', 'paused', 'completed', 'abandoned']);

export class RealityRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class RealityNotFoundError extends RealityRuntimeError {
  constructor(message = 'Reality could not be resolved from the configured FeltDB application state.') {
    super('RealityNotFound', message);
  }
}

export class JourneyNotFoundError extends RealityRuntimeError {
  constructor(journeyId) {
    super('JourneyNotFound', `Journey not found: ${journeyId}`);
  }
}

export class ParticipantNotFoundError extends RealityRuntimeError {
  constructor(participantId) {
    super('ParticipantNotFound', `Participant not found: ${participantId}`);
  }
}

export class UnauthorizedPerspectiveError extends RealityRuntimeError {
  constructor(message = 'Cross-participant viewAs requires a principal-scoped FeltDB authority API that is not exposed by the embedded public @feltdb/core runtime.') {
    super('UnauthorizedPerspective', message);
  }
}

export class UnauthorizedActionError extends RealityRuntimeError {
  constructor(actionName) {
    super('UnauthorizedAction', actionName ? `Action not authorized: ${actionName}` : 'Action not authorized.');
  }
}

export class PresenceNotFoundError extends RealityRuntimeError {
  constructor(message = 'Presence not found.') {
    super('PresenceNotFound', message);
  }
}

export class InvalidJourneyStateError extends RealityRuntimeError {
  constructor(status) {
    super('InvalidJourneyState', `Invalid journey state: ${status}`);
  }
}

export class InvalidPerspectiveError extends RealityRuntimeError {
  constructor(message) {
    super('InvalidPerspective', message);
  }
}

export async function createRealityRuntime(options = {}) {
  const db = options.db ?? createFeltDB({
    namespace: options.namespace ?? 'reality-runtime',
    path: options.path ?? path.resolve(process.cwd(), '.feltdb'),
  });
  const flowSource = options.flowSource ?? await fs.readFile(options.flowPath ?? DEFAULT_FLOW_PATH, 'utf8');
  const flowSpec = typeof flowSource === 'string' ? parseFlowSpec(flowSource) : flowSource;
  await db.deployFlowSpec(flowSpec);
  return new RealityRuntime({
    db,
    flowSpec,
    projectionCollections: options.projectionCollections ?? flowSpec.collections.map(({ name }) => name).filter(name => !RUNTIME_COLLECTIONS.has(name)),
    listActions: options.listActions,
    act: options.act,
  });
}

export class RealityRuntime {
  constructor({ db, flowSpec, projectionCollections, listActions, act }) {
    this.db = db;
    this.flowSpec = flowSpec;
    this.participants = db.collection('Participant');
    this.journeys = db.collection('Journey');
    this.presences = db.collection('Presence');
    this.projectionCollections = [...new Set(projectionCollections)];
    this.listActions = listActions ?? (() => []);
    this.actHandler = act;
  }

  async resolveReality() {
    const application = await this.db.application.get().catch(() => null);
    const flowRevision = application?.version === undefined ? undefined : String(application.version);
    const appName = application?.application_id ?? this.flowSpec?.app;
    if (!appName) throw new RealityNotFoundError();
    return {
      application: appName,
      environment: application?.environment,
      flowRevision,
    };
  }

  async createJourney({ id = makeId('journey'), subject, goal, status = 'active', completedAt, startedAt = new Date().toISOString() }) {
    const participant = normalizeParticipant(subject);
    const reality = await this.resolveReality();
    await this.ensureParticipant({ participant, reality });
    const journey = {
      id,
      subject_id: participant.id,
      subject_kind: participant.kind,
      goal,
      status: normalizeJourneyStatus(status),
      started_at: startedAt,
      completed_at: completedAt,
      reality_application: reality.application,
      reality_environment: reality.environment,
      reality_flow_revision: reality.flowRevision,
    };
    await this.journeys.insert(journey, id);
    return toJourney(journey);
  }

  async ensureParticipant({ participant, displayName, role, reality } = {}) {
    const normalizedParticipant = normalizeParticipant(participant);
    const existing = await this.participants.get(normalizedParticipant.id);
    if (existing) {
      return toParticipant(existing);
    }
    const resolvedDisplayName = displayName ?? participant?.displayName;
    const resolvedRole = role ?? participant?.role;
    const resolvedReality = reality ?? await this.resolveReality();
    const record = {
      id: normalizedParticipant.id,
      kind: normalizedParticipant.kind,
      display_name: resolvedDisplayName,
      role: resolvedRole,
      created_at: new Date().toISOString(),
      reality_application: resolvedReality.application,
      reality_environment: resolvedReality.environment,
      reality_flow_revision: resolvedReality.flowRevision,
    };
    await this.participants.insert(record, record.id);
    return toParticipant(record);
  }

  async getParticipant(participantId) {
    const participant = await this.participants.get(participantId);
    if (!participant) throw new ParticipantNotFoundError(participantId);
    return toParticipant(participant);
  }

  async getJourney(journeyId) {
    const journey = await this.journeys.get(journeyId);
    if (!journey) throw new JourneyNotFoundError(journeyId);
    return journey;
  }

  async spawn({ participant, reality, journey, journeyId }) {
    const normalizedParticipant = normalizeParticipant(participant);
    const resolvedJourney = await this.#resolveJourney(journey ?? journeyId);
    if (resolvedJourney && reality && !sameReality(journeyReality(resolvedJourney), reality)) {
      throw new InvalidPerspectiveError('spawn() received both journey and reality, but they refer to different realities.');
    }
    const resolvedReality = resolvedJourney ? journeyReality(resolvedJourney) : await this.#resolveRealityOverride(reality);
    await this.ensureParticipant({ participant: normalizedParticipant, reality: resolvedReality });
    const presenceRecord = {
      id: makeId('presence'),
      participant_id: normalizedParticipant.id,
      participant_kind: normalizedParticipant.kind,
      journey_id: resolvedJourney?.id,
      reality_application: resolvedReality.application,
      reality_environment: resolvedReality.environment,
      reality_flow_revision: resolvedReality.flowRevision,
      entered_at: new Date().toISOString(),
      exited_at: undefined,
    };
    await this.presences.insert(presenceRecord, presenceRecord.id);
    return this.#instantiateExperience({
      participant: normalizedParticipant,
      presence: presenceRecord,
      perspective: {
        participant: normalizedParticipant,
        journeyId: resolvedJourney?.id,
        at: Date.now(),
      },
      reality: resolvedReality,
      journey: resolvedJourney ? toJourney(resolvedJourney) : undefined,
      focus: undefined,
    });
  }

  async enter({ participant, journeyId }) {
    const normalizedParticipant = normalizeParticipant(participant);
    if (!normalizedParticipant.id) throw new ParticipantNotFoundError(String(normalizedParticipant.id));
    const prior = await this.presences.find({
      participant_id: normalizedParticipant.id,
      ...(journeyId ? { journey_id: journeyId } : {}),
    });
    if (!prior.length) {
      throw new PresenceNotFoundError(
        journeyId
          ? `No durable Presence history exists for participant ${normalizedParticipant.id} in journey ${journeyId}.`
          : `No durable Presence history exists for participant ${normalizedParticipant.id}.`,
      );
    }
    const realities = new Set(prior.map(realityKey));
    if (!journeyId && realities.size > 1) {
      throw new InvalidPerspectiveError(`Participant ${normalizedParticipant.id} has Presence history in multiple realities; enter() requires a journeyId to disambiguate.`);
    }
    const selected = prior
      .slice()
      .sort((left, right) => Date.parse(right.entered_at) - Date.parse(left.entered_at))[0];
    return this.spawn({
      participant: normalizedParticipant,
      journeyId: journeyId ?? selected.journey_id ?? undefined,
      reality: {
        application: selected.reality_application,
        environment: selected.reality_environment,
        flowRevision: selected.reality_flow_revision,
      },
    });
  }

  async leave({ presenceId }) {
    const presence = await this.presences.get(presenceId);
    if (!presence) throw new PresenceNotFoundError(`Presence not found: ${presenceId}`);
    const exitedAt = presence.exited_at ?? new Date().toISOString();
    if (!presence.exited_at) {
      await this.presences.update(presenceId, { exited_at: exitedAt });
    }
    return toPresence({ ...presence, exited_at: exitedAt });
  }

  async materializeWorld() {
    const collections = {};
    for (const name of this.projectionCollections) {
      collections[name] = await this.db.collection(name).all();
    }
    return { collections };
  }

  observe(experience, callback, { onError } = {}) {
    const collectionNames = new Set(['Journey', 'Presence', ...this.projectionCollections]);
    let closed = false;
    let running = false;
    let rerun = false;
    const unsubs = [];
    const publish = async () => {
      if (closed) return;
      if (running) {
        rerun = true;
        return;
      }
      running = true;
      let error;
      try {
        do {
          rerun = false;
          await experience.refresh();
          await callback(experience.snapshot());
        } while (rerun && !closed);
      } catch (caught) {
        error = caught;
      } finally {
        running = false;
      }
      if (error) {
        closed = true;
        for (const unsub of unsubs) unsub();
        if (typeof onError === 'function') {
          await onError(error);
        } else {
          console.error('Experience.observe() stopped after an observer failure.', error);
        }
      }
    };
    unsubs.push(...[...collectionNames].map(name => this.db.collection(name).subscribe(() => {
      void publish();
    })));
    void publish();
    return () => {
      closed = true;
      for (const unsub of unsubs) unsub();
    };
  }

  async executeAction(experience, action) {
    if (!this.actHandler) {
      throw new UnauthorizedActionError(action?.type ?? action?.name);
    }
    return this.actHandler({ db: this.db, experience, action });
  }

  async #instantiateExperience(state) {
    const experience = new Experience(this, state);
    await experience.refresh();
    return experience;
  }

  async cloneExperience(experience) {
    return this.#instantiateExperience({
      participant: experience.participant,
      presence: {
        id: experience.presence.id,
        participant_id: experience.presence.participant.id,
        participant_kind: experience.presence.participant.kind,
        journey_id: experience.presence.journeyId,
        reality_application: experience.reality.application,
        reality_environment: experience.reality.environment,
        reality_flow_revision: experience.reality.flowRevision,
        entered_at: new Date(experience.presence.enteredAt).toISOString(),
        exited_at: experience.presence.exitedAt ? new Date(experience.presence.exitedAt).toISOString() : undefined,
      },
      perspective: {
        ...experience.perspective,
        at: Date.now(),
      },
      reality: experience.reality,
      journey: experience.journey,
      focus: experience.focusState,
    });
  }

  async #resolveJourney(input) {
    if (!input) return undefined;
    if (typeof input === 'string') return this.getJourney(input);
    if (typeof input === 'object' && input.id) {
      const journey = await this.journeys.get(input.id);
      if (!journey) throw new JourneyNotFoundError(input.id);
      return journey;
    }
    throw new JourneyNotFoundError(String(input));
  }

  async #resolveRealityOverride(reality) {
    if (!reality) return this.resolveReality();
    const resolved = await this.resolveReality();
    return {
      application: reality.application ?? resolved.application,
      environment: reality.environment ?? resolved.environment,
      flowRevision: reality.flowRevision ?? resolved.flowRevision,
    };
  }
}

export class Experience {
  constructor(runtime, { participant, presence, perspective, reality, journey, focus }) {
    this.runtime = runtime;
    this.participant = participant;
    this.presence = toPresence(presence);
    this.perspective = perspective;
    this.reality = reality;
    this.journey = journey;
    this.focusState = focus;
    this.world = { collections: {} };
    this.availableActions = [];
  }

  snapshot() {
    return {
      reality: this.reality,
      participant: this.participant,
      journey: this.journey,
      presence: this.presence,
      perspective: this.perspective,
      world: this.world,
      focus: this.focusState,
      availableActions: this.availableActions,
    };
  }

  async refresh() {
    this.world = await this.runtime.materializeWorld(this);
    this.availableActions = await Promise.resolve(this.runtime.listActions(this.snapshot()));
    return this;
  }

  async viewAs(participant) {
    const target = normalizeParticipant(participant);
    if (!sameParticipant(this.participant, target)) {
      // Safe semantics only: the embedded public runtime does not expose a
      // principal-scoped delegated read surface, so refusing here prevents a
      // confused-deputy escalation through "view as" sugar.
      throw new UnauthorizedPerspectiveError();
    }
    return this.viewAsSelf();
  }

  async viewAsSelf() {
    return this.runtime.cloneExperience(this);
  }

  async focus(target) {
    this.focusState = target
      ? {
          target,
          at: Date.now(),
        }
      : undefined;
    await this.refresh();
    return this.snapshot();
  }

  observe(callback, options) {
    return this.runtime.observe(this, callback, options);
  }

  async act(action) {
    const result = await this.runtime.executeAction(this, action);
    await this.refresh();
    return result;
  }

  async leave() {
    this.presence = await this.runtime.leave({ presenceId: this.presence.id });
    return this.presence;
  }
}

export function normalizeParticipant(participant) {
  if (!participant || typeof participant !== 'object') {
    throw new InvalidPerspectiveError('Participant must be an object with kind and id.');
  }
  if (!PARTICIPANT_KINDS.has(participant.kind)) {
    throw new InvalidPerspectiveError(`Unsupported participant kind: ${participant.kind}`);
  }
  if (!participant.id || typeof participant.id !== 'string') {
    throw new ParticipantNotFoundError(String(participant?.id));
  }
  return { kind: participant.kind, id: participant.id };
}

function normalizeJourneyStatus(status) {
  if (!JOURNEY_STATUSES.has(status)) throw new InvalidJourneyStateError(status);
  return status;
}

function journeyReality(journey) {
  return {
    application: journey.reality_application,
    environment: journey.reality_environment,
    flowRevision: journey.reality_flow_revision,
  };
}

function toJourney(journey) {
  return {
    id: journey.id,
    subject: { kind: journey.subject_kind, id: journey.subject_id },
    goal: journey.goal,
    status: journey.status,
    startedAt: Date.parse(journey.started_at),
    completedAt: journey.completed_at ? Date.parse(journey.completed_at) : undefined,
    reality: journeyReality(journey),
  };
}

function toPresence(presence) {
  return {
    id: presence.id,
    participant: { kind: presence.participant_kind, id: presence.participant_id },
    journeyId: presence.journey_id ?? undefined,
    reality: {
      application: presence.reality_application,
      environment: presence.reality_environment ?? undefined,
      flowRevision: presence.reality_flow_revision ?? undefined,
    },
    enteredAt: Date.parse(presence.entered_at),
    exitedAt: presence.exited_at ? Date.parse(presence.exited_at) : undefined,
  };
}

function toParticipant(participant) {
  return {
    id: participant.id,
    kind: participant.kind,
    displayName: participant.display_name ?? undefined,
    role: participant.role ?? undefined,
    createdAt: Date.parse(participant.created_at),
    reality: {
      application: participant.reality_application,
      environment: participant.reality_environment ?? undefined,
      flowRevision: participant.reality_flow_revision ?? undefined,
    },
  };
}

function sameParticipant(left, right) {
  return left.id === right.id && left.kind === right.kind;
}

function makeId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function sameReality(left, right) {
  return left.application === right.application
    && (left.environment ?? undefined) === (right.environment ?? undefined)
    && (left.flowRevision ?? undefined) === (right.flowRevision ?? undefined);
}

function realityKey(presence) {
  return JSON.stringify({
    application: presence.reality_application,
    environment: presence.reality_environment ?? null,
    flowRevision: presence.reality_flow_revision ?? null,
  });
}
