import {
  PublicFetchError,
  SafePublicFetchOptions,
  SafePublicResponse,
  parsePublicHttpUrl,
  isIP,
  isPrivateOrReservedAddress
} from './ssrf-shared';

function contentTypeAllowed(contentType: string, allowed: string[]) {
  if (!allowed.length) return true;
  const normalized = contentType.toLowerCase().split(';')[0].trim();
  return allowed.some((item) => normalized === item || normalized.endsWith(`+${item.replace(/^application\//, '')}`));
}

export async function cloudflarePublicFetch(value: string, input: SafePublicFetchOptions = {}): Promise<SafePublicResponse> {
  const options: Required<SafePublicFetchOptions> = {
    method: input.method ?? 'GET',
    timeoutMs: input.timeoutMs ?? 8_000,
    dnsTimeoutMs: input.dnsTimeoutMs ?? 3_000,
    maxRedirects: input.maxRedirects ?? 5,
    maxBytes: input.maxBytes ?? 2_000_000,
    allowedContentTypes: input.allowedContentTypes ?? ['text/html', 'application/xhtml+xml'],
    allowMissingContentType: input.allowMissingContentType ?? false,
    userAgent: input.userAgent ?? 'CrawlioBot/1.0 (+https://keywordsintel.vercel.app/)',
    allowPrivateForTesting: input.allowPrivateForTesting ?? false,
    allowNonStandardPortsForTesting: input.allowNonStandardPortsForTesting ?? false,
    returnBuffer: input.returnBuffer ?? false,
  };

  const requestedUrl = parsePublicHttpUrl(value, options).toString();
  const startedAt = Date.now();
  let current = parsePublicHttpUrl(requestedUrl, options);
  const seen = new Set<string>();

  for (let redirectCount = 0; redirectCount <= options.maxRedirects; redirectCount += 1) {
    if (seen.has(current.toString())) {
      throw new PublicFetchError('REDIRECT_LOOP', 'A redirect loop was detected.');
    }
    seen.add(current.toString());

    const hostname = current.hostname.startsWith('[') && current.hostname.endsWith(']')
      ? current.hostname.slice(1, -1)
      : current.hostname;

    if (isIP(hostname)) {
      if (!options.allowPrivateForTesting && isPrivateOrReservedAddress(hostname)) {
        if (redirectCount > 0) {
          throw new PublicFetchError('UNSAFE_REDIRECT_TARGET', 'Private, local, reserved, and metadata-network targets cannot be audited.');
        }
        throw new PublicFetchError('PRIVATE_NETWORK_TARGET', 'Private, local, reserved, and metadata-network targets cannot be audited.');
      }
    }

    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      response = await fetch(current.toString(), {
        method: options.method,
        headers: {
          'User-Agent': options.userAgent,
          'Accept': options.allowedContentTypes.includes('text/html') ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' : '*/*',
        },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new PublicFetchError('CONNECTION_TIMEOUT', `Request timed out after ${options.timeoutMs}ms.`);
      }
      throw new PublicFetchError('REQUEST_FAILED', error.message || 'Request failed');
    } finally {
      clearTimeout(timeoutId);
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((val, key) => {
      headers[key.toLowerCase()] = val;
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = headers['location'];
      if (!location) throw new PublicFetchError('REDIRECT_WITHOUT_LOCATION', 'The server returned a redirect without a destination.');
      if (redirectCount >= options.maxRedirects) throw new PublicFetchError('TOO_MANY_REDIRECTS', 'The response exceeded the redirect limit.');
      
      try {
        current = parsePublicHttpUrl(new URL(location, current).toString(), options);
      } catch (error) {
        if (error instanceof PublicFetchError && error.code === 'PRIVATE_NETWORK_TARGET') {
          throw new PublicFetchError('UNSAFE_REDIRECT_TARGET', error.message);
        }
        throw new PublicFetchError('INVALID_REDIRECT_TARGET', error instanceof Error ? error.message : 'Invalid redirect target.');
      }
      continue;
    }

    const contentType = headers['content-type'] || '';
    if (
      !(options.allowMissingContentType && !contentType) &&
      !contentTypeAllowed(contentType, options.allowedContentTypes)
    ) {
      throw new PublicFetchError('UNSUPPORTED_CONTENT_TYPE', `Unsupported response content type: ${contentType || 'unknown'}.`);
    }

    let bodyBytes = 0;
    const chunks: Uint8Array[] = [];
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            bodyBytes += value.length;
            if (bodyBytes > options.maxBytes) {
              reader.cancel();
              throw new PublicFetchError('RESPONSE_TOO_LARGE', `Response exceeded the ${options.maxBytes}-byte analysis limit.`);
            }
            chunks.push(value);
          }
        }
      } catch (error) {
        if (error instanceof PublicFetchError) throw error;
        throw new PublicFetchError('REQUEST_FAILED', 'Failed to read response body');
      }
    }

    const totalBuffer = new Uint8Array(bodyBytes);
    let offset = 0;
    for (const chunk of chunks) {
      totalBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    let body = '';
    if (!options.returnBuffer) {
      const decoder = new TextDecoder('utf-8');
      body = decoder.decode(totalBuffer);
    }

    return {
      requestedUrl,
      finalUrl: current.toString(),
      status: response.status,
      headers,
      contentType,
      body,
      ...(options.returnBuffer ? { bodyBuffer: totalBuffer } : {}),
      bodyBytes,
      redirectCount,
      durationMs: Date.now() - startedAt,
    };
  }

  throw new PublicFetchError('TOO_MANY_REDIRECTS', 'The response exceeded the redirect limit.');
}
