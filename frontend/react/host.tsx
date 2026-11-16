// Shows React dialogs (MUI, @iobroker/gui-components) on top of the page. This module and everything it imports is
// loaded on demand, so the 3D view starts without React.
import { I18n, Theme, type IobTheme } from '@iobroker/gui-components';
import { ThemeProvider } from '@mui/material/styles';
import { type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

type Words = Record<string, string>;
/** The texts of gui-components, one chunk per language: only the language of the system is loaded. */
const WORDS: Record<string, () => Promise<{ default: Words }>> = {
    en: () => import('@iobroker/gui-components/build/i18n/en.json'),
    de: () => import('@iobroker/gui-components/build/i18n/de.json'),
    ru: () => import('@iobroker/gui-components/build/i18n/ru.json'),
    pt: () => import('@iobroker/gui-components/build/i18n/pt.json'),
    nl: () => import('@iobroker/gui-components/build/i18n/nl.json'),
    fr: () => import('@iobroker/gui-components/build/i18n/fr.json'),
    it: () => import('@iobroker/gui-components/build/i18n/it.json'),
    es: () => import('@iobroker/gui-components/build/i18n/es.json'),
    pl: () => import('@iobroker/gui-components/build/i18n/pl.json'),
    uk: () => import('@iobroker/gui-components/build/i18n/uk.json'),
    'zh-cn': () => import('@iobroker/gui-components/build/i18n/zh-cn.json'),
};

let theme: IobTheme | null = null;
let ready: Promise<void> | null = null;

/** The dark theme of ioBroker. */
export function iobTheme(): IobTheme {
    theme ??= Theme('dark');
    return theme;
}

/** Language and texts for gui-components, once. */
function prepare(language: string): Promise<void> {
    ready ??= (async () => {
        const lang = WORDS[language] ? language : 'en';
        try {
            // I18n warns "Used unknown language" when it creates the dictionary of a language itself
            const global = window as unknown as { i18nTranslations?: Record<string, Words> };
            global.i18nTranslations ??= {};
            global.i18nTranslations[lang] ??= {};
            I18n.extendTranslations((await WORDS[lang]()).default, lang as ioBroker.Languages);
        } catch (e) {
            // without the texts the dialogs still work, they show the keys
            console.warn(`home3d: texts of gui-components (${lang}) not loaded: ${(e as Error).message}`);
        }
        // after the texts: I18n only knows a language it has words for
        I18n.setLanguage(lang as ioBroker.Languages);
    })();
    return ready;
}

/** Renders a dialog; `close` removes it again. */
export async function show(language: string, render: (close: () => void) => ReactNode): Promise<() => void> {
    await prepare(language);
    const container = document.createElement('div');
    (document.getElementById('react-root') ?? document.body).append(container);
    const root = createRoot(container);
    const close = (): void => {
        root.unmount();
        container.remove();
    };
    root.render(<ThemeProvider theme={iobTheme()}>{render(close)}</ThemeProvider>);
    return close;
}
