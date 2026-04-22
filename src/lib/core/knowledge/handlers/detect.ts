import type { InputType } from './types';

export function detectInputType(input: string): InputType {
	if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(input)) return 'youtube';
	if (/^https?:\/\/(www\.)?(twitter\.com|x\.com)/.test(input)) return 'tweet';
	if (/^https?:\/\//.test(input)) return 'url';
	return 'text';
}
