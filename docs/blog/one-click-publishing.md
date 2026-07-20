# One-click publishing

Blog Studio presents **Research, write and publish** as the default workflow. The administrator does not choose a topic, copy source details, build internal links, or fill search metadata.

The server combines enabled approved feeds with a small built-in set of official Google Search Central, Google crawler documentation, and web.dev feeds. It selects one recent, relevant, authoritative item that is not already covered. If no item passes those checks, it publishes nothing and records a safe explanation.

The selected source is fetched through the existing bounded public-fetch controls. Groq generates the article and metadata in durable Vercel stages. The server completes missing source and Crawlio links deterministically, renders the initial article HTML, and evaluates substance, headings, source metadata, citations, originality signals, links, and claim support.

The article is published only when every critical gate passes. A failed gate leaves a private review draft instead of publishing partial or unsupported content. Publication pauses and provider readiness are enforced by the server even when the browser control is bypassed.

Manual topics, custom headlines, batches, source management, scheduling, trend review, fixture tests, and rollout controls remain under **Advanced content controls**.
