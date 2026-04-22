export type InputType = 'text' | 'file' | 'url' | 'youtube' | 'tweet' | 'image';

export interface SeedInput {
	type: InputType;
	value: string; // text content for 'text', file path for 'file', URL for url/youtube/tweet
}

export interface HandlerResult {
	title: string;
	content: string;
	originalFormat: string;
	rawPath?: string; // relative path to stored original (file handler)
	provenance?: string;
	metadata?: Record<string, unknown>;
}

export interface UrlScraper {
	scrape(url: string): Promise<{
		title?: string;
		content: string;
		metadata?: Record<string, string>;
	}>;
}

export interface HandlerContext {
	filesDir: string; // project files/ directory
	sourceId: string; // pre-generated source ID for file storage paths
	scraper?: UrlScraper; // required for URL inputs
}
