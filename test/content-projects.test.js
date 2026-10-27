/************************************************
 * routes/content.js — /api/content/projects now serves server/watchRules.js's
 * cached Map; projectsPayload turns it back into { source, items } with the
 * same `source` flag the admin CMS reads. Pure — no Mongo.
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const contentLoader = require('../server/contentLoader');
const { projectsPayload } = require('../routes/content');

test('projectsPayload: Mongo docs → source "db", in the Map\'s order', () => {
  const docs = [{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }];
  const out = projectsPayload(new Map(docs.map(p => [p.id, p])));
  assert.equal(out.source, 'db');
  assert.deepEqual(out.items, docs);
});

test('projectsPayload: the projects.js fallback objects → source "fallback"', () => {
  const fallback = contentLoader.get('projects');
  assert.ok(fallback.length > 0);
  const out = projectsPayload(new Map(fallback.map(p => [p.id, p])));
  assert.equal(out.source, 'fallback');
  assert.equal(out.items.length, new Set(fallback.map(p => p.id)).size);
});

test('projectsPayload: nothing at all → fallback, empty list', () => {
  assert.deepEqual(projectsPayload(new Map()), { source: 'fallback', items: [] });
});
