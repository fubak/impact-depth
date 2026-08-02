import { expect, it } from 'vitest';

const modules = import.meta.glob<string>('../../src/game/**/*.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
});

it('does not use nondeterministic random in game modules', () => {
  const source = Object.values(modules).join('\n');
  expect(source).not.toContain('Math.random');
});
