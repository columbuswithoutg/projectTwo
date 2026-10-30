/************************************************
 * Admin Dialogues editor (js/views/admin/cms-dialogues.js), ADM2-10:
 * switching section must not drop an open pair form with unapplied edits.
 * _settlePairForm() applies them first; if Apply refuses, it asks before
 * discarding, and "Keep editing" cancels the switch.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'views', 'admin', 'cms-dialogues.js'), 'utf8');

function load(answer) {
  const asked = [];
  const ctx = {
    AdminView: { _escapeHtml: (s) => String(s), _cms: {}, toast() {} },
    confirmDialog: async (opts) => { asked.push(opts); return answer; }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { Editor: ctx.AdminView._cms.dialogues, asked };
}

// A pair form stand-in: dirty until a successful apply (which, like the
// real Apply, re-renders the list and so clears Editor._pairForm).
function form(Editor, { dirty = true, applies = true } = {}) {
  const f = {
    applied: 0,
    isDirty: () => dirty,
    apply() { f.applied++; if (applies) Editor._pairForm = null; }
  };
  Editor._pairForm = f;
  return f;
}

test('no open pair form, or a clean one: the switch goes ahead without asking', async () => {
  const { Editor, asked } = load(false);
  Editor._pairForm = null;
  assert.equal(await Editor._settlePairForm(), true);
  const f = form(Editor, { dirty: false });
  assert.equal(await Editor._settlePairForm(), true);
  assert.equal(f.applied, 0);
  assert.equal(asked.length, 0);
});

test('dirty pair form that applies: edits are applied, no prompt', async () => {
  const { Editor, asked } = load(false);
  const f = form(Editor, { applies: true });
  assert.equal(await Editor._settlePairForm(), true);
  assert.equal(f.applied, 1);
  assert.equal(asked.length, 0);
});

test('dirty pair form Apply refuses: "Keep editing" cancels the switch and keeps the form', async () => {
  const { Editor, asked } = load(false);
  const f = form(Editor, { applies: false });
  assert.equal(await Editor._settlePairForm(), false);
  assert.equal(asked.length, 1);
  assert.equal(Editor._pairForm, f);
});

test('dirty pair form Apply refuses: "Discard" lets the switch go ahead', async () => {
  const { Editor, asked } = load(true);
  form(Editor, { applies: false });
  assert.equal(await Editor._settlePairForm(), true);
  assert.equal(asked.length, 1);
  assert.equal(Editor._pairForm, null);
});
