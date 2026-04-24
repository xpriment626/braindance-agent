import { and, eq } from 'drizzle-orm';
import { signals } from '../db/schema';
import { generateId } from '../db/id';
import type { Database } from '../db/connection';

export type SignalStatus = 'pending' | 'approved' | 'applied' | 'dismissed';
export type SignalTargetType = 'source' | 'thread';
export type SignalType =
	| 'fresh'
	| 'contested'
	| 'stale'
	| 'retracted'
	| 'gap'
	| 'consolidation';
export type SignalRaisedBy = 'audit' | 'user';

export interface Signal {
	id: string;
	topicId: string;
	targetType: SignalTargetType;
	targetId: string;
	signalType: SignalType;
	reason: string | null;
	raisedBy: SignalRaisedBy;
	status: SignalStatus;
	metadata: Record<string, unknown> | null;
	createdAt: string;
	resolvedAt: string | null;
}

export interface CreateSignalInput {
	topicId: string;
	targetType: SignalTargetType;
	targetId: string;
	signalType: SignalType;
	reason?: string;
	raisedBy: SignalRaisedBy;
	metadata?: Record<string, unknown>;
}

interface SignalRow {
	id: string;
	topicId: string;
	targetType: string;
	targetId: string;
	signalType: string;
	reason: string | null;
	raisedBy: string;
	status: string;
	metadata: string | null;
	createdAt: string;
	resolvedAt: string | null;
}

function fromRow(row: SignalRow): Signal {
	return {
		id: row.id,
		topicId: row.topicId,
		targetType: row.targetType as SignalTargetType,
		targetId: row.targetId,
		signalType: row.signalType as SignalType,
		reason: row.reason,
		raisedBy: row.raisedBy as SignalRaisedBy,
		status: row.status as SignalStatus,
		metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
		createdAt: row.createdAt,
		resolvedAt: row.resolvedAt
	};
}

export async function createSignal(db: Database, input: CreateSignalInput): Promise<Signal> {
	const row: SignalRow = {
		id: generateId(),
		topicId: input.topicId,
		targetType: input.targetType,
		targetId: input.targetId,
		signalType: input.signalType,
		reason: input.reason ?? null,
		raisedBy: input.raisedBy,
		status: 'pending',
		metadata: input.metadata ? JSON.stringify(input.metadata) : null,
		createdAt: new Date().toISOString(),
		resolvedAt: null
	};
	await db.insert(signals).values(row);
	return fromRow(row);
}

export async function getSignal(db: Database, id: string): Promise<Signal | null> {
	const results = (await db.select().from(signals).where(eq(signals.id, id))) as SignalRow[];
	return results[0] ? fromRow(results[0]) : null;
}

export async function listSignalsByTopic(
	db: Database,
	topicId: string,
	status?: SignalStatus
): Promise<Signal[]> {
	const where = status
		? and(eq(signals.topicId, topicId), eq(signals.status, status))
		: eq(signals.topicId, topicId);
	const rows = (await db.select().from(signals).where(where)) as SignalRow[];
	return rows.map(fromRow);
}

export async function listApprovedSignals(db: Database, topicId: string): Promise<Signal[]> {
	return listSignalsByTopic(db, topicId, 'approved');
}

async function requireSignalWithStatus(
	db: Database,
	id: string,
	requiredStatus: SignalStatus
): Promise<Signal> {
	const existing = await getSignal(db, id);
	if (!existing) throw new Error(`signal "${id}" not found`);
	if (existing.status !== requiredStatus) {
		throw new Error(
			`signal "${id}" is ${existing.status}, expected ${requiredStatus}`
		);
	}
	return existing;
}

export async function approveSignal(db: Database, id: string): Promise<Signal> {
	await requireSignalWithStatus(db, id, 'pending');
	const resolvedAt = new Date().toISOString();
	await db
		.update(signals)
		.set({ status: 'approved', resolvedAt })
		.where(eq(signals.id, id));
	const updated = await getSignal(db, id);
	if (!updated) throw new Error(`signal "${id}" vanished after approve`);
	return updated;
}

export async function dismissSignal(
	db: Database,
	id: string,
	reason: string
): Promise<Signal> {
	await requireSignalWithStatus(db, id, 'pending');
	const resolvedAt = new Date().toISOString();
	await db
		.update(signals)
		.set({ status: 'dismissed', reason, resolvedAt })
		.where(eq(signals.id, id));
	const updated = await getSignal(db, id);
	if (!updated) throw new Error(`signal "${id}" vanished after dismiss`);
	return updated;
}

export async function applySignal(db: Database, id: string): Promise<Signal> {
	await requireSignalWithStatus(db, id, 'approved');
	await db.update(signals).set({ status: 'applied' }).where(eq(signals.id, id));
	const updated = await getSignal(db, id);
	if (!updated) throw new Error(`signal "${id}" vanished after apply`);
	return updated;
}
