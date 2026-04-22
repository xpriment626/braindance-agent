import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveDataDir, resolveConfigDir } from './paths';

describe('path resolution', () => {
	const origEnv = { ...process.env };

	beforeEach(() => {
		delete process.env.BRAINDANCE_DATA_DIR;
		delete process.env.XDG_CONFIG_HOME;
		delete process.env.XDG_DATA_HOME;
	});

	afterEach(() => {
		process.env = { ...origEnv };
	});

	describe('resolveDataDir', () => {
		it('honors BRAINDANCE_DATA_DIR when set', () => {
			process.env.BRAINDANCE_DATA_DIR = '/custom/data';
			expect(resolveDataDir({ platform: 'darwin', home: '/Users/test' })).toBe('/custom/data');
			expect(resolveDataDir({ platform: 'linux', home: '/home/test' })).toBe('/custom/data');
		});

		it('uses macOS Application Support on darwin', () => {
			const path = resolveDataDir({ platform: 'darwin', home: '/Users/test' });
			expect(path).toBe('/Users/test/Library/Application Support/braindance');
		});

		it('uses XDG_DATA_HOME on linux when set', () => {
			process.env.XDG_DATA_HOME = '/home/test/.share';
			const path = resolveDataDir({ platform: 'linux', home: '/home/test' });
			expect(path).toBe('/home/test/.share/braindance');
		});

		it('falls back to ~/.local/share on linux', () => {
			const path = resolveDataDir({ platform: 'linux', home: '/home/test' });
			expect(path).toBe('/home/test/.local/share/braindance');
		});

		it('uses APPDATA on win32', () => {
			const path = resolveDataDir({
				platform: 'win32',
				home: 'C:\\Users\\test',
				appData: 'C:\\Users\\test\\AppData\\Roaming'
			});
			expect(path).toBe('C:\\Users\\test\\AppData\\Roaming\\braindance');
		});

		it('throws on win32 without APPDATA', () => {
			expect(() => resolveDataDir({ platform: 'win32', home: 'C:\\Users\\test' })).toThrow();
		});
	});

	describe('resolveConfigDir', () => {
		it('uses macOS Application Support on darwin (same as data dir)', () => {
			expect(resolveConfigDir({ platform: 'darwin', home: '/Users/test' })).toBe(
				'/Users/test/Library/Application Support/braindance'
			);
		});

		it('uses XDG_CONFIG_HOME on linux when set', () => {
			process.env.XDG_CONFIG_HOME = '/home/test/.config-custom';
			expect(resolveConfigDir({ platform: 'linux', home: '/home/test' })).toBe(
				'/home/test/.config-custom/braindance'
			);
		});

		it('falls back to ~/.config on linux', () => {
			expect(resolveConfigDir({ platform: 'linux', home: '/home/test' })).toBe(
				'/home/test/.config/braindance'
			);
		});

		it('ignores BRAINDANCE_DATA_DIR for config path', () => {
			process.env.BRAINDANCE_DATA_DIR = '/custom/data';
			const path = resolveConfigDir({ platform: 'linux', home: '/home/test' });
			expect(path).not.toContain('/custom/data');
		});
	});
});
