import { resolveDataDir, getPlatformInfo } from '../paths';
import { listRegistryEntries } from './registry';
import { openProject, openRegistry, type ProjectHandle } from './project';

// Resolves the "current" project for app surfaces (the SvelteKit shell, the
// outbound MCP server, etc.).
//
// Resolution order (highest priority first):
//   1. Cookie `braindance_project_id` if set and valid (UI source of truth —
//      written by the picker / create flow; only present when called with a
//      `cookies` arg from a SvelteKit load function)
//   2. BRAINDANCE_PROJECT_ID env if set and valid (tests, CLI, programmatic
//      anchors — applies when no cookie is provided or the cookie is empty)
//   3. First entry in the registry (single-project default)
//   4. null (no projects exist yet — UI renders empty state)

export interface CookiesShape {
	get(name: string): string | undefined;
}

export interface CurrentProjectResult {
	handle: ProjectHandle | null;
	availableProjects: Array<{ id: string; name: string }>;
}

export async function getCurrentProject(
	cookies?: CookiesShape
): Promise<CurrentProjectResult> {
	const dataDir = resolveDataDir(getPlatformInfo());
	const registry = await openRegistry(dataDir);
	const entries = await listRegistryEntries(registry);

	const available = entries.map((e) => ({ id: e.id, name: e.name }));
	if (entries.length === 0) {
		return { handle: null, availableProjects: available };
	}

	const cookiePin = cookies?.get('braindance_project_id');
	if (cookiePin && entries.some((e) => e.id === cookiePin)) {
		const handle = await openProject(dataDir, registry, cookiePin);
		return { handle, availableProjects: available };
	}

	const envPin = process.env.BRAINDANCE_PROJECT_ID;
	if (envPin && entries.some((e) => e.id === envPin)) {
		const handle = await openProject(dataDir, registry, envPin);
		return { handle, availableProjects: available };
	}

	const handle = await openProject(dataDir, registry, entries[0].id);
	return { handle, availableProjects: available };
}
