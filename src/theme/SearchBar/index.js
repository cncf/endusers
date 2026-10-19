// Swizzled from docusaurus-plugin-search-local's SearchBar so the navbar
// search button can carry an accessible name that contains its visible text.
//
// The plugin renders its SearchButton without `translations`, which hardcodes
// aria-label="Search (Control+k)" while the visible label is "Search" plus
// the "K" key hint (the Control key is drawn as an icon). An accessible name
// that omits visible text fails WCAG 2.5.3 Label in Name — axe-core reports
// it as label-content-name-mismatch on every page (#1618). Neither string is
// reachable from docusaurus.config.js, so the whole component is swizzled
// here; the behaviour below matches the plugin's SearchBar except for the
// translations passed to SearchButton.
//
// SearchModal, ErrorBoundary and SearchButton itself still come from the
// plugin through the @theme/ alias, and mark.js arrives as the plugin's own
// dependency, so only the wiring is copied.
import { Component, useEffect, useState } from 'react';
import { useLocation } from '@docusaurus/router';
import { usePluginData } from '@docusaurus/useGlobalData';
import ExecutionEnvironment from '@docusaurus/ExecutionEnvironment';
import { SearchButton } from '@theme/SearchBar/SearchButton';
import SearchModal from '@theme/SearchModal';
import ErrorBoundary from '@theme/ErrorBoundary';
import Mark from 'mark.js';

const SEARCH_PARAM_HIGHLIGHT = '_highlight';

// WCAG 2.5.3 Label in Name: the button's visible text is "Search" plus the
// "K" key hint, so its accessible name has to contain both. The plugin
// appends the keyboard shortcut to whatever buttonAriaLabel carries, and the
// shortcut stays programmatically available through the button's own
// aria-keyshortcuts.
//
// The trailing space in buttonText is load-bearing, not a typo. axe computes
// the button's visible text by concatenating the placeholder and key-hint
// text nodes, and with no whitespace between them that is the single word
// "SearchK" — a token no accessible name can contain. The space makes the
// visible text "Search K", two tokens that the accessible name then starts
// with. tests/search-bar.test.mjs pins the token-containment contract, so
// trimming the space fails loudly.
const BUTTON_TRANSLATIONS = {
  buttonText: 'Search ',
  buttonAriaLabel: 'Search K',
};

function isEditingContent(event) {
  const element = event.target;
  const tagName = element.tagName;
  return (
    element.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'SELECT' ||
    tagName === 'TEXTAREA'
  );
}

export default class SearchBarWrapper extends Component {
  render() {
    return (
      <ErrorBoundary>
        <SearchBar />
      </ErrorBoundary>
    );
  }
}

export function SearchBar() {
  const { highlightSearchTermsOnTargetPage } = usePluginData(
    'docusaurus-plugin-search-local',
  );
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (!highlightSearchTermsOnTargetPage) {
      return;
    }
    const keywords = ExecutionEnvironment.canUseDOM
      ? new URLSearchParams(location.search).getAll(SEARCH_PARAM_HIGHLIGHT)
      : [];
    if (keywords.length === 0) {
      return;
    }
    const root = document.querySelector('article');
    if (!root) {
      return;
    }
    const mark = new Mark(root);
    mark.unmark();
    mark.mark(keywords);
  }, [highlightSearchTermsOnTargetPage, location.search]);

  useEffect(() => {
    function onKeyDown(event) {
      if (
        // The `Escape` key closes the modal.
        (event.keyCode === 27 && isOpen) ||
        // The `Cmd+K` shortcut both opens and closes the modal.
        (event.key === 'k' && (event.metaKey || event.ctrlKey)) ||
        // The `/` shortcut opens but doesn't close the modal because it's
        // a character.
        (!isEditingContent(event) && event.key === '/' && !isOpen)
      ) {
        event.preventDefault();
        if (isOpen) {
          setIsOpen(false);
        } else {
          setIsOpen(true);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <SearchButton
        translations={BUTTON_TRANSLATIONS}
        onClick={() => {
          setIsOpen(true);
        }}
      />

      {isOpen ? <SearchModal onClose={() => setIsOpen(false)} /> : ''}
    </>
  );
}
