import { Tool, ToolContext } from './types.js';

interface SearchHistoryInput {
  query: string;
  limit?: number;
}

interface SearchResult {
  content: string;
  created_at: string;
  session_started: string;
  direction: string;
  relevance: number;
}

export const searchHistoryTool: Tool = {
  name: 'search_history',
  description:
    'Search through past conversation messages using full-text search. Useful for finding information the user mentioned previously, even in past sessions. Returns relevant messages ranked by relevance.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search terms to look for in past messages',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 50)',
      },
    },
    required: ['query'],
  },
  execute: async (
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<string> => {
    const { query, limit = 10 } = input as unknown as SearchHistoryInput;

    if (!query || query.trim().length === 0) {
      return 'Error: Please provide a search query.';
    }

    const resultLimit = Math.min(Math.max(1, limit), 50);

    try {
      // Use PostgreSQL full-text search with plainto_tsquery for user-friendly input
      const results = await context.prisma.$queryRaw<SearchResult[]>`
        SELECT
          m.content,
          m.created_at,
          s.started_at as session_started,
          m.direction,
          ts_rank(m.search_vector, plainto_tsquery('english', ${query})) as relevance
        FROM messages m
        JOIN conversation_sessions s ON m.session_id = s.id
        WHERE m.tenant_id = ${context.tenantId}
          AND m.sender_phone = ${context.senderPhone}
          AND m.search_vector @@ plainto_tsquery('english', ${query})
        ORDER BY relevance DESC, m.created_at DESC
        LIMIT ${resultLimit}
      `;

      if (results.length === 0) {
        return `No messages found matching "${query}".`;
      }

      // Format results for Claude
      const formattedResults = results.map((r, i) => {
        const date = new Date(r.created_at).toLocaleString();
        const who = r.direction === 'INBOUND' ? 'User' : 'Assistant';
        return `[${i + 1}] ${date} (${who}): ${r.content}`;
      });

      return `Found ${results.length} message(s) matching "${query}":\n\n${formattedResults.join('\n\n')}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `Error searching history: ${errorMessage}`;
    }
  },
};
