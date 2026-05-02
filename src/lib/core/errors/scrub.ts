// Sensitive-data scrubbing applied to error messages before persistence.
// Targets the leak vectors that show up in HTTP error bodies: API keys
// embedded in request echoes, bearer tokens in Authorization headers,
// provider-prefixed keys (sk-*) anywhere in the message.

const MAX_LENGTH = 1000;
const TRUNCATION_MARKER = '… [truncated]';

const PATTERNS: Array<[RegExp, string]> = [
	// api_key / api-key / API_KEY = value or : value (whitespace tolerated)
	[/(api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]'],
	// "Bearer <token>" inside an Authorization header
	[/(authorization\s*:\s*)bearer\s+\S+/gi, '$1[REDACTED]'],
	// Standalone "bearer <token>" (no Authorization header context)
	[/\bbearer\s+\S+/gi, 'bearer=[REDACTED]'],
	// Provider-prefixed keys (OpenRouter / OpenAI style)
	[/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED-KEY]']
];

export function scrub(message: string): string {
	let out = message;
	for (const [pattern, replacement] of PATTERNS) {
		out = out.replace(pattern, replacement);
	}
	if (out.length > MAX_LENGTH) {
		out = out.slice(0, MAX_LENGTH) + TRUNCATION_MARKER;
	}
	return out;
}
