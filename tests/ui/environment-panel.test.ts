import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SELECTION,
  applySelectionToButtons,
  ENVIRONMENT_PANEL_KEY,
  EnvironmentPanel,
  environmentPatchFromButton,
  environmentSummary,
  parseEnvironmentParams,
  renderEnvironmentChoosers,
  renderEnvironmentPanel,
  resolveEnvironmentSelection,
  timeChoices,
  weatherChoices,
} from '../../src/ui/environment-panel';
import {
  DEFAULT_ENVIRONMENT,
  TIME_OF_DAY_IDS,
  WEATHER_KINDS,
  environmentFor,
} from '../../src/game/sim/environment';

const pressedButtons = (html: string, attr: 'data-env-weather' | 'data-env-time'): string[] =>
  [...html.matchAll(new RegExp(`<button[^>]*${attr}="([^"]+)"[^>]*>`, 'g'))]
    .filter((m) => m[0].includes('aria-pressed="true"'))
    .map((m) => m[1]!);

describe('weatherChoices', () => {
  it('covers all six weathers in sim order with plain text', () => {
    const choices = weatherChoices();
    expect(choices.map((c) => c.id)).toEqual([...WEATHER_KINDS]);
    expect(choices.map((c) => c.label)).toEqual([
      'Clear',
      'Partly cloudy',
      'Overcast',
      'Rain',
      'Storm',
      'Fog',
    ]);
    for (const choice of choices) {
      expect(choice.detail.length).toBeGreaterThan(8);
      expect(choice.description).toBe(`${choice.label} - ${choice.detail}`);
      expect(choice.description).not.toMatch(/[_]|undefined|\[object/);
    }
  });

  it('describes the storm in the plain words players will read', () => {
    const storm = weatherChoices().find((c) => c.id === 'storm')!;
    expect(storm.description).toBe('Storm - big waves, rain, lightning; ships slow, sonar short');
  });
});

describe('timeChoices', () => {
  it('covers dawn, day, dusk and night with plain text', () => {
    const choices = timeChoices();
    expect(choices.map((c) => c.id)).toEqual([...TIME_OF_DAY_IDS]);
    expect(choices.map((c) => c.label)).toEqual(['Dawn', 'Day', 'Dusk', 'Night']);
    for (const choice of choices) expect(choice.detail.length).toBeGreaterThan(8);
  });

  it('says what night does', () => {
    const night = timeChoices().find((c) => c.id === 'night')!;
    expect(night.description).toBe('Night - lookouts see far less');
  });
});

describe('environmentSummary', () => {
  it('joins the weather and the time with plain labels', () => {
    expect(environmentSummary(environmentFor('storm', 'night'))).toBe('Storm - Night');
    expect(environmentSummary(environmentFor('partly-cloudy', 'dawn'))).toBe(
      'Partly cloudy - Dawn',
    );
    expect(environmentSummary(DEFAULT_ENVIRONMENT)).toBe('Clear - Day');
  });
});

describe('parseEnvironmentParams', () => {
  it('reads ?weather= and ?time= from a query string', () => {
    expect(parseEnvironmentParams('?weather=storm&time=night')).toEqual({
      weather: 'storm',
      timeOfDay: 'night',
    });
    expect(parseEnvironmentParams('weather=fog')).toEqual({ weather: 'fog' });
  });

  it('accepts URLSearchParams', () => {
    expect(parseEnvironmentParams(new URLSearchParams('time=dusk'))).toEqual({
      timeOfDay: 'dusk',
    });
  });

  it('is case-insensitive and trims', () => {
    expect(parseEnvironmentParams('?weather=STORM&time=Night')).toEqual({
      weather: 'storm',
      timeOfDay: 'night',
    });
    expect(parseEnvironmentParams('?weather=%20Rain%20')).toEqual({ weather: 'rain' });
  });

  it('accepts partly-cloudy and its spellings', () => {
    for (const spelling of [
      'partly-cloudy',
      'partly_cloudy',
      'partlycloudy',
      'partly cloudy',
      'Partly',
    ]) {
      expect(parseEnvironmentParams(`?weather=${encodeURIComponent(spelling)}`)).toEqual({
        weather: 'partly-cloudy',
      });
    }
  });

  it('ignores invalid values and keeps the valid ones', () => {
    expect(parseEnvironmentParams('?weather=hurricane&time=night')).toEqual({
      timeOfDay: 'night',
    });
    expect(parseEnvironmentParams('?weather=&time=midnight')).toEqual({});
    expect(parseEnvironmentParams('')).toEqual({});
    expect(parseEnvironmentParams('?weather=constructor&time=__proto__')).toEqual({});
  });

  it('resolves onto clear day when nothing valid is given', () => {
    expect(resolveEnvironmentSelection('')).toEqual(DEFAULT_SELECTION);
    expect(DEFAULT_SELECTION).toEqual({
      weather: DEFAULT_ENVIRONMENT.weather,
      timeOfDay: DEFAULT_ENVIRONMENT.timeOfDay,
    });
    expect(resolveEnvironmentSelection('?weather=fog')).toEqual({
      weather: 'fog',
      timeOfDay: 'day',
    });
  });
});

describe('renderEnvironmentChoosers', () => {
  it('has one button per weather and per time of day', () => {
    const html = renderEnvironmentChoosers(DEFAULT_SELECTION);
    for (const id of WEATHER_KINDS) expect(html).toContain(`data-env-weather="${id}"`);
    for (const id of TIME_OF_DAY_IDS) expect(html).toContain(`data-env-time="${id}"`);
    expect(html).toContain('Partly cloudy');
  });

  it('marks exactly the selected buttons with aria-pressed', () => {
    const html = renderEnvironmentChoosers({ weather: 'storm', timeOfDay: 'night' });
    expect(pressedButtons(html, 'data-env-weather')).toEqual(['storm']);
    expect(pressedButtons(html, 'data-env-time')).toEqual(['night']);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(
      WEATHER_KINDS.length - 1 + TIME_OF_DAY_IDS.length - 1,
    );
  });

  it('never reuses the menu data-action hooks', () => {
    const html = renderEnvironmentChoosers(DEFAULT_SELECTION);
    expect(html).not.toContain('data-action=');
    expect(html).toContain('type="button"');
  });
});

describe('renderEnvironmentPanel', () => {
  it('has a close button, the summary and both rows', () => {
    const html = renderEnvironmentPanel({ weather: 'rain', timeOfDay: 'dusk' });
    expect(html).toContain('data-env-close');
    expect(html).toContain('aria-label="Close weather panel"');
    expect(html).toContain('Rain - Dusk');
    expect(pressedButtons(html, 'data-env-weather')).toEqual(['rain']);
    expect(pressedButtons(html, 'data-env-time')).toEqual(['dusk']);
    expect(html).toContain(`<kbd>${ENVIRONMENT_PANEL_KEY.replace('Key', '')}</kbd>`);
  });
});

describe('environmentPatchFromButton', () => {
  it('turns a weather or time button into a patch', () => {
    expect(environmentPatchFromButton({ dataset: { envWeather: 'fog' } })).toEqual({
      weather: 'fog',
    });
    expect(environmentPatchFromButton({ dataset: { envTime: 'dawn' } })).toEqual({
      timeOfDay: 'dawn',
    });
  });

  it('rejects unknown ids and unrelated buttons', () => {
    expect(environmentPatchFromButton({ dataset: { envWeather: 'blizzard' } })).toBeNull();
    expect(environmentPatchFromButton({ dataset: { action: 'begin' } })).toBeNull();
    expect(environmentPatchFromButton(null)).toBeNull();
  });
});

describe('ENVIRONMENT_PANEL_KEY', () => {
  it('does not collide with a helm, weapon or view key', () => {
    const taken = [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyQ',
      'KeyE',
      'KeyZ',
      'KeyX',
      'KeyB',
      'KeyV',
      'KeyG',
      'KeyC',
      'KeyR',
      'KeyT',
      'KeyF',
      'KeyU',
      'KeyL',
      'KeyH',
      'KeyM',
      'KeyI',
      'KeyO',
      'KeyP',
    ];
    expect(taken).not.toContain(ENVIRONMENT_PANEL_KEY);
  });
});

interface ButtonDouble {
  dataset: Record<string, string>;
  pressed: string;
  setAttribute(name: string, value: string): void;
}
const buttonDouble = (dataset: Record<string, string>): ButtonDouble => ({
  dataset,
  pressed: '',
  setAttribute(name, value) {
    if (name === 'aria-pressed') this.pressed = value;
  },
});

describe('applySelectionToButtons', () => {
  it('presses only the matching weather and time buttons', () => {
    const buttons = [
      buttonDouble({ envWeather: 'storm' }),
      buttonDouble({ envWeather: 'clear' }),
      buttonDouble({ envTime: 'night' }),
      buttonDouble({ envTime: 'day' }),
    ];
    applySelectionToButtons(buttons, { weather: 'storm', timeOfDay: 'night' });
    expect(buttons.map((b) => b.pressed)).toEqual(['true', 'false', 'true', 'false']);
  });
});

/** Minimal element double: the vitest env is node, so there is no DOM. */
function fakeRoot() {
  const listeners = new Map<string, (event: unknown) => void>();
  const buttons: Array<ButtonDouble> = [];
  const root = {
    hidden: true,
    innerHTML: '',
    buttons,
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    querySelectorAll: () => buttons,
    querySelector: () => null,
  };
  const click = (button: { dataset: Record<string, string> } | null, closeHit = false) =>
    listeners.get('click')?.({
      target: {
        closest: (selector: string) => {
          if (selector.includes('data-env-close')) return closeHit ? {} : null;
          return button;
        },
      },
    });
  return { root: root as unknown as HTMLElement, state: root, click };
}

describe('EnvironmentPanel', () => {
  const stubWindow = () => {
    const handlers: Array<(event: { code: string; stopImmediatePropagation(): void }) => void> = [];
    vi.stubGlobal('window', {
      addEventListener: (_t: string, fn: never) => handlers.push(fn),
      removeEventListener: () => {},
    });
    return handlers;
  };

  it('starts hidden, opens with the current selection, closes again', () => {
    stubWindow();
    const { root, state } = fakeRoot();
    const panel = new EnvironmentPanel(root, { change: vi.fn() });
    expect(state.hidden).toBe(true);
    expect(panel.isOpen()).toBe(false);
    panel.open({ weather: 'storm', timeOfDay: 'night' });
    expect(panel.isOpen()).toBe(true);
    expect(state.hidden).toBe(false);
    expect(state.innerHTML).toContain('Storm - Night');
    panel.close();
    expect(state.hidden).toBe(true);
    expect(panel.isOpen()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('toggle flips the state', () => {
    stubWindow();
    const { root } = fakeRoot();
    const panel = new EnvironmentPanel(root, { change: vi.fn() });
    panel.toggle(DEFAULT_SELECTION);
    expect(panel.isOpen()).toBe(true);
    panel.toggle(DEFAULT_SELECTION);
    expect(panel.isOpen()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('reports a clicked choice and closes from the close button', () => {
    stubWindow();
    const { root, click } = fakeRoot();
    const change = vi.fn();
    const panel = new EnvironmentPanel(root, { change });
    panel.open(DEFAULT_SELECTION);
    click({ dataset: { envWeather: 'rain' } });
    expect(change).toHaveBeenCalledWith({ weather: 'rain' });
    click(null, true);
    expect(panel.isOpen()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('Esc closes it and is swallowed only while it is open', () => {
    const handlers = stubWindow();
    const { root } = fakeRoot();
    const panel = new EnvironmentPanel(root, { change: vi.fn() });
    const stop = vi.fn();
    handlers[0]!({ code: 'Escape', stopImmediatePropagation: stop });
    expect(stop).not.toHaveBeenCalled();
    panel.open(DEFAULT_SELECTION);
    handlers[0]!({ code: 'KeyW', stopImmediatePropagation: stop });
    expect(stop).not.toHaveBeenCalled();
    expect(panel.isOpen()).toBe(true);
    handlers[0]!({ code: 'Escape', stopImmediatePropagation: stop });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(panel.isOpen()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('sync updates the pressed state in place while open and is a no-op while closed', () => {
    stubWindow();
    const { root, state } = fakeRoot();
    const panel = new EnvironmentPanel(root, { change: vi.fn() });
    panel.sync({ weather: 'fog', timeOfDay: 'dawn' });
    expect(state.innerHTML).toBe('');
    const fog = buttonDouble({ envWeather: 'fog' });
    const dawn = buttonDouble({ envTime: 'dawn' });
    const day = buttonDouble({ envTime: 'day' });
    state.buttons.push(fog, dawn, day);
    panel.open(DEFAULT_SELECTION);
    panel.sync({ weather: 'fog', timeOfDay: 'dawn' });
    expect([fog.pressed, dawn.pressed, day.pressed]).toEqual(['true', 'true', 'false']);
    vi.unstubAllGlobals();
  });
});
