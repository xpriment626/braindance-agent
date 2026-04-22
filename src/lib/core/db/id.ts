import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

export function generateId(): string {
	return ulid();
}
