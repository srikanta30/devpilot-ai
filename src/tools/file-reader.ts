import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../types';

export const fileReaderTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file. Use this when you need to see what\'s inside a file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to the file to read',
      },
      start_line: {
        type: 'number',
        description: 'Optional: Start reading from this line number (1-indexed)',
      },
      end_line: {
        type: 'number',
        description: 'Optional: Stop reading at this line number (1-indexed)',
      },
    },
    required: ['path'],
  },
  function: async (args: { path: string; start_line?: number; end_line?: number }): Promise<string> => {
    try {
      const filePath = path.resolve(args.path);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${args.path}`);
      }

      // Check if it's actually a file
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${args.path}`);
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Handle line range selection
      if (args.start_line || args.end_line) {
        const start = (args.start_line || 1) - 1; // Convert to 0-indexed
        const end = args.end_line || lines.length;

        if (start < 0 || start >= lines.length || end < start || end > lines.length) {
          throw new Error(`Invalid line range: ${args.start_line}-${args.end_line} for file with ${lines.length} lines`);
        }

        const selectedLines = lines.slice(start, end);
        return selectedLines.join('\n');
      }

      return content;
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied reading file: ${args.path}`);
      }
      if (error.code === 'ENOTDIR') {
        throw new Error(`Path component is not a directory: ${args.path}`);
      }
      throw error;
    }
  },
};
