import { resolveDataDir, getPlatformInfo } from '../paths';
import { listRegistryEntries } from './registry';
import { openProject, openRegistry, type ProjectHandle } from './project';

// Resolves the "current" project for app surfaces (the SvelteKit shell, the
// outbound MCP server, etc.).
//
// Resolution order:
//   1. BRAINDANCE_PROJECT_ID env (explicit pin — used by integration tests and
//      multi-project users who want a stable anchor)
//   2. First entry in the registry (single-project beta default)
//   3. null (no projects exist yet — UI renders empty state)

export interface CurrentProjectResult {
	handle: ProjectHandle | null;
	availableProjects: Array<{ id: string; name: string }>;
}

export async function getCurrentProject(): Promise<CurrentProjectResult> {
	const dataDir = resolveDataDir(getPlatformInfo());
	const registry = await openRegistry(dataDir);
	const entries = await listRegistryEntries(registry);

	const available = entries.map((e) => ({ id: e.id, name: e.name }));
	if (entries.length === 0) {
		return { handle: null, availableProjects: available };
	}

	const pinned = process.env.BRAINDANCE_PROJECT_ID;
	const targetId = pinned && entries.some((e) => e.id === pinned) ? pinned : entries[0].id;
	const handle = await openProject(dataDir, registry, targetId);
	return { handle, availableProjects: available };
}
