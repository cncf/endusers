// Test stub for `mark.js`, the dependency docusaurus-plugin-search-local
// uses to highlight search terms on the page a result links to.
//
// The real class walks a live DOM subtree, which unit tests do not have, so
// this stub records every constructed instance and the calls it receives;
// assertions read them back through Mark.instances.

export default class Mark {
  static instances = [];

  constructor(root) {
    this.root = root;
    this.calls = [];
    Mark.instances.push(this);
  }

  unmark() {
    this.calls.push('unmark');
  }

  mark(keywords) {
    this.calls.push(['mark', keywords]);
  }
}
