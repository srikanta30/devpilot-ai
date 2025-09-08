import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../types';

export const fileExplorerTool: ToolDefinition = {
  name: 'list_files',
  description: 'List files and directories in a given path recursively. Automatically excludes build files and dependencies.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The relative path to list files from. Defaults to current directory if not provided.',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list files recursively. Defaults to true.',
      },
      max_depth: {
        type: 'number',
        description: 'Maximum depth for recursive listing. Defaults to 5.',
      },
    },
  },
  function: async (args: { path?: string; recursive?: boolean; max_depth?: number }): Promise<string> => {
    try {
      const targetPath = args.path ? path.resolve(args.path) : process.cwd();
      const recursive = args.recursive !== false; // Default to true
      const maxDepth = args.max_depth || 5;

      // Define patterns for build files and dependencies to exclude
      const excludePatterns = [
        'node_modules',
        'dist',
        'build',
        '__pycache__',
        '.git',
        '.vscode',
        '.idea',
        'coverage',
        '.nyc_output',
        'target', // Rust
        'vendor', // Go
        '.next', // Next.js
        '.nuxt', // Nuxt.js
        'out', // Next.js static export
        '.cache',
        'tmp',
        'temp',
        '.DS_Store',
        'Thumbs.db',
        '*.pyc',
        '*.pyo',
        '*.pyd',
        '*.so',
        '*.dylib',
        '*.dll',
        '*.exe',
        '*.o',
        '*.a',
        '*.lib',
        '*.dll',
        '*.so',
        '*.dylib',
        '*.jar',
        '*.war',
        '*.ear',
        '*.class',
        '*.log',
        '*.tmp',
        '*.temp',
        '*.swp',
        '*.swo',
        '*~',
        '.env.local',
        '.env.development.local',
        '.env.test.local',
        '.env.production.local',
      ];

      // Function to check if a path should be excluded
      const shouldExclude = (filePath: string, fileName: string): boolean => {
        const relativePath = path.relative(process.cwd(), filePath);
        
        // Check against exclude patterns
        for (const pattern of excludePatterns) {
          if (pattern.includes('*')) {
            // Handle wildcard patterns
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            if (regex.test(fileName) || regex.test(relativePath)) {
              return true;
            }
          } else {
            // Handle exact matches
            if (fileName === pattern || relativePath.includes(`/${pattern}/`) || relativePath.startsWith(`${pattern}/`)) {
              return true;
            }
          }
        }
        
        return false;
      };

      if (!fs.existsSync(targetPath)) {
        throw new Error(`Path not found: ${args.path || '.'}`);
      }

      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        // If it's a file, just return the file info
        return JSON.stringify([{
          name: path.basename(targetPath),
          type: 'file',
          path: path.relative(process.cwd(), targetPath),
          size: stats.size,
          modified: stats.mtime.toISOString(),
        }], null, 2);
      }

      const items: Array<{
        name: string;
        type: 'file' | 'directory';
        path: string;
        size?: number;
        modified?: string;
      }> = [];

      const readDirectory = (dirPath: string, currentDepth: number = 0): void => {
        if (currentDepth > maxDepth) return;

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          // Skip excluded files and directories
          if (shouldExclude(fullPath, entry.name)) {
            continue;
          }

          // Skip hidden files/directories unless explicitly requested
          if (entry.name.startsWith('.') && !args.path?.includes('.')) {
            continue;
          }

          const relativePath = path.relative(process.cwd(), fullPath);

          try {
            const entryStats = fs.statSync(fullPath);
            const item: {
              name: string;
              type: 'file' | 'directory';
              path: string;
              size?: number;
              modified: string;
            } = {
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
              path: relativePath,
              modified: entryStats.mtime.toISOString(),
            };

            if (entry.isFile()) {
              item.size = entryStats.size;
            }

            items.push(item);

            // Recursively read directories if requested
            if (recursive && entry.isDirectory() && currentDepth < maxDepth) {
              readDirectory(fullPath, currentDepth + 1);
            }
          } catch (error) {
            // Skip files we can't access
            continue;
          }
        }
      }

      readDirectory(targetPath);

      // Sort: directories first, then files, alphabetically
      items.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return JSON.stringify(items, null, 2);
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied accessing directory: ${args.path || '.'}`);
      }
      if (error.code === 'ENOTDIR') {
        throw new Error(`Path is not a directory: ${args.path || '.'}`);
      }
      throw error;
    }
  },
};
