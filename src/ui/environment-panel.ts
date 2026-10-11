import {
  DEFAULT_ENVIRONMENT,
  TIME_OF_DAY_IDS,
  WEATHER_KINDS,
  type Environment,
  type TimeOfDayId,
  type WeatherKind,
} from '../game/sim/environment';

/**
 * Weather and time-of-day chooser. Everything above `EnvironmentPanel` is a pure
 * view-model (choices, summary, URL parsing, markup) so it can be unit tested without
 * a DOM; the class is the thin popover shell the App drives. The choice itself is sim
 * truth (`GameState.environment`) and is applied through the `setEnvironment` command.
 */

export interface EnvironmentChoice<Id extends string> {
  id: Id;
  label: string;
  /** What it does, in plain words ("big waves, rain, lightning; ships slow, sonar short"). */
  detail: string;
  /** `Label - detail`, used for tooltips and screen readers. */
  description: string;
}

export interface EnvironmentSelection {
  weather: WeatherKind;
  timeOfDay: TimeOfDayId;
}

export const DEFAULT_SELECTION: EnvironmentSelection = {
  weather: DEFAULT_ENVIRONMENT.weather,
  timeOfDay: DEFAULT_ENVIRONMENT.timeOfDay,
};

/**
 * Quick-panel key. E is taken (hold-to-dive trim), so the panel uses Y; every helm,
 * weapon and view key keeps working while it is open.
 */
export const ENVIRONMENT_PANEL_KEY = 'KeyY';
export const ENVIRONMENT_PANEL_KEY_LABEL = 'Y';

const choice = <Id extends string>(
  id: Id,
  label: string,
  detail: string,
): EnvironmentChoice<Id> => ({ id, label, detail, description: `${label} - ${detail}` });

const WEATHER_TEXT: Readonly<Record<WeatherKind, EnvironmentChoice<WeatherKind>>> = {
  clear: choice('clear', 'Clear', 'calm sea, good sight lines; the standard patrol'),
  'partly-cloudy': choice('partly-cloudy', 'Partly cloudy', 'light breeze, scattered cloud'),
  overcast: choice('overcast', 'Overcast', 'grey sky, a little more sea running'),
  rain: choice('rain', 'Rain', 'choppy sea, short sight lines; sonar a little shorter'),
  storm: choice('storm', 'Storm', 'big waves, rain, lightning; ships slow, sonar short'),
  fog: choice('fog', 'Fog', 'flat sea, very poor sight; scopes are hard to spot'),
};

const TIME_TEXT: Readonly<Record<TimeOfDayId, EnvironmentChoice<TimeOfDayId>>> = {
  dawn: choice('dawn', 'Dawn', 'low sun, thin light; lookouts see less'),
  day: choice('day', 'Day', 'full light; lookouts see their best'),
  dusk: choice('dusk', 'Dusk', 'fading light; lookouts see less'),
  night: choice('night', 'Night', 'lookouts see far less'),
};

export const weatherChoices = (): EnvironmentChoice<WeatherKind>[] =>
  WEATHER_KINDS.map((id) => WEATHER_TEXT[id]);

export const timeChoices = (): EnvironmentChoice<TimeOfDayId>[] =>
  TIME_OF_DAY_IDS.map((id) => TIME_TEXT[id]);

/** "Storm - Night". */
export const environmentSummary = (env: Pick<Environment, 'weather' | 'timeOfDay'>): string =>
  `${WEATHER_TEXT[env.weather].label} - ${TIME_TEXT[env.timeOfDay].label}`;

const WEATHER_ALIASES: ReadonlyMap<string, WeatherKind> = new Map<string, WeatherKind>([
  ['partly', 'partly-cloudy'],
  ['partlycloudy', 'partly-cloudy'],
]);

/** lowercase, trimmed, `_` and spaces folded to `-`. */
const normalizeParam = (raw: string | null): string =>
  (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

const isWeather = (value: string): value is WeatherKind =>
  (WEATHER_KINDS as readonly string[]).includes(value);
const isTime = (value: string): value is TimeOfDayId =>
  (TIME_OF_DAY_IDS as readonly string[]).includes(value);

function parseWeather(raw: string | null): WeatherKind | undefined {
  const value = normalizeParam(raw);
  if (isWeather(value)) return value;
  return WEATHER_ALIASES.get(value.replace(/-/g, ''));
}

function parseTime(raw: string | null): TimeOfDayId | undefined {
  const value = normalizeParam(raw);
  return isTime(value) ? value : undefined;
}

/** `?weather=storm&time=night`. Unknown or empty values are ignored, never an error. */
export function parseEnvironmentParams(
  params: string | URLSearchParams,
): Partial<EnvironmentSelection> {
  const query =
    typeof params === 'string'
      ? new URLSearchParams(params.startsWith('?') ? params.slice(1) : params)
      : params;
  const weather = parseWeather(query.get('weather'));
  const timeOfDay = parseTime(query.get('time'));
  return {
    ...(weather ? { weather } : {}),
    ...(timeOfDay ? { timeOfDay } : {}),
  };
}

/** URL params laid over clear day. */
export const resolveEnvironmentSelection = (
  params: string | URLSearchParams,
): EnvironmentSelection => ({
  ...DEFAULT_SELECTION,
  ...parseEnvironmentParams(params),
});

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

function choiceButton(
  attr: 'data-env-weather' | 'data-env-time',
  entry: EnvironmentChoice<string>,
  selected: boolean,
): string {
  return `<button type="button" class="env-btn${selected ? ' is-selected' : ''}" ${attr}="${entry.id}" aria-pressed="${selected}" title="${escapeHtml(entry.description)}">${escapeHtml(entry.label)}</button>`;
}

/** The two rows of toggle buttons. Shared by the menu card and the in-game popover. */
export function renderEnvironmentChoosers(selection: EnvironmentSelection): string {
  const weather = weatherChoices()
    .map((entry) => choiceButton('data-env-weather', entry, entry.id === selection.weather))
    .join('');
  const time = timeChoices()
    .map((entry) => choiceButton('data-env-time', entry, entry.id === selection.timeOfDay))
    .join('');
  return `<div class="env-row" role="group" aria-label="Weather"><span class="env-row-label">Weather</span><div class="env-btns env-btns-weather">${weather}</div></div><div class="env-row" role="group" aria-label="Time of day"><span class="env-row-label">Time of day</span><div class="env-btns env-btns-time">${time}</div></div>`;
}

/** What the highlighted choices mean, one line, for the popover footer. */
export function environmentDetail(selection: EnvironmentSelection): string {
  return `${WEATHER_TEXT[selection.weather].description}. ${TIME_TEXT[selection.timeOfDay].description}.`;
}

export function renderEnvironmentPanel(selection: EnvironmentSelection): string {
  return `<div class="env-head"><span class="env-title">WEATHER</span><b class="env-summary" data-env-summary>${escapeHtml(environmentSummary(selection))}</b><button type="button" class="env-close" data-env-close aria-label="Close weather panel">&times;</button></div>${renderEnvironmentChoosers(selection)}<p class="env-detail" data-env-detail>${escapeHtml(environmentDetail(selection))}</p><div class="env-foot"><kbd>${ENVIRONMENT_PANEL_KEY_LABEL}</kbd> or Esc to close</div>`;
}

/** A choice button reduced to what we read from it (real buttons and test doubles both fit). */
interface ChoiceButtonLike {
  dataset: Record<string, string | undefined>;
}

/** Weather or time patch for a clicked chooser button; null for anything else. */
export function environmentPatchFromButton(
  button: ChoiceButtonLike | null | undefined,
): Partial<EnvironmentSelection> | null {
  const weather = button?.dataset.envWeather;
  if (weather !== undefined) return isWeather(weather) ? { weather } : null;
  const time = button?.dataset.envTime;
  if (time !== undefined) return isTime(time) ? { timeOfDay: time } : null;
  return null;
}

interface PressableButton extends ChoiceButtonLike {
  setAttribute(name: string, value: string): void;
  classList?: { toggle(name: string, force: boolean): unknown };
}

/** Update aria-pressed (and the highlight class) in place so keyboard focus is kept. */
export function applySelectionToButtons(
  buttons: Iterable<PressableButton>,
  selection: EnvironmentSelection,
): void {
  for (const button of buttons) {
    const selected =
      button.dataset.envWeather !== undefined
        ? button.dataset.envWeather === selection.weather
        : button.dataset.envTime === selection.timeOfDay;
    button.setAttribute('aria-pressed', String(selected));
    button.classList?.toggle('is-selected', selected);
  }
}

const BUTTON_SELECTOR = '[data-env-weather],[data-env-time]';

/** Pressed state for every chooser button under `root`. */
export function syncEnvironmentChoosers(root: ParentNode, selection: EnvironmentSelection): void {
  applySelectionToButtons(root.querySelectorAll<HTMLElement>(BUTTON_SELECTOR), selection);
}

export interface EnvironmentPanelCallbacks {
  /** A weather or time button was pressed. */
  change: (patch: Partial<EnvironmentSelection>) => void;
  /** The panel closed itself (close button or Esc). */
  closed?: () => void;
}

/**
 * Small popover. It owns only its own clicks and Esc: it never pauses the game and
 * never touches helm, weapon or view keys.
 */
export class EnvironmentPanel {
  private open_ = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: EnvironmentPanelCallbacks,
  ) {
    root.hidden = true;
    root.addEventListener('click', this.onClick);
    // Capture: Esc closes the popover first and is not also seen by the tutorial.
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  isOpen(): boolean {
    return this.open_;
  }

  open(selection: EnvironmentSelection): void {
    this.root.innerHTML = renderEnvironmentPanel(selection);
    this.root.hidden = false;
    this.open_ = true;
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.cb.closed?.();
  }

  toggle(selection: EnvironmentSelection): void {
    if (this.open_) this.close();
    else this.open(selection);
  }

  /** Reflect the live selection (for example after a URL param or a menu choice). */
  sync(selection: EnvironmentSelection): void {
    if (!this.open_) return;
    syncEnvironmentChoosers(this.root, selection);
    const summary = this.root.querySelector<HTMLElement>('[data-env-summary]');
    if (summary) summary.textContent = environmentSummary(selection);
    const detail = this.root.querySelector<HTMLElement>('[data-env-detail]');
    if (detail) detail.textContent = environmentDetail(selection);
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-env-close]')) {
      this.close();
      return;
    }
    const patch = environmentPatchFromButton(target?.closest<HTMLElement>(BUTTON_SELECTOR));
    if (patch) this.cb.change(patch);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open_ || event.code !== 'Escape') return;
    event.stopImmediatePropagation();
    this.close();
  };
}
