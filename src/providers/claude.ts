/**
 * Claude provider container config — only registered when the user has
 * configured a custom Anthropic-compatible endpoint via setup. Setup
 * appends `import './claude.js'` to providers/index.ts at that point;
 * standard installs hitting api.anthropic.com don't need this file
 * loaded.
 *
 * The real auth token never enters the container. Setup creates an
 * OneCLI generic secret (host-pattern = base URL hostname, header-name
 * = Authorization, value-format = "Bearer {value}") so the proxy
 * rewrites the Authorization header on the wire. The container only
 * needs:
 *   - ANTHROPIC_BASE_URL — so the SDK knows where to call
 *   - ANTHROPIC_AUTH_TOKEN=placeholder — so the SDK adds an
 *     Authorization: Bearer header for OneCLI to overwrite
 */
import { readEnvFile } from '../env.js';
import { registerProviderContainerConfig } from './provider-container-registry.js';

registerProviderContainerConfig('claude', () => {
  const dotenv = readEnvFile(['ANTHROPIC_BASE_URL', 'FIRECRAWL_API_KEY', 'OPENAI_API_KEY']);
  const env: Record<string, string> = {};
  if (dotenv.ANTHROPIC_BASE_URL) {
    env.ANTHROPIC_BASE_URL = dotenv.ANTHROPIC_BASE_URL;
    env.ANTHROPIC_AUTH_TOKEN = 'placeholder';
  }
  // FIRECRAWL_API_KEY — needed by the firecrawl CLI inside the container.
  // We also pin NO_PROXY for api.firecrawl.dev so requests bypass the
  // OneCLI gateway. The gateway has no firecrawl credential type, so it
  // mangles the Authorization header and returns 400 even when the CLI
  // sends a valid Bearer token.
  if (dotenv.FIRECRAWL_API_KEY) {
    env.FIRECRAWL_API_KEY = dotenv.FIRECRAWL_API_KEY;
    env.NO_PROXY = 'api.firecrawl.dev,firecrawl.dev';
    env.no_proxy = 'api.firecrawl.dev,firecrawl.dev';
  }
  // OPENAI_API_KEY — already used by the host-side voice transcription and
  // TTS modules. Also expose to the container so any agent-side tools
  // (e.g. ad-hoc whisper / TTS / embeddings scripts) can authenticate.
  if (dotenv.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = dotenv.OPENAI_API_KEY;
  }
  return { env };
});
