/**
 * Desktop theme context.
 *
 * Applies the active theme as CSS custom properties on :root so every
 * Tailwind utility that references a color or font-family token picks up
 * the change automatically.
 *
 * Mode (light/dark/system) controls brightness; skin controls accent.
 * The two are persisted independently. Shift+X toggles light/dark.
 */

import { load as loadYaml } from 'js-yaml'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { matchesQuery, useMediaQuery } from '@/hooks/use-media-query'

import { BUILTIN_THEME_LIST, BUILTIN_THEMES, DEFAULT_SKIN_NAME, DEFAULT_TYPOGRAPHY, nousTheme } from './presets'
import type { DesktopTheme, DesktopThemeColors } from './types'

const SKIN_KEY = 'hermes-desktop-theme-v2'
const MODE_KEY = 'hermes-desktop-mode-v1'
const RETIRED_SKINS = new Set(['nous-light', 'default', 'gold'])
const YAML_THEME_EXT = /\.ya?ml$/i

declare const require: undefined | ((id: string) => unknown)
declare const process: undefined | { env: Record<string, string | undefined> }

export type ThemeMode = 'light' | 'dark' | 'system'

const INJECTED_FONT_URLS = new Set<string>()

const resolveMode = (mode: ThemeMode, systemDark = matchesQuery('(prefers-color-scheme: dark)')): 'light' | 'dark' =>
  mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

const normalizeSkin = (name: string | null | undefined): string =>
  name && !RETIRED_SKINS.has(name) ? name : DEFAULT_SKIN_NAME

type ThemeListItem = { name: string; label: string; description: string; definition?: DesktopTheme }
type RawThemeRecord = Record<string, unknown>
interface FsModule {
  existsSync: (path: string) => boolean
  readFileSync: (path: string, encoding: 'utf8') => string
  readdirSync: (path: string) => string[]
}

const CUSTOM_THEMES = new Map<string, DesktopTheme>()
interface PathModule {
  basename: (path: string) => string
  join: (...parts: string[]) => string
}

const titleCase = (name: string) =>
  name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

const stringValue = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

function layerHex(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object') {
    return stringValue((value as Record<string, unknown>).hex)
  }

  return null
}

function themeFromRaw(raw: RawThemeRecord, fallbackName: string): DesktopTheme | null {
  const name = stringValue(raw.name) || fallbackName
  const colors = raw.colors && typeof raw.colors === 'object' ? (raw.colors as DesktopThemeColors) : null

  if (colors) {
    return {
      name,
      label: stringValue(raw.label) || titleCase(name),
      description: stringValue(raw.description) || 'Custom dashboard theme',
      colors,
      darkColors: raw.darkColors && typeof raw.darkColors === 'object' ? (raw.darkColors as DesktopThemeColors) : undefined,
      typography: raw.typography && typeof raw.typography === 'object' ? raw.typography : undefined
    }
  }

  const palette = raw.palette && typeof raw.palette === 'object' ? (raw.palette as Record<string, unknown>) : null

  if (!palette) {
    return null
  }

  const background = layerHex(palette.background) || '#08081c'
  const midground = layerHex(palette.midground) || '#8b80e8'
  const foreground = layerHex(palette.foreground) || midground
  const soft = mix(background, midground, 0.16)
  const softer = mix(background, midground, 0.1)
  const border = mix(background, midground, 0.34)

  return {
    name,
    label: stringValue(raw.label) || titleCase(name),
    description: stringValue(raw.description) || 'Custom dashboard theme',
    colors: {
      background,
      foreground,
      card: mix(background, midground, 0.08),
      cardForeground: foreground,
      muted: softer,
      mutedForeground: mix(foreground, background, 0.42),
      popover: mix(background, midground, 0.12),
      popoverForeground: foreground,
      primary: midground,
      primaryForeground: readableOn(midground),
      secondary: soft,
      secondaryForeground: foreground,
      accent: soft,
      accentForeground: foreground,
      border,
      input: border,
      ring: midground,
      midground,
      midgroundForeground: readableOn(midground),
      composerRing: midground,
      destructive: '#b03060',
      destructiveForeground: '#fef2f2',
      sidebarBackground: mix(background, '#000000', 0.18),
      sidebarBorder: mix(background, midground, 0.22),
      userBubble: soft,
      userBubbleBorder: border
    },
    typography: raw.typography && typeof raw.typography === 'object' ? raw.typography : undefined
  }
}

function lazyRequire<T = unknown>(id: string): T | null {
  try {
    if (typeof require === 'undefined') {
      return null
    }

    return require(id) as T
  } catch {
    return null
  }
}

function getYamlThemesDir(): string | null {
  const path = lazyRequire<PathModule>('path')

  if (!path || typeof process === 'undefined') {
    return null
  }

  const hermesHome = process.env.HERMES_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.hermes')

  return hermesHome ? path.join(hermesHome, 'dashboard-themes') : null
}

function loadYamlTheme(name: string): DesktopTheme | null {
  if (RETIRED_SKINS.has(name)) {
    return null
  }

  const registered = CUSTOM_THEMES.get(name)

  if (registered) {
    return registered
  }

  const fs = lazyRequire<FsModule>('fs')
  const path = lazyRequire<PathModule>('path')
  const yaml = lazyRequire<{ load: (source: string) => unknown }>('js-yaml')
  const themesDir = getYamlThemesDir()

  if (!fs || !path || !yaml || !themesDir) {
    return null
  }

  const candidates = [path.join(themesDir, `${name}.yaml`), path.join(themesDir, `${name}.yml`)]
  const themePath = candidates.find(candidate => fs.existsSync(candidate))

  if (!themePath) {
    return null
  }

  try {
    const parsed = yaml.load(fs.readFileSync(themePath, 'utf8')) as RawThemeRecord | null

    return parsed && typeof parsed === 'object' ? themeFromRaw(parsed, name) : null
  } catch {
    return null
  }
}

function listYamlThemes(): ThemeListItem[] {
  const fs = lazyRequire<FsModule>('fs')
  const path = lazyRequire<PathModule>('path')
  const themesDir = getYamlThemesDir()

  if (!fs || !path || !themesDir || !fs.existsSync(themesDir)) {
    return []
  }

  try {
    return fs
      .readdirSync(themesDir)
      .filter(file => YAML_THEME_EXT.test(file))
      .map(file => path.basename(file).replace(YAML_THEME_EXT, ''))
      .filter(name => !RETIRED_SKINS.has(name))
      .map(name => {
        const definition = loadYamlTheme(name) ?? undefined

        return {
          name,
          label: definition?.label || titleCase(name),
          description: definition?.description || 'Custom dashboard theme',
          definition
        }
      })
  } catch {
    return []
  }
}

// ─── Color math (for synthesised light variants of dark-only skins) ────────

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '')

  if (!/^[0-9a-f]{6}$/i.test(clean)) {
    return null
  }

  return [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number]
}

const rgbToHex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('')}`

function mix(a: string, b: string, amount: number): string {
  const ar = hexToRgb(a)
  const br = hexToRgb(b)

  return ar && br
    ? rgbToHex([ar[0] + (br[0] - ar[0]) * amount, ar[1] + (br[1] - ar[1]) * amount, ar[2] + (br[2] - ar[2]) * amount])
    : a
}

function readableOn(hex: string): string {
  const rgb = hexToRgb(hex)

  if (!rgb) {
    return '#ffffff'
  }

  const [r, g, b] = rgb.map(v => {
    const c = v / 255

    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.58 ? '#161616' : '#ffffff'
}

function synthLightColors(seed: DesktopTheme): DesktopThemeColors {
  const accent = seed.colors.ring || seed.colors.primary
  const soft = mix('#ffffff', accent, 0.1)
  const softer = mix('#ffffff', accent, 0.06)
  const border = mix('#ececef', accent, 0.14)
  const midground = seed.colors.midground ?? accent

  return {
    background: '#ffffff',
    foreground: '#161616',
    card: '#ffffff',
    cardForeground: '#161616',
    muted: softer,
    mutedForeground: mix('#6b6b70', accent, 0.16),
    popover: '#ffffff',
    popoverForeground: '#161616',
    primary: accent,
    primaryForeground: readableOn(accent),
    secondary: soft,
    secondaryForeground: mix('#2a2a2a', accent, 0.34),
    accent: soft,
    accentForeground: mix('#2a2a2a', accent, 0.34),
    border,
    input: mix('#e2e2e6', accent, 0.18),
    ring: accent,
    midground,
    midgroundForeground: readableOn(midground),
    destructive: '#b94a3a',
    destructiveForeground: '#ffffff',
    sidebarBackground: mix('#fafafa', accent, 0.05),
    sidebarBorder: border,
    userBubble: soft,
    userBubbleBorder: border
  }
}

/** Returns the seed palette for a given skin + mode (no overrides applied). */
export function getBaseColors(skinName: string, mode: 'light' | 'dark'): DesktopThemeColors {
  const seed = BUILTIN_THEMES[skinName] ?? loadYamlTheme(skinName) ?? nousTheme

  if (mode === 'dark') {
    return seed.darkColors ?? seed.colors
  }

  return seed.darkColors ? seed.colors : synthLightColors(seed)
}

function deriveTheme(skinName: string, mode: 'light' | 'dark'): DesktopTheme {
  const seed = BUILTIN_THEMES[skinName] ?? loadYamlTheme(skinName) ?? nousTheme

  return {
    ...seed,
    name: `${skinName}-${mode}`,
    label: `${seed.label} ${mode === 'light' ? 'Light' : 'Dark'}`,
    description: `${seed.label} ${mode} palette`,
    colors: getBaseColors(skinName, mode)
  }
}

/**
 * Some palettes intentionally keep a bright background even when
 * `mode === 'dark'`, so we shouldn't apply the `.dark` class. Decide from
 * the actual background luminance.
 */
function renderedModeFor(colors: DesktopThemeColors, mode: 'light' | 'dark'): 'light' | 'dark' {
  const rgb = hexToRgb(colors.background)

  if (!rgb) {
    return mode
  }

  const [r, g, b] = rgb.map(v => v / 255)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? 'light' : 'dark'
}

// ─── CSS application ────────────────────────────────────────────────────────

// Per-mode mix knobs. Light/dark fallbacks live in styles.css `:root` /
// `:root.dark`; setting them inline keeps active-skin overrides surviving
// the boot-time paint.
const mixesFor = (isDark: boolean): Record<string, string> => ({
  '--theme-mix-chrome': isDark ? '74%' : '92%',
  '--theme-mix-sidebar': '100%',
  '--theme-mix-card': isDark ? '38%' : '22%',
  '--theme-mix-elevated': isDark ? '46%' : '28%',
  '--theme-mix-bubble': isDark ? '46%' : '0%'
})

function applyTheme(theme: DesktopTheme, mode: 'light' | 'dark') {
  if (typeof document === 'undefined') {
    return
  }

  const root = document.documentElement
  const c = theme.colors
  const typo = { ...DEFAULT_TYPOGRAPHY, ...nousTheme.typography, ...theme.typography }
  const rendered = renderedModeFor(c, mode)
  const isDark = rendered === 'dark'
  const midground = c.midground ?? c.ring
  const skinName = theme.name.endsWith(`-${mode}`) ? theme.name.slice(0, -mode.length - 1) : theme.name

  root.style.setProperty('color-scheme', rendered)
  root.dataset.hermesTheme = skinName
  root.dataset.hermesMode = rendered
  root.classList.toggle('dark', isDark)

  // Brand seeds feed every glass + shadcn token via `color-mix()` in styles.css.
  const seeds: Record<string, string> = {
    '--theme-foreground': c.foreground,
    '--theme-primary': c.primary,
    '--theme-secondary': c.secondary,
    '--theme-accent-soft': c.accent,
    '--theme-midground': midground,
    '--theme-warm': c.primary,
    '--theme-background-seed': c.background,
    '--theme-sidebar-seed': c.sidebarBackground ?? c.background,
    '--theme-card-seed': c.card,
    '--theme-elevated-seed': c.popover,
    '--theme-bubble-seed': c.userBubble ?? c.popover
  }

  // shadcn/Tailwind tokens that aren't derived from the seed chain.
  const palette: Record<string, string> = {
    '--dt-primary-foreground': c.primaryForeground,
    '--dt-secondary-foreground': c.secondaryForeground,
    '--dt-accent-foreground': c.accentForeground,
    '--dt-border': c.border,
    '--dt-input': c.input,
    '--dt-ring': c.ring,
    '--dt-muted': c.muted,
    '--dt-midground-foreground': c.midgroundForeground ?? readableOn(midground),
    '--dt-composer-ring': c.composerRing ?? midground,
    '--dt-destructive': c.destructive,
    '--dt-destructive-foreground': c.destructiveForeground,
    '--dt-sidebar-border': c.sidebarBorder ?? c.border,
    '--dt-user-bubble-border': c.userBubbleBorder ?? c.border,
    '--dt-base-size': typo.baseSize ?? DEFAULT_TYPOGRAPHY.baseSize ?? '1rem',
    '--dt-font-sans': typo.fontSans,
    '--dt-font-mono': typo.fontMono,
    '--dt-letter-spacing': typo.letterSpacing ?? DEFAULT_TYPOGRAPHY.letterSpacing ?? '0',
    '--dt-line-height': String(typo.lineHeight ?? DEFAULT_TYPOGRAPHY.lineHeight ?? 1.5),
    '--noise-opacity-mul': isDark ? 'calc(0.04 / 0.21)' : 'calc(0.34 / 0.21)'
  }

  for (const [k, v] of Object.entries({ ...seeds, ...mixesFor(isDark), ...palette })) {
    root.style.setProperty(k, v)
  }

  window.hermesDesktop?.setTitleBarTheme?.({
    background: c.background,
    foreground: c.foreground
  })

  if (typo.fontUrl && !INJECTED_FONT_URLS.has(typo.fontUrl)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = typo.fontUrl
    link.dataset.hermesThemeFont = 'true'
    document.head.appendChild(link)
    INJECTED_FONT_URLS.add(typo.fontUrl)
  }
}

// Boot-time paint to avoid a flash before <ThemeProvider> mounts.
if (typeof window !== 'undefined') {
  const skin = normalizeSkin(window.localStorage.getItem(SKIN_KEY))
  const mode = (window.localStorage.getItem(MODE_KEY) as ThemeMode) ?? 'light'
  const resolved = resolveMode(mode)
  applyTheme(deriveTheme(skin, resolved), resolved)
}

// ─── Context ────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: DesktopTheme
  themeName: string
  mode: ThemeMode
  resolvedMode: 'light' | 'dark'
  availableThemes: ThemeListItem[]
  setTheme: (name: string) => void
  setMode: (mode: ThemeMode) => void
}

const SKIN_LIST: ThemeListItem[] = BUILTIN_THEME_LIST.map(definition => ({
  name: definition.name,
  label: definition.label,
  description: definition.description,
  definition
}))

const YAML_THEME_LIST: ThemeListItem[] = listYamlThemes()

export const ALL_SKINS: ThemeListItem[] = [
  ...SKIN_LIST,
  ...YAML_THEME_LIST.filter(theme => !BUILTIN_THEMES[theme.name])
]

const ThemeContext = createContext<ThemeContextValue>({
  theme: nousTheme,
  themeName: DEFAULT_SKIN_NAME,
  mode: 'light',
  resolvedMode: 'light',
  availableThemes: ALL_SKINS,
  setTheme: () => {},
  setMode: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeNameState] = useState(() =>
    typeof window === 'undefined' ? DEFAULT_SKIN_NAME : normalizeSkin(window.localStorage.getItem(SKIN_KEY))
  )

  const [mode, setModeState] = useState<ThemeMode>(() =>
    typeof window === 'undefined' ? 'light' : ((window.localStorage.getItem(MODE_KEY) as ThemeMode) ?? 'light')
  )

  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolvedMode = resolveMode(mode, systemDark)
  const [availableThemes, setAvailableThemes] = useState(ALL_SKINS)
  const [customThemeVersion, setCustomThemeVersion] = useState(0)

  const activeTheme = useMemo(() => {
    void customThemeVersion

    return deriveTheme(themeName, resolvedMode)
  }, [themeName, resolvedMode, customThemeVersion])

  useEffect(() => applyTheme(activeTheme, resolvedMode), [activeTheme, resolvedMode])

  useEffect(() => {
    let cancelled = false

    window.hermesDesktop
      ?.listDashboardThemes?.()
      .then(themes => {
        if (cancelled) {
          return
        }

        const customThemes = themes
          .map((theme, index) => {
            if (!theme || typeof theme !== 'object') {
              return null
            }

            const { name, source } = theme as { name?: unknown; source?: unknown }
            const fallbackName = stringValue(name) || `custom-${index}`

            if (typeof source === 'string') {
              try {
                const parsed = loadYaml(source)

                return parsed && typeof parsed === 'object' ? themeFromRaw(parsed as RawThemeRecord, fallbackName) : null
              } catch {
                return null
              }
            }

            return themeFromRaw(theme as RawThemeRecord, fallbackName)
          })
          .filter((theme): theme is DesktopTheme => theme !== null && !RETIRED_SKINS.has(theme.name))

        for (const theme of customThemes) {
          CUSTOM_THEMES.set(theme.name, theme)
        }

        setAvailableThemes([
          ...SKIN_LIST,
          ...customThemes
            .filter(theme => !BUILTIN_THEMES[theme.name])
            .map(definition => ({
              name: definition.name,
              label: definition.label,
              description: definition.description,
              definition
            }))
        ])
        setCustomThemeVersion(version => version + 1)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  const setTheme = useCallback((name: string) => {
    const next = normalizeSkin(name)
    setThemeNameState(next)
    window.localStorage.setItem(SKIN_KEY, next)
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    window.localStorage.setItem(MODE_KEY, next)
  }, [])

  // The light/dark toggle (Shift+X by default) is owned by the keybind runtime
  // (`appearance.toggleMode`) so it shows up in the hotkey map and is rebindable.

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: activeTheme, themeName, mode, resolvedMode, availableThemes, setTheme, setMode }),
    [activeTheme, themeName, mode, resolvedMode, availableThemes, setTheme, setMode]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeContextValue => useContext(ThemeContext)

/** Sync the desktop skin with the active Hermes backend theme on connect. */
export function useSyncThemeFromBackend(backendThemeName: string | undefined, setTheme: (name: string) => void) {
  useEffect(() => {
    if (backendThemeName && !RETIRED_SKINS.has(backendThemeName)) {
      setTheme(backendThemeName)
    }
  }, [backendThemeName, setTheme])
}
