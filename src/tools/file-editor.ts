import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../types';

export const fileEditorTool: ToolDefinition = {
  name: 'edit_file',
  description: 'Make edits to text files using search and replace operations. Supports creating new files and modifying existing ones.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The text to search for and replace. Must match exactly and uniquely.',
      },
      new_string: {
        type: 'string',
        description: 'The text to replace old_string with',
      },
      create_dirs: {
        type: 'boolean',
        description: 'Whether to create parent directories if they don\'t exist. Defaults to true.',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  function: async (args: {
    path: string;
    old_string: string;
    new_string: string;
    create_dirs?: boolean;
  }): Promise<string> => {
    const { path: filePath, old_string, new_string, create_dirs = true } = args;

    try {
      const fullPath = path.resolve(filePath);
      const dirPath = path.dirname(fullPath);

      // Create directories if needed
      if (create_dirs && !fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      let content: string;
      let isNewFile = false;

      // Read existing file or prepare for new file
      if (fs.existsSync(fullPath)) {
        content = fs.readFileSync(fullPath, 'utf-8');
      } else {
        // New file creation
        if (old_string !== '') {
          throw new Error('For new files, old_string must be empty');
        }
        content = '';
        isNewFile = true;
      }

      let newContent: string;

      if (isNewFile) {
        // Creating a new file
        newContent = new_string;
      } else {
        // Editing existing file
        const oldStringCount = (content.match(new RegExp(old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

        if (oldStringCount === 0) {
          throw new Error(`The text "${old_string}" was not found in the file`);
        }

        if (oldStringCount > 1) {
          // Try to find unique matches with more context
          const lines = content.split('\n');
          const matches: Array<{ line: number; index: number }> = [];

          for (let i = 0; i < lines.length; i++) {
            const lineIndex = lines[i].indexOf(old_string);
            if (lineIndex !== -1) {
              matches.push({ line: i + 1, index: lineIndex });
            }
          }

          if (matches.length > 1) {
            const matchDetails = matches.map(m => `line ${m.line}`).join(', ');
            throw new Error(`The text "${old_string}" appears ${oldStringCount} times in the file at ${matchDetails}. Please provide more context to make it unique.`);
          }
        }

        // Perform the replacement
        newContent = content.replace(old_string, new_string);
      }

      // Write the file
      fs.writeFileSync(fullPath, newContent, 'utf-8');

      const action = isNewFile ? 'created' : 'edited';
      const stats = fs.statSync(fullPath);

      return `Successfully ${action} file "${filePath}" (${newContent.length} characters, ${stats.size} bytes)`;
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied editing file: ${filePath}`);
      }
      if (error.code === 'ENOTDIR') {
        throw new Error(`Parent path is not a directory: ${path.dirname(filePath)}`);
      }
      if (error.code === 'EISDIR') {
        throw new Error(`Cannot edit directory as file: ${filePath}`);
      }
      throw error;
    }
  },
};
