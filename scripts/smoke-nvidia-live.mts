import { generateNvidiaCompletion, getNvidiaBlogConfiguration, NvidiaBlogProviderError } from '../src/lib/blog/nvidia';

const config = getNvidiaBlogConfiguration();
if (!process.env.NVIDIA_API_KEY || process.env.NVIDIA_BLOG_ENABLED !== 'true') {
  console.log(`Skipped: credentials not configured (model: ${config.model}).`);
  process.exit(0);
}
const startedAt = Date.now();
try {
  await generateNvidiaCompletion({ system: 'Return JSON only.', user: 'Return {"connected":true}.', temperature: 0, topP: 0.1, maxTokens: 32, maxAttempts: 1, timeoutMs: 15_000 });
  console.log(`success=true safeErrorCode=none model=${config.model} durationMs=${Date.now() - startedAt}`);
} catch (error) {
  const code = error instanceof NvidiaBlogProviderError ? error.code : 'NVIDIA_UNAVAILABLE';
  console.log(`success=false safeErrorCode=${code} model=${config.model} durationMs=${Date.now() - startedAt}`);
  process.exitCode = 1;
}
