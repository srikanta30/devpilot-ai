export interface GeminiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, any>;
  };
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  function: (args: any) => Promise<string>;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  verbose: boolean;
  maxTokens: number;
}

export interface AgentOptions extends GeminiConfig {
  systemPrompt?: string;
}

export interface ConversationContext {
  messages: GeminiMessage[];
  tools: ToolDefinition[];
  workingDirectory: string;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  executionTime?: number;
}

export interface FileOperation {
  type: 'read' | 'write' | 'edit' | 'delete';
  path: string;
  content?: string;
  oldString?: string;
  newString?: string;
}

export interface SearchResult {
  file: string;
  line: number;
  content: string;
  match: string;
}

export interface ProjectTemplate {
  name: string;
  description: string;
  files: Array<{
    path: string;
    content: string;
  }>;
  dependencies?: string[];
  devDependencies?: string[];
}
