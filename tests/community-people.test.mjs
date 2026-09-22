// Render contract for src/components/CommunityPeople/index.js.
//
// The component bakes `@site/data/community-people.json` in at module scope
// and keeps the open/closed state of each profile dialog in local state, so
// neither `PersonCard` nor `PersonDialog` is reachable as an export. Both are
// recovered from the element tree the exported component returns and then
// driven through React's hook dispatcher, which is the only way to reach the
// conditional rendering inside them.
//
// The dispatcher is deliberately local to this file rather than an extension
// of ./tools/react-hook-driver.mjs: it collects effects without running them,
// so `useFocusTrap` contributes its two refs and nothing that needs a DOM.
// That hook's effect is already covered at 100% by tests/use-focus-trap.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

import { importSource } from './helpers-jsx.mjs';
import {
  findAllByType,
  findByType,
  textOf,
  walkElements,
} from './tools/react-element-tree.mjs';

const CommunityPeople = (
  await importSource('src/components/CommunityPeople/index.js')
).default;
const peopleData = (await importSource('data/community-people.json')).default;

const Internals =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/**
 * Renders a function component that uses useState, useRef and useEffect,
 * re-rendering synchronously whenever a state setter is called.
 *
 * Effects are recorded rather than invoked, so no DOM is required.
 *
 * @param {Function} Component component under test
 * @param {object} [props] props to render it with
 * @returns {{ tree: any, effects: Function[] }} live view of the last render
 */
function render(Component, props = {}) {
  const states = [];
  const refs = [];
  const view = { tree: null, effects: [] };

  function run() {
    let stateSlot = 0;
    let refSlot = 0;
    const effects = [];
    const previousDispatcher = Internals.H;
    Internals.H = {
      useState(initial) {
        const slot = stateSlot++;
        if (slot === states.length) {
          states.push(typeof initial === 'function' ? initial() : initial);
        }
        const setState = (next) => {
          const value = typeof next === 'function' ? next(states[slot]) : next;
          if (Object.is(value, states[slot])) return;
          states[slot] = value;
          run();
        };
        return [states[slot], setState];
      },
      useRef(initial) {
        const slot = refSlot++;
        if (slot === refs.length) refs.push({ current: initial });
        return refs[slot];
      },
      useEffect(create) {
        effects.push(create);
      },
    };
    try {
      view.tree = Component(props);
    } finally {
      Internals.H = previousDispatcher;
    }
    view.effects = effects;
  }

  run();
  return view;
}

/** Every function-typed element in the tree, i.e. the nested components. */
function childComponents(tree) {
  return [...walkElements(tree)].filter(
    (element) => typeof element.type === 'function',
  );
}

function findByClass(tree, className) {
  for (const element of walkElements(tree)) {
    if (element.props?.className === className) return element;
  }
  return undefined;
}

// `PersonCard` and `PersonDialog` are private, so they are taken from the tree
// the exported component produces rather than imported.
const SECTIONS = Object.keys(peopleData.people);
const SAMPLE_SECTION = SECTIONS[0];
const PersonCard = CommunityPeople({ section: SAMPLE_SECTION }).props
  .children[0].type;

const FULL_PERSON = {
  name: 'Ada Lovelace',
  company: 'Analytical Engines',
  role: 'Principal Engineer',
  image: '/img/people/ada.jpg',
  bio: 'Ada builds platforms.',
  location: 'London, UK',
  blog: 'ada.example',
  github: 'ada',
  linkedin: 'ada-lovelace',
  twitter: 'ada',
};

function openDialog(person) {
  const card = render(PersonCard, { person });
  findByClass(card.tree, 'imageButton').props.onClick();
  const dialogElement = childComponents(card.tree)[0];
  return { card, dialogElement };
}

const { dialogElement: SAMPLE_DIALOG } = openDialog(FULL_PERSON);
const PersonDialog = SAMPLE_DIALOG.type;

function renderDialog(person, onClose = () => {}) {
  return render(PersonDialog, {
    person,
    onClose,
    triggerRef: { current: null },
  });
}

// --- CommunityPeople ------------------------------------------------------

test('renders one card per person in the requested section', () => {
  for (const section of SECTIONS) {
    const tree = CommunityPeople({ section });
    assert.equal(tree.props.className, 'peopleGrid');
    const cards = tree.props.children;
    assert.equal(cards.length, peopleData.people[section].length);
    assert.ok(cards.length > 0, `section ${section} has no people to render`);
    for (const [index, card] of cards.entries()) {
      assert.equal(card.type, PersonCard);
      assert.equal(card.props.person, peopleData.people[section][index]);
      assert.equal(card.key, peopleData.people[section][index].name);
    }
  }
});

test('an unknown section renders an empty grid instead of throwing', () => {
  const tree = CommunityPeople({ section: 'no-such-section' });
  assert.equal(tree.props.className, 'peopleGrid');
  assert.deepEqual(tree.props.children, []);
});

test('a missing section prop renders an empty grid', () => {
  assert.deepEqual(CommunityPeople({}).props.children, []);
});

// --- PersonCard -----------------------------------------------------------

test('a card starts closed, with no dialog in the tree', () => {
  const { tree } = render(PersonCard, { person: FULL_PERSON });
  assert.equal(childComponents(tree).length, 0);
});

test('the card labels its trigger and image for assistive technology', () => {
  const { tree } = render(PersonCard, { person: FULL_PERSON });
  const button = findByClass(tree, 'imageButton');
  assert.equal(button.props.type, 'button');
  assert.equal(button.props['aria-label'], 'Open Ada Lovelace profile');

  const image = findByType(tree, 'img');
  assert.equal(image.props.src, FULL_PERSON.image);
  assert.equal(image.props.alt, 'Ada Lovelace, Principal Engineer');
  assert.equal(image.props.loading, 'lazy');
  assert.equal(textOf(findByClass(tree, 'viewLabel')), 'View profile');
});

test('the card image alt falls back to the company when there is no role', () => {
  const { tree } = render(PersonCard, {
    person: { ...FULL_PERSON, role: '' },
  });
  assert.equal(
    findByType(tree, 'img').props.alt,
    'Ada Lovelace, Analytical Engines',
  );
});

test('the card shows role above company when both are present', () => {
  const { tree } = render(PersonCard, { person: FULL_PERSON });
  const info = findByClass(tree, 'personInfo');
  assert.equal(textOf(findByType(info, 'h4')), 'Ada Lovelace');
  assert.equal(textOf(findByType(info, 'p')), 'Principal Engineer');
  assert.equal(textOf(findByType(info, 'span')), 'Analytical Engines');
});

test('the card shows the company alone, once, when there is no role', () => {
  const { tree } = render(PersonCard, {
    person: { ...FULL_PERSON, role: '' },
  });
  const info = findByClass(tree, 'personInfo');
  assert.equal(textOf(findByType(info, 'p')), 'Analytical Engines');
  assert.equal(findByType(info, 'span'), undefined);
});

test('clicking the trigger opens the dialog, and closing it removes it', () => {
  const view = render(PersonCard, { person: FULL_PERSON });
  findByClass(view.tree, 'imageButton').props.onClick();

  const [dialog] = childComponents(view.tree);
  assert.equal(dialog.props.person, FULL_PERSON);
  assert.equal(dialog.props.triggerRef.current, null);

  dialog.props.onClose();
  assert.equal(childComponents(view.tree).length, 0);
});

test('the trigger ref is handed to the dialog so focus can be restored', () => {
  const view = render(PersonCard, { person: FULL_PERSON });
  const buttonRef = findByClass(view.tree, 'imageButton').ref;
  findByClass(view.tree, 'imageButton').props.onClick();
  assert.equal(childComponents(view.tree)[0].props.triggerRef, buttonRef);
});

// --- PersonDialog ---------------------------------------------------------

test('the dialog is a labelled modal with a labelled close button', () => {
  const { tree } = renderDialog(FULL_PERSON);
  const section = findByType(tree, 'section');
  assert.equal(section.props.role, 'dialog');
  assert.equal(section.props['aria-modal'], 'true');
  assert.equal(section.props['aria-labelledby'], 'profile-name');
  assert.equal(findByType(tree, 'h3').props.id, 'profile-name');

  const close = findByClass(tree, 'closeButton');
  assert.equal(close.props.type, 'button');
  assert.equal(close.props['aria-label'], 'Close Ada Lovelace profile');
});

test('the close button invokes onClose', () => {
  let closed = 0;
  const { tree } = renderDialog(FULL_PERSON, () => {
    closed += 1;
  });
  findByClass(tree, 'closeButton').props.onClick();
  assert.equal(closed, 1);
});

test('the dialog takes its focus-trap refs from useFocusTrap', () => {
  const { tree, effects } = renderDialog(FULL_PERSON);
  assert.equal(effects.length, 1, 'useFocusTrap registers exactly one effect');
  const section = findByType(tree, 'section');
  const close = findByClass(tree, 'closeButton');
  assert.ok(section.ref && close.ref, 'dialog and close button carry refs');
  assert.notEqual(section.ref, close.ref);
});

test('a mousedown on the backdrop itself closes the dialog', () => {
  let closed = 0;
  const { tree } = renderDialog(FULL_PERSON, () => {
    closed += 1;
  });
  const backdrop = findByClass(tree, 'backdrop');
  const target = {};
  backdrop.props.onMouseDown({ target, currentTarget: target });
  assert.equal(closed, 1);
});

test('a mousedown inside the dialog does not close it', () => {
  let closed = 0;
  const { tree } = renderDialog(FULL_PERSON, () => {
    closed += 1;
  });
  findByClass(tree, 'backdrop').props.onMouseDown({
    target: {},
    currentTarget: {},
  });
  assert.equal(closed, 0);
});

test('the dialog joins role and company with a separator', () => {
  const { tree } = renderDialog(FULL_PERSON);
  assert.equal(
    textOf(findByClass(tree, 'profileRole')),
    'Principal Engineer · Analytical Engines',
  );
});

test('the dialog glues the placeholder to the company when there is no role', () => {
  // Current output, not intended output: the `role || 'Community member'`
  // fallback and the company expression are independent, so both fire and are
  // concatenated with no separator. Tracked in #485 — flip this assertion to
  // 'Analytical Engines' as part of that fix.
  const { tree } = renderDialog({ ...FULL_PERSON, role: '' });
  assert.equal(
    textOf(findByClass(tree, 'profileRole')),
    'Community memberAnalytical Engines',
  );
});

test('the dialog falls back to a generic role when both are missing', () => {
  const { tree } = renderDialog({ ...FULL_PERSON, role: '', company: '' });
  assert.equal(textOf(findByClass(tree, 'profileRole')), 'Community member');
});

test('the dialog shows the role alone when there is no company', () => {
  const { tree } = renderDialog({ ...FULL_PERSON, company: '' });
  assert.equal(textOf(findByClass(tree, 'profileRole')), 'Principal Engineer');
});

test('location is rendered only when the person has one', () => {
  const withLocation = renderDialog(FULL_PERSON).tree;
  assert.equal(textOf(findByClass(withLocation, 'location')), 'London, UK');

  const without = renderDialog({ ...FULL_PERSON, location: '' }).tree;
  assert.equal(findByClass(without, 'location'), undefined);
});

test('a bio is rendered as prose, and its absence as the muted fallback', () => {
  const withBio = renderDialog(FULL_PERSON).tree;
  assert.equal(textOf(findByClass(withBio, 'bio')), 'Ada builds platforms.');
  assert.equal(findByClass(withBio, 'bioMuted'), undefined);

  const without = renderDialog({ ...FULL_PERSON, bio: '' }).tree;
  assert.equal(findByClass(without, 'bio'), undefined);
  assert.equal(
    textOf(findByClass(without, 'bioMuted')),
    'Public profile details are limited. Use the links below to learn more about Ada Lovelace.',
  );
});

test('the profile image is decorative and fixed-size', () => {
  const { tree } = renderDialog(FULL_PERSON);
  const image = findByClass(tree, 'profileImage');
  assert.equal(image.props.alt, '');
  assert.equal(image.props.src, FULL_PERSON.image);
  assert.equal(image.props.width, '240');
  assert.equal(image.props.height, '240');
});

test('every social link resolves through the profile-link builders', () => {
  const { tree } = renderDialog(FULL_PERSON);
  const links = findAllByType(findByClass(tree, 'profileLinks'), 'a');
  assert.deepEqual(
    links.map((link) => [link.key, link.props.href]),
    [
      ['GitHub', 'https://github.com/ada'],
      ['LinkedIn', 'https://www.linkedin.com/in/ada-lovelace'],
      ['Twitter', 'https://twitter.com/ada'],
      ['Website', 'https://ada.example/'],
    ],
  );
  for (const link of links) {
    assert.equal(link.props.target, '_blank');
    assert.equal(link.props.rel, 'noreferrer');
  }
});

test('a handle the person does not have produces no link at all', () => {
  const { tree } = renderDialog({
    ...FULL_PERSON,
    github: '',
    linkedin: null,
    twitter: undefined,
  });
  const links = findAllByType(findByClass(tree, 'profileLinks'), 'a');
  assert.deepEqual(
    links.map((link) => link.key),
    ['Website'],
  );
});

test('a website websiteUrl rejects is dropped rather than linked empty', () => {
  // `blog` is free text copied verbatim from a third-party GitHub profile, so
  // websiteUrl returns null for a disguised authority; the link must vanish.
  const { tree } = renderDialog({
    ...FULL_PERSON,
    blog: 'trusted.example@attacker.example',
  });
  const links = findAllByType(findByClass(tree, 'profileLinks'), 'a');
  assert.deepEqual(
    links.map((link) => link.key),
    ['GitHub', 'LinkedIn', 'Twitter'],
  );
  for (const link of links) {
    assert.ok(link.props.href, 'no link is rendered with an empty href');
  }
});

test('a person with no links at all renders an empty link list', () => {
  const { tree } = renderDialog({
    ...FULL_PERSON,
    github: '',
    linkedin: '',
    twitter: '',
    blog: '',
  });
  assert.deepEqual(findByClass(tree, 'profileLinks').props.children, []);
  assert.match(
    textOf(findByClass(tree, 'sourceNote')),
    /refreshed from public sources/,
  );
});
