import path from 'node:path';

export interface PlatformInfo {
	platform: NodeJS.Platform;
	home: string;
	appData?: string;
}

export function resolveDataDir(info: PlatformInfo): string {
	const override = process.env.BRAINDANCE_DATA_DIR;
	if (override) return override;

	switch (info.platform) {
		case 'darwin':
			return path.posix.join(info.home, 'Library', 'Application Support', 'braindance');
		case 'win32':
			if (!info.appData) throw new Error('APPDATA env required on win32');
			return path.win32.join(info.appData, 'braindance');
		default: {
			const xdg = process.env.XDG_DATA_HOME;
			return xdg
				? path.posix.join(xdg, 'braindance')
				: path.posix.join(info.home, '.local', 'share', 'braindance');
		}
	}
}

export function resolveConfigDir(info: PlatformInfo): string {
	switch (info.platform) {
		case 'darwin':
			return path.posix.join(info.home, 'Library', 'Application Support', 'braindance');
		case 'win32':
			if (!info.appData) throw new Error('APPDATA env required on win32');
			return path.win32.join(info.appData, 'braindance');
		default: {
			const xdg = process.env.XDG_CONFIG_HOME;
			return xdg
				? path.posix.join(xdg, 'braindance')
				: path.posix.join(info.home, '.config', 'braindance');
		}
	}
}

export function getPlatformInfo(): PlatformInfo {
	return {
		platform: process.platform,
		home: process.env.HOME || process.env.USERPROFILE || '',
		appData: process.env.APPDATA
	};
}
