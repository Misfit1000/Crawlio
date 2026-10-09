import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from 'cheerio';
import sharp from 'sharp';
import { renderScoreBadge, type ScoreBadgeAudit } from './score-badge';

const audit: ScoreBadgeAudit = {
  id: 'private-audit-id', userId: 'private-owner-id', projectId: 'private-project-id',
  status: 'completed', completedAt: '2026-10-01T23:30:00-07:00',
};
const scores = { overall: 81, scoringVersion: '2.2', coverage: { pagesAnalysed: 25, quotaReached: true } };

test('badge uses the persisted score, canonical grade, UTC audit date and honest coverage', () => {
  const svg = renderScoreBadge(audit, scores)!;
  const document = load(svg, { xml: true });
  assert.match(document('title').text(), /Audit result: 81\/100 \(B\)/);
  assert.match(document('title').text(), /Crawlio/);
  assert.match(document('text').first().text(), /Crawlio/);
  assert.match(document('desc').text(), /2026-10-02 \| Score version 2\.2/);
  assert.match(document('desc').text(), /Limited coverage: 25 pages analysed/);
  assert.match(document('desc').text(), /Not a ranking or verification/);
  assert.equal(document('svg').attr('role'), 'img');
  assert.equal(document('svg').attr('aria-labelledby'), 'badge-title badge-description');
  assert.ok(Buffer.byteLength(svg) < 2_000);
  for (const [overall, grade] of [[0, 'F'], [49, 'F'], [50, 'E'], [60, 'D'], [70, 'C'], [80, 'B'], [90, 'A'], [100, 'A']] as const) {
    assert.match(renderScoreBadge(audit, { ...scores, overall })!, new RegExp(`${overall}/100 \\(${grade}\\)`));
  }
  assert.ok(renderScoreBadge({ ...audit, status: 'completed_with_warnings' }, scores));
});

test('usual scores and large bounded metadata fit the branded SVG without clipping or top-row overlap', async () => {
  for (const input of [scores, { ...scores, overall: 0 }, { ...scores, overall: 100 },
    { overall: 99.99999999999999, scoringVersion: '999.999.999', coverage: { pagesAnalysed: 1_000_000 } },
    { overall: 81 }]) {
    const svg = renderScoreBadge(audit, input)!;
    const original = load(svg, { xml: true });
    const width = Number(original('svg').attr('width'));
    const textCount = original('text').length;
    const widths: number[] = [];
    for (let index = 0; index < textCount; index++) {
      // Measure each actual font run on a wide transparent canvas, where intrinsic overflow cannot be clipped away.
      const measurement = load(svg, { xml: true });
      measurement('svg').attr({ width: '2000', viewBox: '0 0 2000 116' });
      measurement('rect,title,desc').remove();
      measurement('text').each((position, element) => { if (position !== index) measurement(element).remove(); });
      measurement('text').attr({ x: '10', 'text-anchor': 'start' });
      const { info } = await sharp(Buffer.from(measurement.xml())).trim().png().toBuffer({ resolveWithObject: true });
      widths.push(info.width);
      assert.ok(info.width <= width - 28, `Text run ${index} requires ${info.width}px, available ${width - 28}px`);
    }
    assert.ok(widths[0] + widths[1] + 20 <= width - 28, 'Brand/label and score overlap');
    const rendered = await sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true });
    assert.equal(rendered.info.width, width);
    assert.equal(rendered.info.height, 116);
  }
});

test('missing, nonnumeric and out-of-range scores never become zero or a badge', () => {
  assert.equal(renderScoreBadge(audit, null), null);
  for (const overall of [undefined, null, '', '81', false, {}, [], NaN, Infinity, -Infinity, -1, 101]) {
    assert.equal(renderScoreBadge(audit, { ...scores, overall }), null);
  }
  for (const status of ['queued', 'running', 'failed', 'cancelled', 'abandoned'] as const) {
    assert.equal(renderScoreBadge({ ...audit, status }, scores), null);
  }
  assert.equal(renderScoreBadge({ ...audit, deletedAt: '2026-10-02T00:00:00Z' }, scores), null);
  for (const completedAt of [null, '', 'invalid', '<script>alert(1)</script>']) {
    assert.equal(renderScoreBadge({ ...audit, completedAt }, scores), null);
  }
  assert.match(renderScoreBadge({ ...audit, completedAt: '1970-01-01T00:00:00Z' }, scores)!, /1970-01-01/);
});

test('SVG is a bounded text-only projection with no private data or active markup', () => {
  const secret = 'private.example.test/token?api_key=secret';
  const attack = `</text><script>alert('x')</script><foreignObject><iframe src="https://${secret}"/></foreignObject>&`;
  const input = { ...scores, scoringVersion: attack, summary: secret, limitations: [attack],
    deductions: [{ evidence: secret }], coverage: { pagesAnalysed: attack },
    pages: [{ url: secret }], exports: { json: secret }, hostname: secret };
  const svg = renderScoreBadge({ ...audit, hostname: secret } as ScoreBadgeAudit, input)!;
  assert.match(svg, /Score version unknown/);
  assert.match(svg, /Limited coverage/);
  for (const privateText of [secret, audit.id, audit.userId!, audit.projectId!, attack]) assert.ok(!svg.includes(privateText));
  const document = load(svg, { xml: true });
  const tags = new Set(['svg', 'title', 'desc', 'rect', 'g', 'text']);
  document('*').each((_index, element) => {
    if (!('tagName' in element) || !('attribs' in element)) assert.fail('Unexpected XML node');
    assert.ok(tags.has(element.tagName));
    for (const [name, value] of Object.entries(element.attribs)) {
      assert.ok(!/^on|href|style/i.test(name));
      assert.ok(!/url\(|javascript:|data:|https?:/i.test(value) || (name === 'xmlns' && value === 'http://www.w3.org/2000/svg'));
    }
  });
  assert.ok(!/<!DOCTYPE|<!ENTITY|<script|foreignObject|<image|<use|<a\b|<animate|<style/i.test(svg));
  assert.ok(Buffer.byteLength(svg) < 2_000);
  for (const scoringVersion of [undefined, null, 2.2, 'x'.repeat(100_000), secret]) {
    assert.match(renderScoreBadge(audit, { ...scores, scoringVersion })!, /Score version unknown/);
  }
  for (const pagesAnalysed of [-1, 1.5, NaN, Infinity, '25', 1_000_001, null]) {
    const result = renderScoreBadge(audit, { ...scores, coverage: { pagesAnalysed } })!;
    assert.ok(!result.includes('pages analysed'));
  }
  assert.match(renderScoreBadge(audit, { ...scores, coverage: { pagesAnalysed: 1 } })!, /1 page analysed/);
});
