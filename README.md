# DevPilot AI 🤖

A lightweight CLI coding assistant similar to Claude Code, built from scratch without AI SDKs.
![DevPilot AI]([https://github.com/srikanta30/devpilot-ai/blob/main/devpilot-ai.png](https://github.com/srikanta30/devpilot-ai/blob/main/devpilot-ai.png))


## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- A [Gemini API key](https://aistudio.google.com/apikey)
- ripgrep (for code search): `brew install ripgrep` (macOS) or `apt install ripgrep` (Ubuntu)

### Installation

```bash
# Clone the repository
git clone https://github.com/srikanta30/devpilot-ai
cd devpilot-ai

# Install dependencies
npm install

# Build the project
npm run build

# Make the CLI available globally (optional)
npm link
```

### Usage

```bash
# Start interactive chat
devpilot chat --api-key YOUR_GEMINI_API_KEY
```

## 🔧 Configuration

### Environment Variables

```bash
export GEMINI_API_KEY="your-api-key-here"
```

### CLI Options

```bash
devpilot chat [options]

Options:
  --api-key, -k     Gemini API key (can also be set via GEMINI_API_KEY env var)
  --model, -m       Gemini model to use (default: gemini-2.0-flash-lite)
  --max-tokens      Maximum tokens for response (default: 4096)
  --help, -h        Show help
```

### Contributors:
[Srikanta Banerjee](https://www.linkedin.com/in/srikanta30/])
