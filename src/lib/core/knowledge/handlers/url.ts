import type { HandlerResult, UrlScraper } from './types';

export async function handleUrl(url: string, scraper: UrlScraper): Promise<HandlerResult> {
	const result = await scraper.scrape(url);
	const hostname = new URL(url).hostname;
	return {
		title: result.title || hostname,
		content: result.content,
		originalFormat: 'text/html',
		provenance: `Scraped: ${hostname}`,
		metadata: {
			sourceUrl: url,
			...result.metadata
		}
	};
}
