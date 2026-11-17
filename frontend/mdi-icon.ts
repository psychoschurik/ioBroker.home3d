// `<ha-icon icon="mdi:…">`: the 3D frontend draws own symbols with the icon element of its original host. Here it is
// a small element that draws the Material Design icon as SVG (@mdi/js). The symbols the page uses itself are bundled;
// any other name (a symbol typed in the editor) loads the whole set once, on demand.
import { BUNDLED, bundledPath, exportName } from './vendor-ext/mdi-paths.js';

export { bundledPath, exportName };

let all: Promise<Record<string, string>> | null = null;

/** The SVG path of a symbol: bundled ones at once, any other after loading the whole set (null: no such symbol). */
export async function iconPath(icon: string): Promise<string | null> {
    const key = exportName(icon);
    if (BUNDLED[key]) {
        return BUNDLED[key];
    }
    // another file of the package than the bundled symbols: so the whole set becomes a chunk of its own
    all ??= import('@mdi/js/commonjs/mdi.js').then(
        (m: Record<string, unknown>) => (m.default ?? m) as Record<string, string>,
    );
    try {
        const path = (await all)[key];
        return typeof path === 'string' ? path : null;
    } catch {
        return null;
    }
}

const svg = (path: string): string =>
    `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" style="display:block"><path fill="currentColor" d="${path}"/></svg>`;

class HaIcon extends HTMLElement {
    static observedAttributes = ['icon'];
    private shown = '';

    connectedCallback(): void {
        this.style.display ||= 'inline-block';
        this.style.width ||= 'var(--mdc-icon-size, 24px)';
        this.style.height ||= 'var(--mdc-icon-size, 24px)';
        this.style.verticalAlign ||= 'middle';
        this.draw();
    }

    attributeChangedCallback(): void {
        this.draw();
    }

    /** The `icon` property, as the original element has it. */
    set icon(value: string) {
        this.setAttribute('icon', value);
    }

    get icon(): string {
        return this.getAttribute('icon') || '';
    }

    private draw(): void {
        const icon = this.icon;
        this.setAttribute('aria-label', icon.replace(/^mdi:/, ''));
        if (icon === this.shown) {
            return;
        }
        this.shown = icon;
        const now = bundledPath(icon);
        if (now) {
            this.innerHTML = svg(now);
            return;
        }
        this.innerHTML = '';
        void iconPath(icon).then(path => {
            // the symbol may have changed while the set was loading
            if (this.shown === icon) {
                this.innerHTML = path ? svg(path) : '';
            }
        });
    }
}

if (!customElements.get('ha-icon')) {
    customElements.define('ha-icon', HaIcon);
}
