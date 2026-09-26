import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const TAB_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

export function handleTabListKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (!TAB_KEYS.has(event.key)) return;
  const list = event.currentTarget.closest<HTMLElement>('[role="tablist"]') || event.currentTarget;
  const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0 || tabs.length < 2) return;
  event.preventDefault();
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
}
