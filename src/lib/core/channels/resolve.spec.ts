import { describe, it, expect } from 'vitest';
import { resolveChannelSelection } from './resolve';
import type { ChannelConfig } from '../config/types';

describe('resolveChannelSelection', () => {
	const global: Record<string, ChannelConfig> = {
		web: { enabled: true, mcp_server: 'exa' },
		github: {
			enabled: true,
			mcp_server: 'deepwiki',
			params: { repos: ['org/default'] }
		},
		notion: { enabled: false, mcp_server: 'notion' }
	};

	it('returns globally-enabled channels when no per-run override', () => {
		const result = resolveChannelSelection(global, undefined);
		expect(Object.keys(result).sort()).toEqual(['github', 'web']);
	});

	it('per-run selects a subset', () => {
		const result = resolveChannelSelection(global, {
			web: { enabled: true }
		});
		expect(Object.keys(result)).toEqual(['web']);
	});

	it('per-run params override global params (field-by-field)', () => {
		const result = resolveChannelSelection(global, {
			github: { enabled: true, params: { repos: ['org/override'] } }
		});
		expect(result.github.params).toEqual({ repos: ['org/override'] });
	});

	it('throws when per-run enables a channel not configured globally', () => {
		expect(() =>
			resolveChannelSelection(global, { arxiv: { enabled: true } })
		).toThrow(/arxiv/);
	});

	it('throws when per-run enables a channel that is globally disabled', () => {
		expect(() =>
			resolveChannelSelection(global, { notion: { enabled: true } })
		).toThrow(/notion/);
	});
});
