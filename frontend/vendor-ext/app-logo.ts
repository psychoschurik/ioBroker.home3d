// What a TV shows while its app has no picture of its own (YouTube while one looks for a video, before one plays):
// the app's logo, or its name, drawn here as a 16:9 picture for the screen (tasks.ts patches components/view3d.ts).
// Nothing is loaded from outside.

/** The app a media player reports (`app_name`, else `source` or `app_id`); null: none known. */
export function appOf(attributes: Record<string, unknown>): { key: string; name: string } | null {
    const texts = [attributes.app_name, attributes.source, attributes.app_id].filter(
        (v): v is string => typeof v === 'string' && !!v.trim(),
    );
    const name = texts[0];
    if (!name) {
        return null;
    }
    const text = texts.join(' ').toLowerCase();
    return { key: text.includes('youtube') ? 'youtube' : name.trim().toLowerCase(), name: name.trim() };
}

const cache = new Map<string, string | null>();

function canvas(): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const ctx = c.getContext('2d');
    return ctx ? { c, ctx } : null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** The play button and the word on the dark screen of the app. */
function youtube(): string | null {
    const p = canvas();
    if (!p) {
        return null;
    }
    const { c, ctx } = p;
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = '700 76px "Segoe UI", Roboto, Arial, sans-serif';
    const word = 'YouTube';
    const tw = ctx.measureText(word).width;
    const bw = 150;
    const bh = 106;
    const gap = 16;
    const x0 = (c.width - (bw + gap + tw)) / 2;
    const y0 = (c.height - bh) / 2;
    ctx.fillStyle = '#ff0033';
    roundRect(ctx, x0, y0, bw, bh, 28);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x0 + bw * 0.4, y0 + bh * 0.29);
    ctx.lineTo(x0 + bw * 0.4, y0 + bh * 0.71);
    ctx.lineTo(x0 + bw * 0.68, y0 + bh * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.fillText(word, x0 + bw + gap, c.height / 2 + 4, c.width - (x0 + bw + gap));
    return c.toDataURL('image/png');
}

/** Any other app: its name, large, under a bar in its colour. */
function named(name: string, color: string): string | null {
    const p = canvas();
    if (!p) {
        return null;
    }
    const { c, ctx } = p;
    ctx.fillStyle = '#101418';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = color;
    roundRect(ctx, c.width / 2 - 60, c.height / 2 - 70, 120, 12, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 64px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, c.width / 2, c.height / 2 + 20, c.width - 60);
    return c.toDataURL('image/png');
}

/**
 * What a TV's screen shows: the picture of what plays (or is paused), else, as while one looks for a video (idle; the
 * picture of the last video may still be set then), the logo of its app; the picture when no app is known.
 */
export function screenPicture(
    st: { state: string; attributes: Record<string, unknown> },
    color: readonly number[] | null,
): string | null {
    const picture =
        typeof st.attributes.entity_picture === 'string' && st.attributes.entity_picture
            ? st.attributes.entity_picture
            : null;
    if (picture && ['playing', 'paused', 'buffering'].includes(st.state)) {
        return picture;
    }
    return appLogo(st.attributes, color) ?? picture;
}

/**
 * The picture for a TV whose app shows none of its own: the logo of YouTube, the name of another app (in `color`, the
 * colour the screen glows in, as r, g, b 0–1); null without an app.
 */
export function appLogo(attributes: Record<string, unknown>, color: readonly number[] | null): string | null {
    const app = appOf(attributes);
    if (!app || typeof document === 'undefined') {
        return null;
    }
    const css = color ? `rgb(${color.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})` : '#38e0ff';
    const key = app.key === 'youtube' ? 'youtube' : `${app.name}|${css}`;
    if (!cache.has(key)) {
        cache.set(key, app.key === 'youtube' ? youtube() : named(app.name, css));
    }
    return cache.get(key) ?? null;
}
