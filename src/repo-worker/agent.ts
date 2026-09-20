export type AgentRequest = {
  prompt: string;
  access: "read" | "write";
  jsonSchema: object;
  resumeSessionId?: string;
};

export type AgentResult = {
  structuredOutput: unknown;
  sessionId?: string;
  usage?: Record<string, number>;
};
