import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React Testing Library does not auto-clean when `globals` is on in some
// setups; unmounting between tests keeps queries from matching stale trees.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
