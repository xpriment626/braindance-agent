// Agent I/O type contracts. Types only — consumers verify shape via compilation.

// ─── Shared ──────────────────────────────────────────────

export interface TopicContext {
	id: string;
	name: string;
	description: string | null;
	guidance: string | null;
	narrativeThreads: string[] | null;
}

export interface CorpusSource {
	id: string;
	title: string;
	type: string;
	content: string | null;
	originalUrl: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: string;
}

// ─── Discover Agent ──────────────────────────────────────

export interface DiscoverInput {
	topic: TopicContext;
	existingCorpus: CorpusSource[];
	channelConfig: Record<string, { enabled: boolean; params?: Record<string, unknown> }>;
}

export interface DiscoveredSource {
	url?: string;
	content: string;
	title: string;
	relevanceRationale: string;
	confidence: number;
	threadAssociations: string[];
	scope: 'on_thread' | 'adjacent';
	channel: string;
}

export interface DiscoverOutput {
	discoveredSources: DiscoveredSource[];
	searchSummary: string;
}

// ─── Audit Agent ─────────────────────────────────────────

export interface AuditInput {
	topic: TopicContext;
	corpus: CorpusSource[];
}

export interface AuditSignal {
	targetId: string;
	signalType: 'fresh' | 'contested' | 'stale' | 'retracted';
	reason: string;
}

export interface GapAnalysis {
	thread: string;
	coverage: 'strong' | 'thin' | 'missing';
	notes: string;
}

export interface ConsolidationSuggestion {
	sourceIds: string[];
	reason: string;
}

export interface AuditOutput {
	freshnessFlags: AuditSignal[];
	contradictions: AuditSignal[];
	gapAnalysis: GapAnalysis[];
	consolidationSuggestions: ConsolidationSuggestion[];
	summary: string;
}

// ─── Strategy Agent ──────────────────────────────────────

export interface StrategyInput {
	topic: TopicContext;
	corpus: CorpusSource[];
	journalistOutputs?: {
		discoveredSources: DiscoveredSource[];
		auditSummary: string;
	};
	pastAcceptedDrafts?: Array<{
		formatTemplate: string;
		renderedContent: string;
		createdAt: string;
	}>;
}

export interface EditorialIntent {
	thesis: string;
	argumentStructure: Array<{
		point: string;
		evidence: Array<{ sourceId: string; excerpt: string }>;
	}>;
	narrativeArc: string;
	connections: string;
}

export interface StrategyOutput {
	intent: EditorialIntent;
	summary: string;
}

// ─── Writer Agent ────────────────────────────────────────

export interface WriterInput {
	intent: EditorialIntent;
	template: {
		name: string;
		blocks: string[];
		constraints: {
			maxLength?: number;
			tone?: string;
			rules: string[];
		};
	};
}

export interface WriterOutput {
	renderedContent: string;
	formatTemplate: string;
}
