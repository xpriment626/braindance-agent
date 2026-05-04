/**
 * Bootstraps a "Personal KB" project + a first topic seeded via briefing card.
 * Idempotent — re-running reuses an existing project of the same name and
 * adds another topic + seed.
 *
 * Run with:
 *   bun scripts/bootstrap.ts
 *
 * Defaults to your real data dir (~/Library/Application Support/braindance on
 * macOS). Override with BRAINDANCE_DATA_DIR=/tmp/braindance-smoke if you want
 * a throwaway dir.
 */

import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { resolveDataDir, getPlatformInfo } from '../src/lib/core/paths';
import {
	openRegistry,
	createProject,
	openProject
} from '../src/lib/core/projects/project';
import { listRegistryEntries } from '../src/lib/core/projects/registry';
import { processBriefingCard } from '../src/lib/core/knowledge/process';

const PROJECT_NAME = 'Personal KB';

const TOPIC = {
	name: 'HCI at the agent paradigm inflection',
	description: 'The design space where AI capabilities force a rethink of interface primitives.',
	guidance:
		'Focus on the inflection where agent-native UX breaks from skeuomorphic chat UIs. ' +
		'Value primary sources and replication studies over hot takes. ' +
		'Follow citation chains one hop out when warranted. ' +
		'Flag any claim that depends on pre-2024 capability assumptions as potentially stale.',
	narrativeThreads: [
		'automation paradox',
		'skeuomorphic AI timeline',
		'stage/commit UX'
	]
};

const INITIAL_INPUTS = [
	{
		type: 'text' as const,
		value:
			'The automation paradox (Bainbridge, 1983; replicated by Onnasch et al., 2014): ' +
			'as automation increases, the operator\'s remaining role becomes harder, not easier. ' +
			'Operators are asked to monitor, intervene rarely, and then take over correctly under ' +
			'time pressure — three skills that are hostile to each other.'
	},
	{
		type: 'text' as const,
		value:
			'Skeuomorphic AI: today\'s LLM chat UIs (ChatGPT, Claude.ai) borrow the visual language ' +
			'of human-to-human messaging because that\'s what users were familiar with in 2022-2023. ' +
			'But the interaction model is fundamentally different — agents are not people, and ' +
			'pretending they are leaks abstractions everywhere (memory, identity, error-recovery, ' +
			'tool use). The agent-native UX layer hasn\'t been invented yet.'
	}
];

async function main(): Promise<void> {
	const dataDir = resolveDataDir(getPlatformInfo());
	console.log(`Data dir: ${dataDir}`);

	const registry = await openRegistry(dataDir);

	// Find or create the project (idempotent on name match).
	const existing = await listRegistryEntries(registry);
	const existingEntry = existing.find((p) => p.name === PROJECT_NAME);

	let projectId: string;
	if (existingEntry) {
		projectId = existingEntry.id;
		console.log(`Reusing project "${PROJECT_NAME}" (${projectId})`);
	} else {
		const handle = await createProject(dataDir, registry, PROJECT_NAME);
		projectId = handle.id;
		console.log(`Created project "${PROJECT_NAME}" (${projectId})`);
	}

	// Open the project DB.
	const handle = await openProject(dataDir, registry, projectId);
	if (!handle) throw new Error(`couldn't open project ${projectId}`);

	const filesDir = join(handle.path, 'files');
	await mkdir(filesDir, { recursive: true });

	// Create a fresh topic with initial sources via briefing card.
	// Re-running the script adds another topic with the same metadata —
	// fine for dogfooding; topics get unique IDs so there's no collision.
	const result = await processBriefingCard(
		handle.db,
		null, // null topicId → create new topic
		{
			name: TOPIC.name,
			description: TOPIC.description,
			guidance: TOPIC.guidance,
			narrativeThreads: TOPIC.narrativeThreads,
			inputs: INITIAL_INPUTS
		},
		{ filesDir } // no scraper — text inputs only, no URL/file inputs in seed
	);

	console.log(`Topic created: ${result.topicId} ("${TOPIC.name}")`);
	console.log(`Seed created:  ${result.seedId} (${INITIAL_INPUTS.length} inputs)`);
	console.log('');
	console.log('Next: bun run dev → http://localhost:5173');
	console.log('Click "Run discover" on the topic card to trigger add_knowledge.');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
