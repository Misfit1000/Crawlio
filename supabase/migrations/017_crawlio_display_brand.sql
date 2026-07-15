begin;

update public.platform_settings
set platform_name = 'Crawlio',
    updated_at = now()
where lower(trim(platform_name)) in ('seointel', 'seo intel', 'seointel audit', 'seo intel audit', 'keywordsintel', 'keywords intel');

commit;
