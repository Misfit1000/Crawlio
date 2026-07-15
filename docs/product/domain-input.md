# Audit Domain Input

All audit forms use the shared `normalizeAuditTarget` contract. Inputs are text fields with URL keyboards, not native `type=url` fields, so a bare domain is validated by Crawlio rather than blocked by the browser.

Accepted examples include `example.com`, `www.example.com`, subdomains, paths, query strings, and explicit HTTP or HTTPS URLs. The normalizer trims Unicode whitespace, removes matching wrapping quotes, adds HTTPS when absent, lowercases and IDNA-normalizes the host, removes default ports and fragments, and preserves paths and queries.

Unsupported schemes, embedded credentials, local names, direct private/reserved addresses, and malformed domains are rejected. The submitted input and normalized URL are stored separately. Duplicate prevention, queue creation, reruns, history, and comparison use the normalized URL.
