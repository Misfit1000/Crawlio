// Keep server-rendered public articles visually aligned without loading the React app.
export const BLOG_PUBLIC_THEME_CSS = `
:root{color-scheme:light;--ink:#192127;--muted:#53627b;--line:#dce2e8;--blue:#2859ed;--soft:#f0f3f6;--card:#fff;--page:#f6f7f9;--header:rgba(255,255,255,.96);--link:#2859ed}
body{background:var(--page);color:var(--ink)}
.site-header,header{background:var(--header);border-color:var(--line);backdrop-filter:blur(16px)}
.brand{display:inline-flex;align-items:center;gap:10px;color:var(--ink)}
.brand::before{content:'C';display:grid;place-items:center;width:34px;height:34px;border-radius:8px;background:var(--blue);color:#fff;font-size:16px;font-weight:800}
.audit-link,.article-cta a,.search button{background:var(--blue);color:#fff}
.audit-link:hover,.article-cta a:hover,.search button:hover{filter:brightness(1.08)}
.nav-links a:hover,.topic-link:hover,.article-card h2 a:hover{color:var(--blue)}
.article-card,.empty{border-color:var(--line);background:var(--card);border-radius:8px}
.article-card{box-shadow:0 12px 30px -26px rgba(22,39,76,.34);transition:transform 180ms,border-color 180ms,box-shadow 180ms}
.article-card:hover{transform:translateY(-2px);border-color:var(--blue);box-shadow:0 18px 38px -28px rgba(22,39,76,.46)}
.card-image.fallback{background:var(--soft)}.fallback span{color:var(--ink)}
.topics a.active{border-color:var(--blue);background:var(--blue);color:#fff}
.search input{background:var(--card);color:var(--ink)}
.site-footer{background:var(--soft)}.footer a{color:var(--ink)}
.tagline,.editorial-note,.references span{color:var(--muted)}
.editorial-note,pre{background:var(--soft);border-color:var(--line)}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--blue);outline-offset:3px}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--ink:#edf0f4;--muted:#aeb9c8;--line:#32373e;--blue:#7c9cff;--soft:#16181b;--card:#1b1e22;--page:#121416;--header:rgba(27,30,34,.96);--link:#a4b8ff}.audit-link,.article-cta a,.search button,.topics a.active{color:#0e1728}.article-card{box-shadow:none}a{color:var(--link)}}
@media(prefers-reduced-motion:reduce){.article-card{transition:none}.article-card:hover{transform:none}}
`;
