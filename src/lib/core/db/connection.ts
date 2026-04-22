import { drizzle } from 'drizzle-orm/libsql';

export function createDb(url: string) {
	return drizzle({ connection: { url } });
}

export type Database = ReturnType<typeof createDb>;
