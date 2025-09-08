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
    const url = `/${this.config.model}:streamGenerateContent`;

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
      console.log('🔄 Starting Gemini streaming request...');
      console.log('📨 Request body:', JSON.stringify(requestBody, null, 2));
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
        
        // Try to parse complete JSON objects from the buffer
        let startIndex = 0;
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = 0; i < buffer.length; i++) {
          const char = buffer[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              if (braceCount === 0) {
                startIndex = i;
              }
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                // Found a complete JSON object
                const jsonStr = buffer.slice(startIndex, i + 1);
                try {
                  const parsed = JSON.parse(jsonStr);
                  
                  if (parsed.candidates && parsed.candidates[0]) {
                    const candidate = parsed.candidates[0];
                    
                    // Handle content streaming
                    if (candidate.content && candidate.content.parts) {
                      for (const part of candidate.content.parts) {
                        if (part.text) {
                          currentContent += part.text;
                          
                          // Yield incremental updates for text content
                          const message: GeminiMessage = {
                            role: 'assistant',
                            content: currentContent,
                          };
                          if (currentToolCalls.length > 0) {
                            message.toolCalls = currentToolCalls;
                          }
                          yield message;
                        }
                        
                        // Handle function calls
                        if (part.functionCall) {
                          const functionCall = part.functionCall;
                          currentToolCalls.push({
                            id: 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                            type: 'function',
                            function: {
                              name: functionCall.name,
                              arguments: functionCall.args || {},
                            },
                          });
                        }
                      }
                    }
                  }
                } catch (parseError) {
                  // Skip invalid JSON chunks
                  if (this.config.verbose) {
                    console.warn('⚠️  Skipping invalid JSON chunk:', parseError);
                  }
                }
                
                // Remove processed JSON from buffer
                buffer = buffer.slice(i + 1);
                i = -1; // Reset index for next iteration
              }
            }
          }
        }
      }

      // Yield final message if there's any content
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
    } catch (error: any) {
      if (this.config.verbose) {
        console.error('❌ Streaming API Error:', error.response?.data || error.message);
      }
      throw new Error(`Gemini streaming error: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  private convertToGeminiContents(messages: GeminiMessage[]): any[] {
    // Handle system message specially - combine with first user message
    let systemContent = '';
    const processedMessages = messages.filter(msg => {
      if (msg.role === 'system') {
        systemContent = msg.content;
        return false; // Remove system message from regular processing
      }
      return true;
    });

    return processedMessages
      .map((msg, index) => {
        const baseMessage: any = {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [],
        };

        // Combine system content with first user message
        let content = msg.content;
        if (index === 0 && msg.role === 'user' && systemContent) {
          content = `${systemContent}\n\n${msg.content}`;
        }

        // Add text content if present
        if (content) {
          baseMessage.parts.push({ text: content });
        }

        // Add tool calls if present
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const toolCall of msg.toolCalls) {
            baseMessage.parts.push({
              functionCall: {
                name: toolCall.function.name,
                args: toolCall.function.arguments,
              },
            });
          }
        }

        // Add tool results if present
        if (msg.toolResults && msg.toolResults.length > 0) {
          for (const toolResult of msg.toolResults) {
            baseMessage.parts.push({
              functionResponse: {
                name: 'function_response', // This might need to be the actual function name
                response: {
                  name: toolResult.tool_call_id,
                  content: toolResult.content,
                },
              },
            });
          }
        }

        return baseMessage;
      })
      .filter(msg => msg.parts.length > 0); // Filter out messages with no parts to satisfy Gemini API requirements
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

    if (this.config.verbose) {
      console.log('🔍 Parsing Gemini response:', JSON.stringify(response, null, 2));
    }

    const geminiMessage: GeminiMessage = {
      role: 'assistant',
      content: candidate.content.parts[0]?.text || '',
    };

    // Handle function calls if present
    // Check multiple possible locations for function calls in Gemini API response
    const parts = candidate.content.parts || [];
    const toolCalls: any[] = [];

    for (const part of parts) {
      if (part.functionCall) {
        const functionCall = part.functionCall;
        if (this.config.verbose) {
          console.log('🔧 Found function call in part:', functionCall);
        }
        toolCalls.push({
          id: 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          type: 'function',
          function: {
            name: functionCall.name,
            arguments: functionCall.args || {},
          },
        });
      }
    }

    // Also check if there are function calls at the candidate level
    if (candidate.content.functionCall) {
      const functionCall = candidate.content.functionCall;
      if (this.config.verbose) {
        console.log('🔧 Found function call at candidate level:', functionCall);
      }
      toolCalls.push({
        id: 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        type: 'function',
        function: {
          name: functionCall.name,
          arguments: functionCall.args || {},
        },
      });
    }

    if (toolCalls.length > 0) {
      geminiMessage.toolCalls = toolCalls;
      if (this.config.verbose) {
        console.log('✅ Parsed tool calls:', toolCalls);
      }
    } else if (this.config.verbose) {
      console.log('⚠️  No tool calls found in response');
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
