import { Tool } from './types.js';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { fetchWithRetry, HttpError } from '../utils/http.js';
import { incrementCounter, recordTiming } from '../utils/metrics.js';

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilySearchResult[];
  answer?: string;
}

/**
 * Web search tool using Tavily API.
 * Searches the web and returns summarized results.
 */
export const searchWebTool: Tool = {
  name: 'search_web',
  description: 'Search the web for current information. Use this when the user asks about recent events, needs current information, or asks questions you cannot answer from your training data.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to look up on the web.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (1-5). Defaults to 3.',
      },
    },
    required: ['query'],
  },
  execute: async (input) => {
    const config = getConfig();

    if (!config.tavilyApiKey) {
      return 'Web search is not configured. Please set up the Tavily API key.';
    }

    const query = input.query as string;
    const maxResults = Math.min(Math.max((input.maxResults as number) || 3, 1), 5);

    const startMs = Date.now();

    try {
      const response = await fetchWithRetry(
        'https://api.tavily.com/search',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: config.tavilyApiKey,
            query,
            max_results: maxResults,
            include_answer: true,
            search_depth: 'basic',
          }),
        },
        {
          timeoutMs: 10000,
          retries: 2,
          retryDelayMs: 500,
          onRetry: (attempt, err) => {
            logger.warn({ attempt, error: err.message }, 'Retrying Tavily API request');
          },
        }
      );

      const data = await response.json() as TavilyResponse;
      recordTiming('tavily_request_ms', Date.now() - startMs, { status: 'ok' });
      incrementCounter('tavily_requests', { status: 'ok' });

      // Build a formatted response
      let result = '';

      if (data.answer) {
        result += `Summary: ${data.answer}\n\n`;
      }

      if (data.results && data.results.length > 0) {
        result += 'Sources:\n';
        for (const item of data.results) {
          result += `- ${item.title}\n  ${item.url}\n  ${item.content.slice(0, 200)}...\n\n`;
        }
      } else {
        result = 'No results found for this search query.';
      }

      return result.trim();
    } catch (error) {
      const err = error as Error;
      recordTiming('tavily_request_ms', Date.now() - startMs, { status: 'error' });
      incrementCounter('tavily_requests', { status: 'error' });

      if (err instanceof HttpError) {
        logger.error({ status: err.status, error: err.body }, 'Tavily API error');
      } else {
        logger.error({ error: err }, 'Failed to execute web search');
      }
      return 'Failed to search the web due to a technical error.';
    }
  },
};
