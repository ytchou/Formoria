// Auto-generated stub — replace with real generated types when tinacms CLI/Vite compat is resolved
// This file is gitignored and exists only to satisfy TypeScript imports during development

type GuideQueryResult = {
  data: {
    guide: Record<string, unknown>;
  };
  query: string;
  variables: Record<string, unknown>;
};

type GuideConnectionQueryResult = {
  data: {
    guideConnection: {
      edges: Array<{
        node: Record<string, unknown>;
      }>;
    };
  };
};

export const client = {
  queries: {
    guide: async (args: { relativePath: string }): Promise<GuideQueryResult> => {
      throw new Error(`Tina client not initialized — run tinacms build first. Args: ${JSON.stringify(args)}`);
    },
    guideConnection: async (args?: { first?: number; filter?: Record<string, unknown> }): Promise<GuideConnectionQueryResult> => {
      throw new Error(`Tina client not initialized — run tinacms build first. Args: ${JSON.stringify(args)}`);
    },
  },
};

export default client;
