import axios, { AxiosInstance } from 'axios';
import { GeminiMessage, ToolDefinition, GeminiConfig } from '../types';

export class GeminiClient {
  private client: AxiosInstance;
  private config: GeminiConfig;

  constructor(config: GeminiConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      headers: {
        'Content-Type': 'application/json',
      },
      params: {
        key: config.apiKey,
      },
    });
  }

  async chat(
    messages: GeminiMessage[],
    tools?: ToolDefinition[],
    _stream: boolean = false
  ): Promise<GeminiMessage> {
    const url = `/${this.config.model}:generateContent`;

    // Convert to Gemini API format
    const geminiContents = this.convertToGeminiContents(messages);
    const geminiTools = tools ? this.convertToGeminiTools(tools) : undefined;

    const requestBody = {
      contents: geminiContents,
      generationConfig: {
        maxOutputTokens: this.config.maxTokens,
      },
      ...(geminiTools && { tools: geminiTools }),
    };

    if (this.config.verbose) {
      console.log('🔄 Making Gemini API request...');
      console.log('📨 Request body:', JSON.stringify(requestBody, null, 2));
    }

    try {
      const response = await this.client.post(url, requestBody);

      if (this.config.verbose) {
        console.log('📥 Raw response:', response.data);
      }

      return this.parseGeminiResponse(response.data);
    } catch (error: any) {
      if (this.config.verbose) {
        console.error('❌ API Error:', error.response?.data || error.message);
      }
      throw new Error(`Gemini API error: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  async *chatStream(
    messages: GeminiMessage[],
    tools?: ToolDefinition[]
  ): AsyncGenerator<GeminiMessage, void, unknown> {
    const url = `/openai/chat/completions`;

    const openaiMessages = this.convertToOpenAIMessages(messages);
    const openaiTools = tools ? this.convertToOpenAITools(tools) : undefined;

    const requestBody = {
      model: this.config.model,
      messages: openaiMessages,
      max_tokens: this.config.maxTokens,
      stream: true,
      ...(openaiTools && { tools: openaiTools }),
    };

    if (this.config.verbose) {
      console.log('🔄 Starting streaming request...');
    }

    try {
      const response = await this.client.post(url, requestBody, {
        responseType: 'stream',
        timeout: 60000, // 60 second timeout for streaming
      });

      let buffer = '';
      let currentToolCalls: any[] = [];
      let currentContent = '';

      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');

        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            if (data === '[DONE]') {
              // Yield any remaining content
              if (currentContent || currentToolCalls.length > 0) {
                const message: GeminiMessage = {
                  role: 'assistant',
                  content: currentContent,
                };
                if (currentToolCalls.length > 0) {
                  message.toolCalls = currentToolCalls;
                }
                yield message;
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.choices && parsed.choices[0]) {
                const delta = parsed.choices[0].delta;

                // Accumulate content
                if (delta.content) {
                  currentContent += delta.content;
                }

                // Handle tool calls
                if (delta.tool_calls) {
                  for (const toolCall of delta.tool_calls) {
                    if (toolCall.index !== undefined) {
                      // Extend array if needed
                      while (currentToolCalls.length <= toolCall.index) {
                        currentToolCalls.push({
                          id: '',
                          type: 'function',
                          function: { name: '', arguments: '' },
                        });
                      }

                      // Update the tool call
                      const existing = currentToolCalls[toolCall.index];
                      if (toolCall.id) existing.id = toolCall.id;
                      if (toolCall.function?.name) existing.function.name = toolCall.function.name;
                      if (toolCall.function?.arguments) {
                        existing.function.arguments += toolCall.function.arguments;
                      }
                    }
                  }
                }

                // Yield incremental updates
                if (delta.content || delta.tool_calls) {
                  const message: GeminiMessage = {
                    role: 'assistant',
                    content: currentContent,
                  };
                  if (currentToolCalls.length > 0) {
                    message.toolCalls = currentToolCalls;
                  }
                  yield message;
                }
              }
            } catch (parseError) {
              // Skip invalid JSON chunks
              if (this.config.verbose) {
                console.warn('⚠️  Skipping invalid JSON chunk:', parseError);
              }
            }
          }
        }
      }
    } catch (error: any) {
      throw new Error(`Streaming error: ${error.message}`);
    }
  }

  private convertToGeminiContents(messages: GeminiMessage[]): any[] {
    return messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));
  }

  private convertToGeminiTools(tools: ToolDefinition[]): any[] {
    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    }];
  }

  private convertToOpenAIMessages(messages: GeminiMessage[]): any[] {
    return messages.map(msg => {
      const baseMessage: any = {
        role: msg.role,
        content: msg.content,
      };

      if (msg.toolCalls) {
        baseMessage.tool_calls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: JSON.stringify(tc.function.arguments),
          },
        }));
      }

      if (msg.toolResults) {
        baseMessage.role = 'tool';
        baseMessage.tool_call_id = msg.toolResults[0].tool_call_id;
        baseMessage.content = msg.toolResults[0].content;
      }

      return baseMessage;
    });
  }

  private convertToOpenAITools(tools: ToolDefinition[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  private parseGeminiResponse(response: any): GeminiMessage {
    const candidate = response.candidates[0];

    const geminiMessage: GeminiMessage = {
      role: 'assistant',
      content: candidate.content.parts[0]?.text || '',
    };

    // Handle function calls if present
    if (candidate.content.parts[0]?.functionCall) {
      const functionCall = candidate.content.parts[0].functionCall;
      geminiMessage.toolCalls = [{
        id: 'call_' + Date.now(),
        type: 'function',
        function: {
          name: functionCall.name,
          arguments: functionCall.args,
        },
      }];
    }

    return geminiMessage;
  }

  private async *parseStream(stream: any): AsyncGenerator<any, void, unknown> {
    let buffer = '';

    for await (const chunk of stream) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');

      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return;
          }

          try {
            const parsed = JSON.parse(data);
            yield parsed;
          } catch (e) {
            // Ignore invalid JSON
          }
        }
      }
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.get('/openai/models');
      return response.data.data.map((model: any) => model.id);
    } catch (error: any) {
      throw new Error(`Failed to list models: ${error.message}`);
    }
  }
}
