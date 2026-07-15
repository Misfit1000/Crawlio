# Audit Scoring

Crawlio starts measured categories at 100 and applies deterministic deductions from deduplicated findings. A deduction considers severity, affected-page reach, whether the issue is site-wide, and whether it blocks technical delivery or crawlability. Derived response-status, redirect, slow-response, and large-HTML observations can also deduct from the relevant measured category.

Severity base points are critical 22, high 13, medium 6, low 2, and informational 0. Reach and category multipliers are bounded; each category remains between 0 and 100. The overall score is the equal average of categories actually measured by the current audit.

Plan page limits do not affect scores. A healthy one-page audit can score 100. Unavailable mobile/browser-rendered data, rankings, backlinks, traffic, search volume, Lighthouse, and field Core Web Vitals are unscored and cannot reduce the result.

Final report data includes category scores, grade, deductions, measured checks, unavailable checks, and limitations so the number can be explained and tested.
