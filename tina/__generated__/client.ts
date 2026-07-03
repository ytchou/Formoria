// Stub — satisfies TypeScript imports; overwritten locally by `pnpm tina:build`

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
      throw new Error(`Tina client not initialized — run pnpm tina:build. Args: ${JSON.stringify(args)}`);
    },
    guideConnection: async (args?: { first?: number; filter?: Record<string, unknown> }): Promise<GuideConnectionQueryResult> => {
      throw new Error(`Tina client not initialized — run pnpm tina:build. Args: ${JSON.stringify(args)}`);
    },
  },
};

export default client;
