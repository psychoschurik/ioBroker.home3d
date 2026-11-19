// The flags a wind indicator of the kind "flag" can fly (furniture field `gear_flag`). Drawn by rule as the colour at a
// point of the cloth, not from pictures (the page loads nothing from outside). Pure: the 3D view makes its texture from
// flagPixels (wind-vane.ts), the editor its list from flagChoices.

/** RGB, 0 … 255 (sRGB). */
export type Rgb = readonly [number, number, number];

interface Design {
    /** Height to length. */
    aspect: number;
    /** The colour at `x` from the pole and `y` from the top, both 0 … 1 of the length and the height. */
    color(x: number, y: number): Rgb;
}

const rgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

const WHITE = rgb(0xffffff);

/** Stripes of equal width: from the top (`y`) or from the pole (`x`). */
function stripes(aspect: number, across: 'rows' | 'columns', colors: readonly number[]): Design {
    const c = colors.map(rgb);
    return {
        aspect,
        color: (x, y) => c[Math.min(c.length - 1, Math.floor((across === 'rows' ? y : x) * c.length))],
    };
}

/** A cross off the centre towards the pole (Scandinavia): in units of the flag (`w` × `h`), later crosses over earlier. */
function nordic(
    w: number,
    h: number,
    field: number,
    crosses: readonly { color: number; x: readonly [number, number]; y: readonly [number, number] }[],
): Design {
    const f = rgb(field);
    const cs = crosses.map(c => ({ ...c, rgb: rgb(c.color) }));
    return {
        aspect: h / w,
        color: (x, y) => {
            const X = x * w;
            const Y = y * h;
            let out = f;
            for (const c of cs) {
                if ((X >= c.x[0] && X < c.x[1]) || (Y >= c.y[0] && Y < c.y[1])) {
                    out = c.rgb;
                }
            }
            return out;
        },
    };
}

/** Whether (px, py) lies in a five-pointed star with one point up (y down), outer radius `r`. */
export function inStar(px: number, py: number, cx: number, cy: number, r: number): boolean {
    const dx = px - cx;
    const dy = py - cy;
    const d = Math.hypot(dx, dy);
    if (d > r) {
        return false;
    }
    // the angle from the upper point, folded into the half of one point (0 … 36°)
    const sector = (2 * Math.PI) / 5;
    let a = Math.atan2(dx, -dy);
    a = ((a % sector) + sector) % sector;
    if (a > sector / 2) {
        a = sector - a;
    }
    // inside: on the centre's side of the edge from the point (r, 0) to the inner corner
    const inner = r * 0.381966;
    const ix = inner * Math.cos(sector / 2);
    const iy = inner * Math.sin(sector / 2);
    return (ix - r) * (d * Math.sin(a)) - iy * (d * Math.cos(a) - r) >= 0;
}

const US_RED = rgb(0xb22234);
const US_BLUE = rgb(0x3c3b6e);
const EU_BLUE = rgb(0x003399);
const EU_GOLD = rgb(0xffcc00);
const GR_BLUE = rgb(0x0d5eaf);
const GB_BLUE = rgb(0x012169);
const GB_RED = rgb(0xc8102e);
const CZ_BLUE = rgb(0x11457e);
const CZ_RED = rgb(0xd7141a);
const CH_RED = rgb(0xda291c);

const DESIGNS: Record<string, Design> = {
    // the flag drawn before there was a choice: dark blue over white, no country
    plain: stripes(0.62, 'rows', [0x1f4fbf, 0xf2f4f7]),
    de: stripes(3 / 5, 'rows', [0x000000, 0xdd0000, 0xffce00]),
    at: stripes(2 / 3, 'rows', [0xc8102e, 0xffffff, 0xc8102e]),
    // square, the white cross with arms a sixth longer than wide
    ch: {
        aspect: 1,
        color: (x, y) => {
            const X = Math.abs(x * 32 - 16);
            const Y = Math.abs(y * 32 - 16);
            return (X < 3 && Y < 10) || (Y < 3 && X < 10) ? WHITE : CH_RED;
        },
    },
    fr: stripes(2 / 3, 'columns', [0x0055a4, 0xffffff, 0xef4135]),
    it: stripes(2 / 3, 'columns', [0x009246, 0xffffff, 0xce2b37]),
    ru: stripes(2 / 3, 'rows', [0xffffff, 0x0039a6, 0xd52b1e]),
    ua: stripes(2 / 3, 'rows', [0x0057b7, 0xffd700]),
    // nine stripes, the white cross in a blue square over five of them
    gr: {
        aspect: 2 / 3,
        color: (x, y) => {
            const X = x * 1.5;
            if (X < 5 / 9 && y < 5 / 9) {
                return Math.abs(X - 5 / 18) < 1 / 18 || Math.abs(y - 5 / 18) < 1 / 18 ? WHITE : GR_BLUE;
            }
            return Math.floor(y * 9) % 2 ? WHITE : GR_BLUE;
        },
    },
    // twelve golden stars in a circle, each with one point up
    eu: {
        aspect: 2 / 3,
        color: (x, y) => {
            const X = x * 1.5 - 0.75;
            const Y = y - 0.5;
            const r = 1 / 18;
            if (Math.abs(Math.hypot(X, Y) - 1 / 3) <= r) {
                for (let i = 0; i < 12; i++) {
                    const a = (i * Math.PI) / 6;
                    if (inStar(X, Y, Math.sin(a) / 3, -Math.cos(a) / 3, r)) {
                        return EU_GOLD;
                    }
                }
            }
            return EU_BLUE;
        },
    },
    // the Union Flag (60 × 30): the red saltire counterchanged, the broad white above it at the pole
    gb: {
        aspect: 1 / 2,
        color: (x, y) => {
            const X = x * 60;
            const Y = y * 30;
            if (Math.abs(X - 30) < 3 || Math.abs(Y - 15) < 3) {
                return GB_RED;
            }
            if (Math.abs(X - 30) < 5 || Math.abs(Y - 15) < 5) {
                return WHITE;
            }
            const hoist = X < 30;
            // the diagonal through this quarter, and how far below it the point lies (perpendicular)
            const line = hoist === Y < 15 ? X / 2 : 30 - X / 2;
            const below = ((Y - line) * 2) / Math.sqrt(5);
            if (Math.abs(below) < 3) {
                return (hoist ? below > 0 && below < 2 : below < 0 && below > -2) ? GB_RED : WHITE;
            }
            return GB_BLUE;
        },
    },
    // 13 stripes, 50 stars in 9 rows of 6 and 5 (in units of the height)
    us: {
        aspect: 10 / 19,
        color: (x, y) => {
            const X = x * 1.9;
            if (X < 0.76 && y < 7 / 13) {
                const row = Math.round(y / 0.054 - 1);
                for (let i = Math.max(0, row - 1); i <= Math.min(8, row + 1); i++) {
                    const six = i % 2 === 0;
                    const first = six ? 0.063 : 0.126;
                    const k = Math.min(six ? 5 : 4, Math.max(0, Math.round((X - first) / 0.126)));
                    if (inStar(X, y, first + k * 0.126, 0.054 * (i + 1), 0.0308)) {
                        return WHITE;
                    }
                }
                return US_BLUE;
            }
            return Math.floor(y * 13) % 2 ? WHITE : US_RED;
        },
    },
    nl: stripes(2 / 3, 'rows', [0xae1c28, 0xffffff, 0x21468b]),
    be: stripes(2 / 3, 'columns', [0x000000, 0xfdda24, 0xef3340]),
    // the civil flag, without the coat of arms: the yellow twice as high as each red
    es: stripes(2 / 3, 'rows', [0xaa151b, 0xf1bf00, 0xf1bf00, 0xaa151b]),
    pl: stripes(5 / 8, 'rows', [0xffffff, 0xdc143c]),
    // the blue wedge from the pole to the middle of the flag
    cz: {
        aspect: 2 / 3,
        color: (x, y) => (x < 0.5 * (1 - Math.abs(2 * y - 1)) ? CZ_BLUE : y < 0.5 ? WHITE : CZ_RED),
    },
    hu: stripes(1 / 2, 'rows', [0xce2939, 0xffffff, 0x477050]),
    ie: stripes(1 / 2, 'columns', [0x169b62, 0xffffff, 0xff883e]),
    dk: nordic(37, 28, 0xc8102e, [{ color: 0xffffff, x: [12, 16], y: [12, 16] }]),
    se: nordic(16, 10, 0x006aa7, [{ color: 0xfecc02, x: [5, 7], y: [4, 6] }]),
    no: nordic(22, 16, 0xba0c2f, [
        { color: 0xffffff, x: [6, 10], y: [6, 10] },
        { color: 0x00205b, x: [7, 9], y: [7, 9] },
    ]),
    fi: nordic(18, 11, 0xffffff, [{ color: 0x002f6c, x: [5, 8], y: [4, 7] }]),
};

/** The flags to choose from: the plain one, then countries (ISO 3166 codes, lower case) and the EU. */
export const FLAG_DESIGNS = Object.keys(DESIGNS);

/** A known design; anything else (not set, unknown): the plain flag. */
export function flagDesign(id: string | null | undefined): string {
    return id && Object.prototype.hasOwnProperty.call(DESIGNS, id) ? id : 'plain';
}

/** Height to length of a flag. */
export function flagAspect(id: string | null | undefined): number {
    return DESIGNS[flagDesign(id)].aspect;
}

/** The colour of a flag at `x` from the pole and `y` from the top (0 … 1). */
export function flagColor(id: string | null | undefined, x: number, y: number): Rgb {
    return DESIGNS[flagDesign(id)].color(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
}

/**
 * The picture of a flag, `w` × `h` pixels RGBA, the pole on the left; row 0 is the bottom (as a texture reads its
 * data). Every pixel is the mean of 3 × 3 samples: the edges of stripes, crosses and stars stay smooth.
 */
export function flagPixels(id: string | null | undefined, w: number, h: number): Uint8Array {
    const design = DESIGNS[flagDesign(id)];
    const out = new Uint8Array(w * h * 4);
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            let r = 0;
            let g = 0;
            let b = 0;
            for (let sy = 0; sy < 3; sy++) {
                for (let sx = 0; sx < 3; sx++) {
                    const c = design.color((i + (sx + 0.5) / 3) / w, 1 - (j + (sy + 0.5) / 3) / h);
                    r += c[0];
                    g += c[1];
                    b += c[2];
                }
            }
            const o = (j * w + i) * 4;
            out[o] = Math.round(r / 9);
            out[o + 1] = Math.round(g / 9);
            out[o + 2] = Math.round(b / 9);
            out[o + 3] = 255;
        }
    }
    return out;
}

/** The name of a country's flag in a language (from the browser); null for the plain flag or without Intl. */
export function flagName(id: string, lang: string): string | null {
    if (id === 'plain' || !DESIGNS[id]) {
        return null;
    }
    try {
        return new Intl.DisplayNames([lang, 'en'], { type: 'region' }).of(id.toUpperCase()) ?? id.toUpperCase();
    } catch {
        return id.toUpperCase();
    }
}

/** The choices for the editor: the plain flag first (named `plain`), then the countries by their names. */
export function flagChoices(lang: string, plain: string): { id: string; name: string }[] {
    const countries = FLAG_DESIGNS.filter(id => id !== 'plain')
        .map(id => ({ id, name: flagName(id, lang) ?? id.toUpperCase() }))
        .sort((a, b) => a.name.localeCompare(b.name, lang));
    return [{ id: 'plain', name: plain }, ...countries];
}
