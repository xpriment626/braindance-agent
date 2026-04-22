import { generateId } from '../db/id';
import type { Database } from '../db/connection';
import type { SeedInput, HandlerResult, UrlScraper, InputType } from './handlers/types';
import { handleText } from './handlers/text';
import { handleFile } from './handlers/file';
import { handleUrl } from './handlers/url';
import {
	createSeed,
	incrementProcessedCount,
	completeSeed,
	type SeedFailure,
	type SeedOrigin
} from './seeds';
import { createSource } from './sources';
import { getTopic, updateTopic, type UpdateTopicInput } from './topics';

export interface ProcessConfig {
	filesDir: string;
	scraper?: UrlScraper;
	origin?: SeedOrigin;
}

export interface BriefingCard {
	guidance?: string;
	narrativeThreads?: string[];
	inputs: SeedInput[];
}

function isUnsupportedType(t: InputType): t is 'youtube' | 'tweet' | 'image' {
	return t === 'youtube' || t === 'tweet' || t === 'image';
}

async function processInput(
	input: SeedInput,
	filesDir: string,
	sourceId: string,
	scraper?: UrlScraper
): Promise<HandlerResult> {
	if (isUnsupportedType(input.type)) {
		throw new Error(
			`Input type "${input.type}" not yet supported in Phase 2 (value: ${input.value})`
		);
	}
	switch (input.type) {
		case 'text':
			return handleText(input.value);
		case 'file':
			return handleFile(input.value, filesDir, sourceId);
		case 'url':
			if (!scraper) throw new Error('URL scraper required for URL inputs');
			return handleUrl(input.value, scraper);
		default: {
			const exhaustive: never = input.type;
			throw new Error(`Unhandled input type: ${exhaustive}`);
		}
	}
}

async function runInputPipeline(
	db: Database,
	topicId: string,
	seedId: string,
	inputs: SeedInput[],
	config: ProcessConfig
): Promise<SeedFailure[]> {
	const failures: SeedFailure[] = [];

	const results = await Promise.allSettled(
		inputs.map(async (input) => {
			const sourceId = generateId();
			const result = await processInput(input, config.filesDir, sourceId, config.scraper);

			await createSource(db, {
				id: sourceId,
				seedId,
				topicId,
				title: result.title,
				type: input.type,
				content: result.content,
				originalFormat: result.originalFormat,
				originalUrl: input.type === 'url' ? input.value : undefined,
				rawPath: result.rawPath,
				provenance: result.provenance,
				metadata: result.metadata
			});

			await incrementProcessedCount(db, seedId);
		})
	);

	results.forEach((result, index) => {
		if (result.status === 'rejected') {
			const reason = result.reason;
			const message = reason instanceof Error ? reason.message : String(reason);
			failures.push({
				inputIndex: index,
				type: inputs[index].type,
				error: message || 'Unknown error'
			});
		}
	});

	return failures;
}

export async function processSeed(
	db: Database,
	topicId: string,
	inputs: SeedInput[],
	config: ProcessConfig
): Promise<{ seedId: string }> {
	const seed = await createSeed(db, {
		topicId,
		type: 'freeform',
		origin: config.origin ?? 'user',
		inputCount: inputs.length
	});

	const failures = await runInputPipeline(db, topicId, seed.id, inputs, config);
	await completeSeed(db, seed.id, failures.length > 0 ? failures : undefined);
	return { seedId: seed.id };
}

export async function processBriefingCard(
	db: Database,
	topicId: string,
	card: BriefingCard,
	config: ProcessConfig
): Promise<{ seedId: string }> {
	// Apply briefing-card metadata to the topic.
	const updates: UpdateTopicInput = {};
	if (card.guidance !== undefined) updates.guidance = card.guidance;
	if (card.narrativeThreads !== undefined) updates.narrativeThreads = card.narrativeThreads;
	if (Object.keys(updates).length > 0) {
		await updateTopic(db, topicId, updates);
	}

	// Snapshot the topic's post-update state — records what was in force at seed time.
	const topic = await getTopic(db, topicId);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);
	const topicSnapshot = {
		guidance: topic.guidance,
		narrativeThreads: topic.narrativeThreads ? JSON.parse(topic.narrativeThreads) : null
	};

	const seed = await createSeed(db, {
		topicId,
		type: 'briefing_card',
		origin: config.origin ?? 'user',
		inputCount: card.inputs.length,
		topicSnapshot
	});

	if (card.inputs.length === 0) {
		await completeSeed(db, seed.id);
		return { seedId: seed.id };
	}

	const failures = await runInputPipeline(db, topicId, seed.id, card.inputs, config);
	await completeSeed(db, seed.id, failures.length > 0 ? failures : undefined);
	return { seedId: seed.id };
}
