import { eq } from 'drizzle-orm';
import { discoveryReports } from '../db/schema';
import { generateId } from '../db/id';
import type { Database } from '../db/connection';

export type DiscoveryReportStatus = 'pending' | 'reviewed' | 'dismissed';

export interface DiscoveredSourceProposal {
	url?: string;
	title: string;
	content?: string;
	relevanceRationale?: string;
	confidence?: number;
	threadAssociations?: string[];
	scope?: 'on_thread' | 'adjacent';
	channel?: string;
}

export interface DiscoveryReport {
	id: string;
	topicId: string;
	workflowRunId: string;
	status: DiscoveryReportStatus;
	summary: string | null;
	newSources: DiscoveredSourceProposal[];
	auditFindings: Record<string, unknown>;
	createdAt: string;
	reviewedAt: string | null;
}

export interface CreateDiscoveryReportInput {
	topicId: string;
	workflowRunId: string;
	summary: string | null;
	newSources: DiscoveredSourceProposal[];
	auditFindings: Record<string, unknown>;
}

interface DiscoveryReportRow {
	id: string;
	topicId: string;
	workflowRunId: string;
	status: string;
	summary: string | null;
	newSources: string | null;
	auditFindings: string | null;
	createdAt: string;
	reviewedAt: string | null;
}

function fromRow(row: DiscoveryReportRow): DiscoveryReport {
	return {
		id: row.id,
		topicId: row.topicId,
		workflowRunId: row.workflowRunId,
		status: row.status as DiscoveryReportStatus,
		summary: row.summary,
		newSources: row.newSources
			? (JSON.parse(row.newSources) as DiscoveredSourceProposal[])
			: [],
		auditFindings: row.auditFindings
			? (JSON.parse(row.auditFindings) as Record<string, unknown>)
			: {},
		createdAt: row.createdAt,
		reviewedAt: row.reviewedAt
	};
}

export async function createDiscoveryReport(
	db: Database,
	input: CreateDiscoveryReportInput
): Promise<DiscoveryReport> {
	const row: DiscoveryReportRow = {
		id: generateId(),
		topicId: input.topicId,
		workflowRunId: input.workflowRunId,
		status: 'pending',
		summary: input.summary,
		newSources: JSON.stringify(input.newSources),
		auditFindings: JSON.stringify(input.auditFindings),
		createdAt: new Date().toISOString(),
		reviewedAt: null
	};
	await db.insert(discoveryReports).values(row);
	return fromRow(row);
}

export async function getDiscoveryReport(
	db: Database,
	id: string
): Promise<DiscoveryReport | null> {
	const results = (await db
		.select()
		.from(discoveryReports)
		.where(eq(discoveryReports.id, id))) as DiscoveryReportRow[];
	return results[0] ? fromRow(results[0]) : null;
}

export async function listDiscoveryReportsByTopic(
	db: Database,
	topicId: string
): Promise<DiscoveryReport[]> {
	const rows = (await db
		.select()
		.from(discoveryReports)
		.where(eq(discoveryReports.topicId, topicId))) as DiscoveryReportRow[];
	return rows.map(fromRow);
}

async function requirePendingReport(db: Database, id: string): Promise<DiscoveryReport> {
	const existing = await getDiscoveryReport(db, id);
	if (!existing) throw new Error(`discovery_report "${id}" not found`);
	if (existing.status !== 'pending') {
		throw new Error(
			`discovery_report "${id}" is ${existing.status}, expected pending`
		);
	}
	return existing;
}

export async function reviewDiscoveryReport(
	db: Database,
	id: string
): Promise<DiscoveryReport> {
	await requirePendingReport(db, id);
	const reviewedAt = new Date().toISOString();
	await db
		.update(discoveryReports)
		.set({ status: 'reviewed', reviewedAt })
		.where(eq(discoveryReports.id, id));
	const updated = await getDiscoveryReport(db, id);
	if (!updated) throw new Error(`discovery_report "${id}" vanished after review`);
	return updated;
}

export async function dismissDiscoveryReport(
	db: Database,
	id: string
): Promise<DiscoveryReport> {
	await requirePendingReport(db, id);
	const reviewedAt = new Date().toISOString();
	await db
		.update(discoveryReports)
		.set({ status: 'dismissed', reviewedAt })
		.where(eq(discoveryReports.id, id));
	const updated = await getDiscoveryReport(db, id);
	if (!updated) throw new Error(`discovery_report "${id}" vanished after dismiss`);
	return updated;
}
