const ACRONYMS: Record<string, string> = {
  api: 'API',
  coop: 'COOP',
  coep: 'COEP',
  corp: 'CORP',
  cors: 'CORS',
  csp: 'CSP',
  csrf: 'CSRF',
  db: 'database',
  dkim: 'DKIM',
  dmarc: 'DMARC',
  git: 'Git',
  hsts: 'HSTS',
  http: 'HTTP',
  httponly: 'HttpOnly',
  https: 'HTTPS',
  jquery: 'jQuery',
  js: 'JavaScript',
  json: 'JSON',
  php: 'PHP',
  phpinfo: 'PHP information page',
  samesite: 'SameSite',
  spf: 'SPF',
  txt: 'TXT',
  url: 'URL',
  wp: 'WordPress',
};

const COPY: Record<string, { title: string; description: string; recommendation: string }> = {
  'https-enabled': {
    title: 'HTTPS is not enabled',
    description: 'The page did not complete over an encrypted HTTPS connection.',
    recommendation: 'Install a valid TLS certificate, serve the site over HTTPS, and update internal links to use the secure address.',
  },
  'http-redirects': {
    title: 'HTTP does not redirect to HTTPS',
    description: 'The unsecured HTTP address does not consistently send visitors to the HTTPS version.',
    recommendation: 'Add a permanent server-side redirect from every HTTP URL to its HTTPS equivalent.',
  },
  'mixed-content': {
    title: 'Secure page loads insecure content',
    description: 'An HTTPS page refers to at least one resource over an unsecured HTTP connection.',
    recommendation: 'Update each insecure resource URL to HTTPS or remove the resource when no secure version is available.',
  },
  'missing-hsts': {
    title: 'HSTS protection is missing',
    description: 'The HTTPS response does not tell supported browsers to keep using encrypted connections for future visits.',
    recommendation: 'Add a Strict-Transport-Security header after confirming the entire site and required subdomains work over HTTPS.',
  },
  'missing-csp': {
    title: 'Content Security Policy is missing',
    description: 'The response does not define which sources the browser may use for scripts, styles, images, and other content.',
    recommendation: 'Introduce a restrictive Content-Security-Policy, test it in report-only mode, then enforce the validated policy.',
  },
  'missing-frame-options': {
    title: 'Frame protection is missing',
    description: 'The response does not clearly restrict whether another website may embed this page in a frame.',
    recommendation: 'Set an appropriate CSP frame-ancestors directive and retain X-Frame-Options where older-browser support is required.',
  },
  'missing-content-type-options': {
    title: 'Content-type sniffing protection is missing',
    description: 'The response does not include X-Content-Type-Options: nosniff.',
    recommendation: 'Return X-Content-Type-Options: nosniff and ensure every asset has the correct Content-Type header.',
  },
  'missing-referrer-policy': {
    title: 'Referrer Policy is missing',
    description: 'The response does not define how much referring-page information a browser may send to another address.',
    recommendation: 'Set a Referrer-Policy that matches the site requirements; strict-origin-when-cross-origin is a common baseline.',
  },
  'cookie-missing-secure': {
    title: 'Cookie can be sent without HTTPS',
    description: 'A response cookie does not use the Secure attribute, so a browser may send it over an unencrypted connection.',
    recommendation: 'Add the Secure attribute to cookies that should only travel over HTTPS.',
  },
  'cookie-missing-httponly': {
    title: 'Cookie is accessible to page scripts',
    description: 'A response cookie does not use HttpOnly, allowing browser scripts to read it.',
    recommendation: 'Add HttpOnly to session and other sensitive cookies that do not need JavaScript access.',
  },
  'cookie-missing-samesite': {
    title: 'Cookie has no SameSite policy',
    description: 'A response cookie does not state when it may be sent with cross-site requests.',
    recommendation: 'Set SameSite=Lax or SameSite=Strict unless a documented cross-site flow requires SameSite=None with Secure.',
  },
  'cors-wildcard-credentials': {
    title: 'Credentialed CORS policy is too broad',
    description: 'The cross-origin response combines credential access with an origin policy that may trust more sites than intended.',
    recommendation: 'Allow only explicitly trusted origins and validate the Origin header before enabling credentialed cross-origin requests.',
  },
  'error-stack-trace': {
    title: 'A public error exposes stack details',
    description: 'The returned page contains implementation details that resemble an application stack trace.',
    recommendation: 'Show a generic customer error and keep stack traces in protected server logs.',
  },
  'public-env-file': {
    title: 'Environment file may be publicly accessible',
    description: 'A common environment-file location returned content instead of a clear not-found or forbidden response.',
    recommendation: 'Remove environment files from the public web root and deny requests for configuration and secret files at the server.',
  },
  'public-git-head': {
    title: 'Git metadata may be publicly accessible',
    description: 'A common Git metadata path returned content instead of a clear not-found or forbidden response.',
    recommendation: 'Remove the .git directory from deployed files and block all requests to version-control metadata.',
  },
  'public-source-maps': {
    title: 'Production source maps are publicly accessible',
    description: 'A public source map may reveal original source structure, comments, and local path information.',
    recommendation: 'Disable public production source maps or upload them only to a protected error-monitoring service.',
  },
  'trace-method-enabled': {
    title: 'HTTP TRACE method is enabled',
    description: 'The server appears to accept TRACE requests, which are rarely required by public websites.',
    recommendation: 'Disable TRACE at the web server or edge proxy unless a documented operational dependency requires it.',
  },
};

function words(id: string) {
  return id.split('-').map((word) => ACRONYMS[word] || word).join(' ');
}

function sentence(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function titleFor(id: string) {
  if (id.startsWith('missing-')) return `${sentence(words(id.slice(8)))} is missing`;
  if (id.startsWith('public-')) return `${sentence(words(id.slice(7)))} may be publicly accessible`;
  if (id.endsWith('-exposed')) return `${sentence(words(id.slice(0, -8)))} is exposed`;
  if (id.endsWith('-detected')) return `${sentence(words(id.slice(0, -9)))} detected`;
  if (id.includes('permissive')) return `${sentence(words(id.replace('-permissive', '')))} is too permissive`;
  if (id.includes('wildcard')) return `${sentence(words(id))} allows a wildcard`;
  if (id.includes('unsafe')) return `${sentence(words(id))} weakens browser protection`;
  return sentence(words(id));
}

function descriptionFor(id: string, title: string) {
  const subject = title.replace(/ is missing| may be publicly accessible| is exposed| detected$/i, '').toLowerCase();
  if (id.startsWith('missing-')) return `The public response does not include ${subject}.`;
  if (id.startsWith('public-') || id.includes('exposed')) return `The audit found public evidence of ${subject}.`;
  if (id.includes('permissive') || id.includes('wildcard') || id.includes('broad')) return `The observed ${subject} accepts a wider scope than most public pages require.`;
  if (id.includes('unsafe') || id.includes('dangerous')) return `The page contains ${subject}, which reduces the protection provided by browser security controls.`;
  if (id.includes('old-version') || id.includes('outdated')) return `The page identifies a potentially outdated version of ${subject}.`;
  return `The audit observed ${subject} in the public page or response data.`;
}

function recommendationFor(id: string, title: string) {
  const subject = title.replace(/ is missing| may be publicly accessible| is exposed| detected$/i, '').toLowerCase();
  if (id.startsWith('missing-')) return `Configure ${subject} where it is appropriate, then verify the response after deployment.`;
  if (id.startsWith('public-') || id.includes('exposed')) return `Remove public access to ${subject} and confirm the address returns a not-found or forbidden response.`;
  if (id.includes('permissive') || id.includes('wildcard') || id.includes('broad')) return `Restrict ${subject} to the smallest set of trusted origins, values, or capabilities the site needs.`;
  if (id.includes('unsafe') || id.includes('dangerous')) return `Remove or replace ${subject}, then test that the affected page still works without the unsafe behavior.`;
  if (id.includes('old-version') || id.includes('outdated')) return `Confirm the detected version, upgrade ${subject} to a supported release, and retest dependent pages.`;
  return `Review ${subject}, confirm whether it is intentional, and restrict or remove it when the site does not require it.`;
}

export function securityCheckCopy(id: string) {
  const exact = COPY[id];
  if (exact) return exact;
  const title = titleFor(id);
  return {
    title,
    description: descriptionFor(id, title),
    recommendation: recommendationFor(id, title),
  };
}
