import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { ToolDefinition, SearchResult } from '../types';

const execAsync = promisify(exec);

export const codeSearchTool: ToolDefinition = {
  name: 'code_search',
  description: 'Search for code patterns in the project using ripgrep. Supports regex patterns, file type filtering, and case sensitivity.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The search pattern or regex to look for',
      },
      path: {
        type: 'string',
        description: 'Optional path to search in (file or directory). Defaults to current directory.',
      },
      file_type: {
        type: 'string',
        description: 'Optional file extension to limit search (e.g., "js", "ts", "py", "go")',
      },
      case_sensitive: {
        type: 'boolean',
        description: 'Whether the search should be case sensitive. Defaults to false.',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return. Defaults to 50.',
      },
    },
    required: ['pattern'],
  },
  function: async (args: {
    pattern: string;
    path?: string;
    file_type?: string;
    case_sensitive?: boolean;
    max_results?: number;
  }): Promise<string> => {
    const {
      pattern,
      path: searchPath,
      file_type,
      case_sensitive = false,
      max_results = 50
    } = args;

    if (!pattern || pattern.trim() === '') {
      throw new Error('Search pattern cannot be empty');
    }

    try {
      // Build ripgrep command
      const rgArgs = ['rg', '--line-number', '--with-filename', '--color=never'];

      // Add case sensitivity
      if (!case_sensitive) {
        rgArgs.push('--ignore-case');
      }

      // Add file type filter
      if (file_type) {
        rgArgs.push('--type', file_type);
      }

      // Add pattern
      rgArgs.push(pattern);

      // Add search path
      const targetPath = searchPath ? path.resolve(searchPath) : '.';
      rgArgs.push(targetPath);

      const command = rgArgs.join(' ');

      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      if (stderr && !stdout) {
        // Check if it's just "no matches found"
        if (stderr.includes('No matches found') || stderr.trim() === '') {
          return `No matches found for pattern: ${pattern}`;
        }
        throw new Error(`Search failed: ${stderr}`);
      }

      const lines = stdout.split('\n').filter(line => line.trim());

      if (lines.length === 0) {
        return `No matches found for pattern: ${pattern}`;
      }

      // Parse ripgrep output format: "file:line:content"
      const results: SearchResult[] = [];
      for (const line of lines) {
        const match = line.match(/^([^:]+):(\d+):(.*)$/);
        if (match) {
          const [, file, lineNum, content] = match;
          results.push({
            file: path.relative(process.cwd(), file),
            line: parseInt(lineNum, 10),
            content: content.trim(),
            match: pattern,
          });
        }
      }

      // Limit results
      const limitedResults = results.slice(0, max_results);

      // Format output
      let output = `Found ${results.length} matches for pattern: ${pattern}\n\n`;

      for (const result of limitedResults) {
        output += `${result.file}:${result.line}\n`;
        output += `  ${result.content}\n\n`;
      }

      if (results.length > max_results) {
        output += `... and ${results.length - max_results} more matches\n`;
      }

      return output.trim();
    } catch (error: any) {
      if (error.code === 'ETIMEDOUT') {
        throw new Error(`Search timed out after 30 seconds: ${pattern}`);
      }

      if (error.code === 'ENOENT') {
        throw new Error('ripgrep (rg) is not installed. Please install it to use code search functionality.');
      }

      if (error.stderr) {
        // ripgrep returns exit code 1 when no matches found
        if (error.code === 1 && error.stderr.includes('No matches found')) {
          return `No matches found for pattern: ${pattern}`;
        }
        throw new Error(`Search failed: ${error.stderr}`);
      }

      throw error;
    }
  },
};
