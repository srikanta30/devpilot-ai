#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { DevPilotAgent } from './core/agent';
import chalk from 'chalk';

const argv = yargs(hideBin(process.argv))
  .scriptName('devpilot')
  .usage('$0 <cmd> [args]')
  .command(
    'chat',
    'Start an interactive coding session with AI',
    (yargs) => {
      return yargs
        .option('api-key', {
          alias: 'k',
          type: 'string',
          description: 'Gemini API key (can also be set via GEMINI_API_KEY env var)',
        })
        .option('model', {
          alias: 'm',
          type: 'string',
          default: 'models/gemini-2.0-flash-lite',
          description: 'Gemini model to use',
        })
        .option('verbose', {
          alias: 'v',
          type: 'boolean',
          default: false,
          description: 'Enable verbose logging',
        })
        .option('max-tokens', {
          type: 'number',
          default: 4096,
          description: 'Maximum tokens for response',
        });
    },
    async (argv) => {
      const apiKey = argv.apiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error(chalk.red('Error: Gemini API key is required.'));
        console.error(chalk.yellow('Set it via --api-key flag or GEMINI_API_KEY environment variable.'));
        console.error(chalk.blue('Get your API key from: https://aistudio.google.com/apikey'));
        process.exit(1);
      }

      try {
        const agent = new DevPilotAgent({
          apiKey,
          model: argv.model as string,
          verbose: argv.verbose as boolean,
          maxTokens: argv.maxTokens as number,
        });

        await agent.startChat();
      } catch (error) {
        console.error(chalk.red('Error starting DevPilot:'), error);
        process.exit(1);
      }
    }
  )
  .command(
    'init',
    'Initialize a new project with DevPilot',
    (yargs) => {
      return yargs
        .option('template', {
          alias: 't',
          type: 'string',
          description: 'Project template to use',
          choices: ['python-flask', 'python-fastapi', 'react', 'nodejs', 'rust-cli', 'react-native'],
        })
        .option('name', {
          alias: 'n',
          type: 'string',
          description: 'Project name',
        });
    },
    async (argv) => {
      console.log('Initializing new project...');
      // TODO: Implement project initialization
    }
  )
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .alias('h', 'help')
  .alias('v', 'version')
  .argv;
