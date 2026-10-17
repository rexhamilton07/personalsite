document.getElementById('year').textContent = new Date().getFullYear();

// Tabs (Living Room). The URL hash picks the tab, so /living-room#record-player is linkable.
const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(tab) {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute('aria-selected', selected);
    t.tabIndex = selected ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
  }
}

function tabFromHash() {
  return tabs.find((t) => `#${t.getAttribute('aria-controls')}` === location.hash);
}

if (tabs.length) {
  for (const tab of tabs) {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      selectTab(tab);
      history.replaceState(null, '', `#${tab.getAttribute('aria-controls')}`);
    });
    tab.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('editing')) return; // arrows move the caret while editing the label
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
      next.click();
      next.focus();
    });
  }

  const initial = tabFromHash();
  if (initial) selectTab(initial);
  window.addEventListener('hashchange', () => {
    const tab = tabFromHash();
    if (tab) selectTab(tab);
  });
}
