import * as readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { GeminiClient } from './gemini-client';
import { GeminiMessage, ToolDefinition, AgentOptions, ToolCall, ToolResult } from '../types';
import { fileReaderTool, fileExplorerTool, bashTool, fileEditorTool, codeSearchTool } from '../tools';

export class DevPilotAgent {
  private client: GeminiClient;
  private options: AgentOptions;
  private conversation: GeminiMessage[] = [];
  private tools: ToolDefinition[];
  private rl?: readline.Interface;
  private shouldExit = false;

  constructor(options: AgentOptions) {
    this.options = options;
    this.client = new GeminiClient(options);
    this.tools = [
      fileReaderTool,
      fileExplorerTool,
      bashTool,
      fileEditorTool,
      codeSearchTool,
    ];
  }

  async startChat(): Promise<void> {
    console.log(chalk.blue.bold('🤖 DevPilot AI - Your Coding Assistant'));
    console.log(chalk.gray('Type your request or "exit" to quit\n'));

    // Add system message
    this.conversation.push({
      role: 'system',
      content: this.getSystemPrompt(),
    });

    // Check if input is from a pipe (non-TTY)
    const isInteractive = process.stdin.isTTY;

    // If input is piped, process it first, then switch to interactive mode
    if (!isInteractive) {
      await this.processPipedInput();
      // After processing piped input, switch to interactive mode
      console.log(chalk.cyan('\n🔄 Piped input processed. Switching to interactive mode...'));
      console.log(chalk.gray('Continue the conversation or type "exit" to quit\n'));
    }

    // Now start interactive mode (either directly or after piped input)
    await this.startInteractiveMode();
  }

  private async processPipedInput(): Promise<void> {
    return new Promise((resolve) => {
      let inputBuffer = '';
      
      process.stdin.on('data', (chunk) => {
        inputBuffer += chunk.toString();
      });

      process.stdin.on('end', async () => {
        const lines = inputBuffer.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(chalk.cyan(`You: ${line}`));
            try {
              await this.processMessage(line.trim());
            } catch (error: any) {
              console.log(chalk.red(`❌ Error: ${error.message}`));
            }
          }
        }
        resolve();
      });
    });
  }

  private async startInteractiveMode(): Promise<void> {
    // For interactive mode after piped input, we need to reopen stdin
    const fs = require('fs');
    
    let inputStream = process.stdin;
    
    // If stdin was consumed by piped input, reopen it from the TTY
    if (!process.stdin.isTTY) {
      try {
        inputStream = fs.createReadStream('/dev/tty');
      } catch (error) {
        // Fallback for non-Unix systems or if /dev/tty is not available
        console.log(chalk.yellow('Interactive mode not available on this system after piped input.'));
        return;
      }
    }

    this.rl = readline.createInterface({
      input: inputStream,
      output: process.stdout,
    });

    // Handle readline close event (Ctrl+D in interactive mode)
    this.rl.on('close', () => {
      if (!this.shouldExit) {
        console.log(chalk.yellow('\nGoodbye! 👋'));
        this.shouldExit = true;
      }
    });

    const askQuestion = (): Promise<string> => {
      return new Promise((resolve, reject) => {
        if (this.shouldExit) {
          reject(new Error('Chat session ended'));
          return;
        }

        this.rl!.question(chalk.cyan('You: '), (answer) => {
          resolve(answer);
        });
      });
    };

    const cleanup = () => {
      if (this.rl) {
        this.rl.close();
      }
    };

    // Handle process termination signals
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\nGoodbye! 👋'));
      this.shouldExit = true;
      // Give a small delay to ensure message is displayed
      setTimeout(() => {
        cleanup();
        process.exit(0);
      }, 100);
    });

    process.on('SIGTERM', () => {
      console.log(chalk.yellow('\nGoodbye! 👋'));
      this.shouldExit = true;
      // Give a small delay to ensure message is displayed
      setTimeout(() => {
        cleanup();
        process.exit(0);
      }, 100);
    });

    try {
      // eslint-disable-next-line no-constant-condition
      while (!this.shouldExit) {
        let userInput: string;
        try {
          userInput = await askQuestion();
        } catch (error: any) {
          // Readline interface was closed, exit gracefully
          if (error.code === 'ERR_USE_AFTER_CLOSE' || error.message.includes('readline was closed') || this.shouldExit) {
            break;
          }
          console.log(chalk.red(`❌ Input error: ${error.message}`));
          break;
        }

        if (this.shouldExit || userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
          console.log(chalk.yellow('Goodbye! 👋'));
          break;
        }

        if (!userInput.trim()) {
          continue;
        }

        try {
          await this.processMessage(userInput);
        } catch (error: any) {
          console.log(chalk.red(`❌ Error: ${error.message}`));
          // Continue the loop instead of exiting
          console.log(chalk.yellow('You can continue chatting or type "exit" to quit.'));
        }
      }
    } catch (error: any) {
      console.log(chalk.red(`❌ Unexpected error: ${error.message}`));
    } finally {
      cleanup();
    }
  }

  private async processMessage(userInput: string): Promise<void> {
    // Add user message to conversation
    this.conversation.push({
      role: 'user',
      content: userInput,
    });

    let spinner: any = null;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Start spinner only if not already started
        if (!spinner) {
          spinner = ora('Thinking...').start();
        }

        // Get AI response
        const response = await this.client.chat(this.conversation, this.tools);
        this.conversation.push(response);

        // Stop spinner safely
        if (spinner) {
          spinner.stop();
          spinner = null;
        }

        // Display AI response
        if (response.content) {
          console.log(chalk.green('DevPilot: ') + response.content);
        }

        // Check for tool calls
        if (!response.toolCalls || response.toolCalls.length === 0) {
          break;
        }

        // Execute tools with self-correction
        const toolResults: ToolResult[] = [];
        for (const toolCall of response.toolCalls) {
          let result: ToolResult | undefined;
          let attempts = 0;
          const maxAttempts = 3;

          while (attempts < maxAttempts) {
            attempts++;
            spinner = ora(`Executing ${toolCall.function.name}... (attempt ${attempts}/${maxAttempts})`).start();

            try {
              result = await this.executeTool(toolCall);

              // Always show tool execution details (not just in verbose mode)
              console.log(chalk.magenta(`\n🔧 Tool: ${toolCall.function.name}`));
              console.log(chalk.gray(`Args: ${JSON.stringify(toolCall.function.arguments, null, 2)}`));
              console.log(chalk.blue(`Result: ${result.content}`));

              spinner.succeed(`Executed ${toolCall.function.name}`);
              break;

            } catch (error: any) {
              spinner.fail(`Attempt ${attempts} failed: ${error.message}`);

              if (attempts === maxAttempts) {
                // Final attempt failed
                result = {
                  tool_call_id: toolCall.id,
                  content: `Error after ${maxAttempts} attempts: ${error.message}`,
                  is_error: true,
                };

                // Always show tool errors (not just in verbose mode)
                console.log(chalk.red(`❌ Tool Error (final): ${error.message}`));
                break; // Exit the retry loop
              } else {
                // Try to provide helpful context for retry
                const errorContext = this.getErrorContext(error, toolCall);
                if (errorContext) {
                  // Add error context to conversation for self-correction
                  this.conversation.push({
                    role: 'assistant',
                    content: `Tool execution failed: ${error.message}. ${errorContext}`,
                  });

                  // Get AI's correction
                  const correctionResponse = await this.client.chat(this.conversation, this.tools);
                  if (correctionResponse.toolCalls && correctionResponse.toolCalls.length > 0) {
                    // Use the corrected tool call
                    const correctedToolCall = correctionResponse.toolCalls[0];
                    // Always show correction attempts (not just in verbose mode)
                    console.log(chalk.yellow(`🔄 Retrying with correction: ${JSON.stringify(correctedToolCall.function.arguments)}`));
                  }
                }
              }
            }
          }

          // Ensure we have a result before pushing
          if (result) {
            toolResults.push(result);
          } else {
            // Fallback in case something went wrong
            toolResults.push({
              tool_call_id: toolCall.id,
              content: 'Tool execution failed with unknown error',
              is_error: true,
            });
          }
        }

        // Add tool results to conversation
        this.conversation.push({
          role: 'assistant',
          content: '',
          toolResults,
        });

        // Continue the loop to get AI's response to tool results
        if (!spinner) {
          spinner = ora('Processing results...').start();
        }
      }
    } catch (error: any) {
      if (spinner) {
        spinner.stop();
      }
      console.log(chalk.red(`❌ Error: ${error.message}`));
    }
  }

  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.find(t => t.name === toolCall.function.name);

    if (!tool) {
      throw new Error(`Tool '${toolCall.function.name}' not found`);
    }

    const result = await tool.function(toolCall.function.arguments);

    return {
      tool_call_id: toolCall.id,
      content: result,
    };
  }

  private getSystemPrompt(): string {
    return `You are DevPilot, an expert coding assistant powered by Google's Gemini AI. You have access to powerful tools to help users with coding tasks.

Your capabilities include:
- Reading and analyzing code files
- Exploring project structures
- Running shell commands safely
- Editing files with search-replace operations
- Searching code patterns with ripgrep

Guidelines:
- Be helpful, accurate, and concise
- Use tools proactively when needed
- Explain your reasoning when making changes
- Handle errors gracefully and suggest alternatives
- Ask for clarification when requirements are unclear
- Provide complete, runnable code solutions

When working with files:
- Always check file contents before making changes
- Use relative paths from the current working directory
- Be careful with destructive operations
- Verify your changes after making them

Available tools: ${this.tools.map(t => t.name).join(', ')}`;
  }

  // Method to programmatically send messages (for testing or automation)
  async sendMessage(message: string): Promise<GeminiMessage> {
    this.conversation.push({
      role: 'user',
      content: message,
    });

    const response = await this.client.chat(this.conversation, this.tools);
    this.conversation.push(response);

    return response;
  }

  // Get conversation history
  getConversation(): GeminiMessage[] {
    return [...this.conversation];
  }

  // Clear conversation
  clearConversation(): void {
    this.conversation = [{
      role: 'system',
      content: this.getSystemPrompt(),
    }];
  }

  // Provide error context for self-correction
  private getErrorContext(error: any, toolCall: ToolCall): string | null {
    const errorMessage = error.message.toLowerCase();

    // File not found errors
    if (errorMessage.includes('file not found') || errorMessage.includes('no such file')) {
      return 'The file path may be incorrect. Try using list_files first to see available files.';
    }

    // Permission errors
    if (errorMessage.includes('permission denied') || errorMessage.includes('access denied')) {
      return 'Permission denied. Check file permissions or try a different path.';
    }

    // Directory errors
    if (errorMessage.includes('is not a directory') || errorMessage.includes('not a directory')) {
      return 'The specified path is not a directory. Use list_files to check the path type.';
    }

    // Command not found
    if (errorMessage.includes('command not found')) {
      return 'The command is not available. Check if the required tool is installed.';
    }

    // Search pattern errors
    if (toolCall.function.name === 'code_search' && errorMessage.includes('no matches found')) {
      return 'No matches found for the search pattern. Try a different pattern or check the file type.';
    }

    // File editing errors
    if (toolCall.function.name === 'edit_file') {
      if (errorMessage.includes('old_str not found')) {
        return 'The text to replace was not found. Check the exact text and try reading the file first.';
      }
      if (errorMessage.includes('found multiple times')) {
        return 'The text appears multiple times. Provide more context to make it unique.';
      }
    }

    return null;
  }
}
