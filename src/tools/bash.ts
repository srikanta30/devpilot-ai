import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition } from '../types';

const execAsync = promisify(exec);

// Helper function to make commands non-interactive
function makeCommandNonInteractive(command: string): string {
  const cmd = command.trim();
  
  // Handle npm/npx commands
  if (cmd.includes('npx create-next-app') || cmd.includes('npm create next-app')) {
    if (!cmd.includes('--yes') && !cmd.includes('-y')) {
      return `${cmd} --yes`;
    }
  }
  
  if (cmd.includes('npx create-react-app')) {
    if (!cmd.includes('--yes') && !cmd.includes('-y')) {
      return `${cmd} --yes`;
    }
  }
  
  if (cmd.includes('npm install') || cmd.includes('npm i')) {
    if (!cmd.includes('--yes') && !cmd.includes('-y')) {
      return `${cmd} --yes`;
    }
  }
  
  // Handle yarn commands
  if (cmd.includes('yarn create') || cmd.includes('yarn add')) {
    if (!cmd.includes('--yes') && !cmd.includes('-y')) {
      return `${cmd} --yes`;
    }
  }
  
  // Handle git commands that might prompt
  if (cmd.includes('git clone') && !cmd.includes('--quiet')) {
    return `${cmd} --quiet`;
  }
  
  // Handle apt/package manager commands
  if (cmd.includes('apt install') || cmd.includes('apt-get install')) {
    if (!cmd.includes('-y')) {
      return `${cmd} -y`;
    }
  }
  
  // Handle brew commands
  if (cmd.includes('brew install')) {
    return `HOMEBREW_NO_INSTALL_CLEANUP=1 ${cmd}`;
  }
  
  return cmd;
}

export const bashTool: ToolDefinition = {
  name: 'bash',
  description: 'Execute bash commands and return their output. Use this for running shell commands, installing packages, or performing system operations.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory for the command. Defaults to current directory.',
      },
      timeout: {
        type: 'number',
        description: 'Optional timeout in milliseconds. Defaults to 300000 (5 minutes).',
      },
      background: {
        type: 'boolean',
        description: 'Whether to run the command in background. Defaults to false.',
      },
      nonInteractive: {
        type: 'boolean',
        description: 'Whether to run in non-interactive mode (auto-answer prompts). Defaults to true.',
      },
      streaming: {
        type: 'boolean',
        description: 'Whether to use streaming output for long-running commands. Defaults to false.',
      },
    },
    required: ['command'],
  },
  function: async (args: {
    command: string;
    cwd?: string;
    timeout?: number;
    background?: boolean;
    nonInteractive?: boolean;
    streaming?: boolean;
  }): Promise<string> => {
    const { command, cwd, timeout = 300000, background = false, nonInteractive = true, streaming = false } = args;

    // Safety checks
    if (!command || command.trim() === '') {
      throw new Error('Command cannot be empty');
    }

    // Basic safety filtering - prevent destructive commands
    const dangerousCommands = [
      'rm -rf /',
      'rm -rf /*',
      'dd if=',
      'mkfs',
      'fdisk',
      'format',
      'del /',
      'deltree',
      'shutdown',
      'reboot',
      'halt',
      'poweroff',
      'init 0',
      'init 6',
    ];

    const normalizedCommand = command.toLowerCase().trim();
    for (const dangerous of dangerousCommands) {
      if (normalizedCommand.includes(dangerous)) {
        throw new Error(`Command contains potentially dangerous operation: ${dangerous}`);
      }
    }

    // Additional safety: prevent commands that could delete user data
    if (normalizedCommand.includes('rm -rf') && (normalizedCommand.includes('~') || normalizedCommand.includes('/home'))) {
      throw new Error('Command contains potentially destructive rm -rf operation on user directories');
    }

    // Modify command for non-interactive mode if needed
    let finalCommand = command;
    if (nonInteractive) {
      finalCommand = makeCommandNonInteractive(command);
    }

    // Show the command being executed
    let executionInfo = `🔧 Executing: ${finalCommand}`;
    if (finalCommand !== command) {
      executionInfo += `\n   (Modified from: ${command})`;
    }
    if (cwd && cwd !== process.cwd()) {
      executionInfo += `\n   Working directory: ${cwd}`;
    }

    const options: any = {
      cwd: cwd || process.cwd(),
      timeout,
      maxBuffer: 1024 * 1024 * 50, // 50MB buffer for large outputs
      env: {
        ...process.env,
        // Set environment variables for non-interactive mode
        DEBIAN_FRONTEND: 'noninteractive',
        CI: 'true',
        FORCE_COLOR: '0',
      },
    };

    try {
      if (background) {
        // For background commands, use spawn
        const child = spawn('bash', ['-c', finalCommand], {
          ...options,
          detached: true,
          stdio: 'ignore',
        });

        child.unref();

        return `${executionInfo}\n\n📋 Result: Command started in background with PID: ${child.pid}`;
      } else if (streaming) {
        // For streaming commands, use spawn with real-time output
        return new Promise((resolve, reject) => {
          const child = spawn('bash', ['-c', finalCommand], {
            cwd: options.cwd,
            env: options.env,
          });

          let stdout = '';
          let stderr = '';
          let combinedOutput = '';

          child.stdout?.on('data', (data) => {
            const chunk = data.toString();
            stdout += chunk;
            combinedOutput += `STDOUT: ${chunk}`;
          });

          child.stderr?.on('data', (data) => {
            const chunk = data.toString();
            stderr += chunk;
            combinedOutput += `STDERR: ${chunk}`;
          });

          child.on('close', (code) => {
            let result = '';
            if (stdout) {
              result += `STDOUT:\n${stdout}`;
            }
            if (stderr) {
              if (result) result += '\n';
              result += `STDERR:\n${stderr}`;
            }
            if (!result) {
              result = 'Command executed successfully (no output)';
            }
            
            const finalResult = `${executionInfo}\n\n📋 Result:\n${result}`;
            
            if (code === 0) {
              resolve(finalResult);
            } else {
              resolve(`${executionInfo}\n\n❌ Command failed with exit code ${code}\n\n📋 Output:\n${result}`);
            }
          });

          child.on('error', (error) => {
            reject(new Error(`Failed to execute command: ${error.message}`));
          });

          // Handle timeout
          const timeoutId = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Command timed out after ${timeout}ms: ${finalCommand}`));
          }, timeout);

          child.on('close', () => {
            clearTimeout(timeoutId);
          });
        });
      } else {
        // For regular commands, use exec
        const { stdout, stderr } = await execAsync(finalCommand, options);

        let result = '';

        if (stdout) {
          result += `STDOUT:\n${stdout}`;
        }

        if (stderr) {
          if (result) result += '\n';
          result += `STDERR:\n${stderr}`;
        }

        if (!result) {
          result = 'Command executed successfully (no output)';
        }

        return `${executionInfo}\n\n📋 Result:\n${result}`;
      }
    } catch (error: any) {
      if (error.code === 'ETIMEDOUT') {
        throw new Error(`Command timed out after ${timeout}ms: ${finalCommand}`);
      }

      if (error.code === 'ENOTFOUND') {
        throw new Error(`Command not found: ${finalCommand.split(' ')[0]}`);
      }

      if (error.code === 'EACCES') {
        throw new Error(`Permission denied executing command: ${finalCommand}`);
      }

      // Return both stdout and stderr for debugging
      let errorMessage = `Command failed with exit code ${error.code || 'unknown'}`;

      if (error.stdout) {
        errorMessage += `\nSTDOUT: ${error.stdout}`;
      }

      if (error.stderr) {
        errorMessage += `\nSTDERR: ${error.stderr}`;
      }

      return `${executionInfo}\n\n❌ Error:\n${errorMessage}`;
    }
  },
};
