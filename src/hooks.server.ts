// Server-side hooks. Module body runs once when the SvelteKit dev server
// (or a built server) boots — before any request is served.
//
// Why this file exists: bun is supposed to auto-load `.env` into
// `process.env` for `bun run <script>`, but the propagation through
// Vite + SvelteKit's plugin chain has been unreliable in practice
// (server-side `process.env.OPENROUTER_API_KEY` came back undefined
// during action handlers even though the same vars were visible to
// `bun -e` and `bun test` in the same shell). Loading `.env` here
// guarantees the SvelteKit runtime sees them, regardless of what the
// outer harness does. Cheap, idempotent, no extra dependency.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Handle } from '@sveltejs/kit';

loadDotenv();

function loadDotenv(): void {
	const cwd = process.cwd();
	for (const filename of ['.env.local', '.env']) {
		const path = join(cwd, filename);
		if (!existsSync(path)) continue;
		const text = readFileSync(path, 'utf-8');
		for (const rawLine of text.split('\n')) {
			const line = rawLine.trim();
			if (!line || line.startsWith('#')) continue;
			const eq = line.indexOf('=');
			if (eq === -1) continue;
			const key = line.slice(0, eq).trim();
			if (!key) continue;
			// Don't override values already present in process.env (shell-set
			// vars and explicit injections take precedence).
			if (process.env[key] !== undefined) continue;
			let value = line.slice(eq + 1).trim();
			// Strip surrounding quotes if present (matches bun/dotenv behavior).
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			process.env[key] = value;
		}
	}
}

export const handle: Handle = async ({ event, resolve }) => resolve(event);
