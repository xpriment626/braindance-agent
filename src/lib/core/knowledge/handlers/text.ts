import type { HandlerResult } from './types';

export async function handleText(text: string): Promise<HandlerResult> {
	const title = `Text: ${text.slice(0, 80)}`;
	return {
		title,
		content: text,
		originalFormat: 'text/plain',
		provenance: 'Pasted text'
	};
}
