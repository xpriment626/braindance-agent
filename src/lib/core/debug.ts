// Lightweight progress logger for agent loops + LLM calls. Gated by
// BRAINDANCE_DEBUG=1 so production stays quiet but a struggling beta
// run can be diagnosed by re-running with the flag set.
//
// Output shape (one line per event):
//   [bd:debug] <scope> <event> field=value field2=value2 ...
//
// Scope is the subsystem ("discover", "audit", "openrouter"); event
// is what just happened ("iter-start", "tool-call", "fetch-done").
// Fields are stringifiable scalars.

const DEBUG_ENABLED = process.env.BRAINDANCE_DEBUG === '1';

export const debugEnabled = (): boolean => DEBUG_ENABLED;

export function debug(
	scope: string,
	event: string,
	fields: Record<string, string | number | boolean | null | undefined> = {}
): void {
	if (!DEBUG_ENABLED) return;
	const parts: string[] = [`[bd:debug]`, scope, event];
	for (const [k, v] of Object.entries(fields)) {
		if (v === undefined) continue;
		parts.push(`${k}=${formatValue(v)}`);
	}
	process.stderr.write(parts.join(' ') + '\n');
}

function formatValue(v: string | number | boolean | null): string {
	if (v === null) return 'null';
	if (typeof v === 'string') return /\s/.test(v) ? JSON.stringify(v) : v;
	return String(v);
}
