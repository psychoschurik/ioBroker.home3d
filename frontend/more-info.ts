// Details of a device, opened by the 3D frontend with the event `hass-more-info` (a tap on a sensor, a name in the room
// panel). The original host has its own dialog for this; here: the value now, switching for lights and switches, and the
// history from the history adapter of ioBroker – a curve for measured values (temperature with the humidity of the same
// device), the on/off times for contacts, motion, water and smoke.
import type { CallWS, Hass } from './types.js';
import { sensorIcon } from './vendor-ext/sensor-look.js';

interface Row {
    s: string;
    lu: number;
}
interface Entity {
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
    last_changed?: string;
}
interface Options {
    callWS: CallWS;
    getHass: () => Hass | undefined;
}

const RANGES: { label: string; ms: number }[] = [
    { label: '6 h', ms: 6 * 3600e3 },
    { label: '24 h', ms: 24 * 3600e3 },
    { label: '7 Tage', ms: 7 * 24 * 3600e3 },
    { label: '30 Tage', ms: 30 * 24 * 3600e3 },
];
const COLORS = ['#f5a623', '#4fc3f7'];
const STYLE = `
.mi{max-width:720px}.mi-head{display:flex;align-items:center;gap:14px}.mi-icon{display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:#2b3d4e;color:#8fd0f3;--mdc-icon-size:26px;flex-shrink:0}
.mi-icon.on{background:#f5a623;color:#1b2631}.mi-name{flex:1;min-width:0}.mi-name h2{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mi-name small{color:#8faabd;font-size:11px;word-break:break-all}
.mi-close{border:0;background:transparent;font-size:22px;padding:4px 10px}.mi-now{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin:18px 0 6px}.mi-value{font-size:34px;font-weight:500}.mi-value small{font-size:16px;color:#a9bdce;margin-left:4px}
.mi-since{color:#8faabd;font-size:12px}.mi-actions{display:flex;gap:8px;margin:10px 0}.mi-ranges{display:flex;gap:6px;margin:16px 0 8px;flex-wrap:wrap}.mi-ranges button{padding:5px 12px;font-size:12px}.mi-ranges button[aria-pressed=true]{background:#288cbd;border-color:#288cbd;color:#fff}
.mi-chart{position:relative;height:220px;background:#1b2631;border:1px solid #314151;border-radius:6px}.mi-chart svg{display:block;width:100%;height:100%}.mi-chart text{font-size:10px;fill:#8faabd}
.mi-tip{position:absolute;pointer-events:none;background:#263544;border:1px solid #4a5c6c;border-radius:4px;padding:4px 8px;font-size:12px;white-space:nowrap;transform:translate(-50%,-110%);display:none}
.mi-legend{display:flex;gap:16px;font-size:12px;color:#a9bdce;margin-top:6px}.mi-legend i{display:inline-block;width:12px;height:3px;margin-right:6px;vertical-align:middle}
.mi-empty{display:grid;place-items:center;height:100%;color:#8faabd;font-size:13px;padding:0 20px;text-align:center}.mi-list{margin-top:12px;max-height:180px;overflow:auto;font-size:13px}.mi-list div{display:flex;justify-content:space-between;padding:6px 2px;border-bottom:1px solid #314151}
`;

const domain = (id: string): string => id.slice(0, id.indexOf('.'));
/** A value as text; objects count as none. */
const text = (v: unknown, fallback = ''): string =>
    typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : fallback;

/** Words for on/off by what the device reports. */
function binaryText(e: Entity, state = e.state): string {
    const on = state === 'on';
    if (state === 'unavailable' || state === 'unknown') {
        return 'nicht erreichbar';
    }
    switch (text(e.attributes.device_class)) {
        case 'door':
        case 'window':
        case 'opening':
        case 'garage_door':
            return on ? 'offen' : 'geschlossen';
        case 'moisture':
            return on ? 'Wasser erkannt' : 'trocken';
        case 'smoke':
        case 'heat':
            return on ? 'Rauch / Feuer!' : 'kein Rauch';
        case 'gas':
        case 'carbon_monoxide':
            return on ? 'Gas erkannt' : 'kein Gas';
        case 'motion':
        case 'occupancy':
        case 'presence':
            return on ? 'Bewegung' : 'keine Bewegung';
        case 'plug':
        case 'power':
            return on ? 'Strom da' : 'kein Strom';
        default:
            return on ? 'an' : 'aus';
    }
}

function esc(text: string): string {
    return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function setupMoreInfo({ callWS, getHass }: Options): void {
    let dialog: HTMLDialogElement | null = null;
    let current: string | null = null;
    let range = RANGES[1];
    let ticker: ReturnType<typeof setInterval> | undefined;
    let loading = 0;

    const fmt = (v: number, digits = 1): string =>
        new Intl.NumberFormat(getHass()?.language || 'de', { maximumFractionDigits: digits }).format(v);
    const dateFmt = (t: number, withDate: boolean): string =>
        new Date(t).toLocaleString(getHass()?.language || 'de', {
            ...(withDate ? { day: '2-digit', month: '2-digit' } : {}),
            hour: '2-digit',
            minute: '2-digit',
        });
    const entity = (id: string): Entity | undefined => getHass()?.states[id] as Entity | undefined;
    const numeric = (e: Entity): boolean => domain(e.entity_id) === 'sensor' && Number.isFinite(Number(e.state));
    const unitOf = (e: Entity): string => text(e.attributes.unit_of_measurement);
    const name = (e: Entity): string => text(e.attributes.friendly_name, e.entity_id);

    function make(): HTMLDialogElement {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.append(style);
        const d = document.createElement('dialog');
        d.className = 'mi';
        d.setAttribute('aria-labelledby', 'mi-title');
        d.innerHTML = `<div class="mi-head"><span class="mi-icon"></span><div class="mi-name"><h2 id="mi-title"></h2><small></small></div><button class="mi-close" aria-label="Schließen">✕</button></div>
<div class="mi-now"><span class="mi-value"></span><span class="mi-since"></span></div><div class="mi-actions"></div>
<div class="mi-ranges" role="group" aria-label="Zeitraum"></div><div class="mi-chart"></div><div class="mi-legend"></div><div class="mi-list"></div>`;
        d.querySelector('.mi-close')!.addEventListener('click', () => d.close());
        // a click on the backdrop closes it
        d.addEventListener('click', e => e.target === d && d.close());
        d.addEventListener('close', () => {
            clearInterval(ticker);
            current = null;
        });
        document.body.append(d);
        return d;
    }

    /** The value now, the symbol and the switch buttons. */
    function showNow(): void {
        const e = current ? entity(current) : undefined;
        if (!dialog || !e) {
            return;
        }
        const on = e.state === 'on';
        const icon =
            sensorIcon(e) ??
            (domain(e.entity_id) === 'light'
                ? 'lightbulb'
                : domain(e.entity_id) === 'switch'
                  ? 'power-socket-de'
                  : 'gauge');
        const iconBox = dialog.querySelector('.mi-icon')!;
        iconBox.classList.toggle('on', on);
        if (iconBox.firstElementChild?.getAttribute('icon') !== `mdi:${icon}`) {
            iconBox.innerHTML = `<ha-icon icon="mdi:${icon}"></ha-icon>`;
        }
        dialog.querySelector('#mi-title')!.textContent = name(e);
        dialog.querySelector('.mi-name small')!.textContent = text(e.attributes.iobroker_id, e.entity_id);
        let value: string;
        if (numeric(e)) {
            value = `${fmt(Number(e.state))}<small>${esc(unitOf(e))}</small>`;
            const h = e.attributes.humidity;
            if (typeof h === 'number' && e.attributes.device_class === 'temperature') {
                value += ` · ${fmt(h, 0)}<small>%</small>`;
            }
        } else if (domain(e.entity_id) === 'light' && on && typeof e.attributes.brightness === 'number') {
            value = `an · ${fmt(e.attributes.brightness / 2.55, 0)}<small>%</small>`;
        } else if (['binary_sensor', 'light', 'switch', 'fan'].includes(domain(e.entity_id))) {
            value = esc(binaryText(e));
        } else {
            value = esc(e.state);
        }
        dialog.querySelector('.mi-value')!.innerHTML = value;
        const since = e.last_changed ? new Date(e.last_changed).getTime() : 0;
        dialog.querySelector('.mi-since')!.textContent =
            since > 0 ? `seit ${dateFmt(since, Date.now() - since > 20 * 3600e3)}` : '';
    }

    function actions(e: Entity): void {
        const box = dialog!.querySelector('.mi-actions')!;
        box.innerHTML = '';
        if (!['light', 'switch', 'fan'].includes(domain(e.entity_id))) {
            return;
        }
        for (const [label, service] of [
            ['Ein', 'turn_on'],
            ['Aus', 'turn_off'],
        ]) {
            const b = document.createElement('button');
            b.textContent = label;
            b.addEventListener('click', () => {
                void getHass()
                    ?.callService(domain(e.entity_id), service, { entity_id: e.entity_id })
                    .catch((err: Error) => alertText(err.message));
            });
            box.append(b);
        }
    }

    function alertText(text: string): void {
        const list = dialog!.querySelector('.mi-list')!;
        list.innerHTML = `<p role="alert">${esc(text)}</p>`;
    }

    function ranges(): void {
        const box = dialog!.querySelector('.mi-ranges')!;
        box.innerHTML = '';
        for (const r of RANGES) {
            const b = document.createElement('button');
            b.textContent = r.label;
            b.setAttribute('aria-pressed', String(r === range));
            b.addEventListener('click', () => {
                range = r;
                ranges();
                void history();
            });
            box.append(b);
        }
    }

    /** The series shown: the device, and for a temperature the humidity of the same device (attribute humidity_entity). */
    function series(e: Entity): string[] {
        const h = e.attributes.humidity_entity;
        return typeof h === 'string' && entity(h) ? [e.entity_id, h] : [e.entity_id];
    }

    async function history(): Promise<void> {
        const e = current ? entity(current) : undefined;
        if (!dialog || !e) {
            return;
        }
        const chart = dialog.querySelector('.mi-chart') as HTMLElement;
        const list = dialog.querySelector('.mi-list')!;
        const legend = dialog.querySelector('.mi-legend')!;
        chart.innerHTML = '<div class="mi-empty">Verlauf wird geladen …</div>';
        list.innerHTML = '';
        legend.innerHTML = '';
        const ids = series(e);
        const end = Date.now();
        const start = end - range.ms;
        const ticket = ++loading;
        let rows: Record<string, Row[]>;
        try {
            rows =
                (await callWS({
                    type: 'history/history_during_period',
                    start_time: new Date(start).toISOString(),
                    end_time: new Date(end).toISOString(),
                    entity_ids: ids,
                    minimal_response: true,
                    no_attributes: true,
                })) ?? {};
        } catch (err) {
            chart.innerHTML = `<div class="mi-empty">Verlauf nicht lesbar: ${esc((err as Error).message)}</div>`;
            return;
        }
        if (ticket !== loading || current !== e.entity_id) {
            return;
        }
        if (!ids.some(id => rows[id]?.length)) {
            chart.innerHTML =
                '<div class="mi-empty">Kein Verlauf. Für diesen Datenpunkt ist in ioBroker kein History-Adapter (history, influxdb, sql) aktiviert.</div>';
            return;
        }
        if (numeric(e)) {
            curve(chart, legend, ids, rows, start, end);
        } else {
            timeline(chart, e, rows[e.entity_id] ?? [], start, end);
            const changes = (rows[e.entity_id] ?? []).filter((r, i, all) => i === 0 || r.s !== all[i - 1].s).reverse();
            list.innerHTML = changes
                .slice(0, 50)
                .map(
                    r => `<div><span>${esc(binaryText(e, r.s))}</span><span>${dateFmt(r.lu * 1000, true)}</span></div>`,
                )
                .join('');
        }
    }

    /** Line chart of measured values; a second series (humidity) gets its own scale on the right. */
    function curve(
        chart: HTMLElement,
        legend: Element,
        ids: string[],
        rows: Record<string, Row[]>,
        start: number,
        end: number,
    ): void {
        const W = Math.max(320, chart.clientWidth || 640);
        const H = chart.clientHeight || 220;
        const pad = { l: 44, r: ids.length > 1 ? 44 : 12, t: 12, b: 24 };
        const x = (t: number): number => pad.l + ((t - start) / (end - start)) * (W - pad.l - pad.r);
        const data = ids.map(id =>
            (rows[id] ?? []).map(r => ({ t: r.lu * 1000, v: Number(r.s) })).filter(p => Number.isFinite(p.v)),
        );
        const scales = data.map(points => {
            let lo = Math.min(...points.map(p => p.v));
            let hi = Math.max(...points.map(p => p.v));
            if (!Number.isFinite(lo)) {
                lo = 0;
                hi = 1;
            }
            const span = hi - lo || Math.max(1, Math.abs(hi) * 0.1);
            return { lo: lo - span * 0.08, hi: hi + span * 0.08 };
        });
        const y = (v: number, i: number): number =>
            pad.t + (1 - (v - scales[i].lo) / (scales[i].hi - scales[i].lo)) * (H - pad.t - pad.b);
        const multiDay = end - start > 30 * 3600e3;
        let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
        for (let k = 0; k <= 4; k++) {
            const yy = pad.t + (k / 4) * (H - pad.t - pad.b);
            svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke="#2b3b4a"/>`;
            scales.forEach((s, i) => {
                const v = s.hi - (k / 4) * (s.hi - s.lo);
                svg += `<text x="${i ? W - pad.r + 4 : pad.l - 4}" y="${yy + 3}" text-anchor="${i ? 'start' : 'end'}">${fmt(v, 1)}</text>`;
            });
        }
        for (let k = 0; k <= 4; k++) {
            const t = start + (k / 4) * (end - start);
            svg += `<text x="${x(t)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}">${dateFmt(t, multiDay)}</text>`;
        }
        data.forEach((points, i) => {
            if (!points.length) {
                return;
            }
            // the last value lasts until now
            const all = [...points, { t: end, v: points[points.length - 1].v }];
            const d = all.map((p, k) => `${k ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v, i).toFixed(1)}`).join('');
            svg += `<path d="${d}" fill="none" stroke="${COLORS[i]}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
        });
        svg += `<line class="mi-cursor" y1="${pad.t}" y2="${H - pad.b}" stroke="#a9bdce" stroke-dasharray="3 3" visibility="hidden"/></svg><div class="mi-tip"></div>`;
        chart.innerHTML = svg;
        legend.innerHTML = ids
            .map((id, i) => {
                const e = entity(id)!;
                return `<span><i style="background:${COLORS[i]}"></i>${esc(name(e))} (${esc(unitOf(e))})</span>`;
            })
            .join('');
        const cursor = chart.querySelector('.mi-cursor') as SVGLineElement;
        const tip = chart.querySelector('.mi-tip') as HTMLElement;
        chart.onpointermove = ev => {
            const box = chart.getBoundingClientRect();
            const px = ((ev.clientX - box.left) / box.width) * W;
            const t = start + ((px - pad.l) / (W - pad.l - pad.r)) * (end - start);
            if (t < start || t > end) {
                cursor.setAttribute('visibility', 'hidden');
                tip.style.display = 'none';
                return;
            }
            const values = data.map((points, i) => {
                const p = [...points].reverse().find(q => q.t <= t);
                return p ? `${fmt(p.v)} ${esc(unitOf(entity(ids[i])!))}` : '–';
            });
            cursor.setAttribute('x1', String(px));
            cursor.setAttribute('x2', String(px));
            cursor.setAttribute('visibility', 'visible');
            tip.style.display = 'block';
            tip.style.left = `${ev.clientX - box.left}px`;
            tip.style.top = `${ev.clientY - box.top}px`;
            tip.innerHTML = `${dateFmt(t, true)} · ${values.join(' · ')}`;
        };
        chart.onpointerleave = () => {
            cursor.setAttribute('visibility', 'hidden');
            tip.style.display = 'none';
        };
    }

    /** On/off bands of a contact, motion, water or smoke sensor, a light or a switch. */
    function timeline(chart: HTMLElement, e: Entity, rows: Row[], start: number, end: number): void {
        const W = Math.max(320, chart.clientWidth || 640);
        const H = chart.clientHeight || 220;
        const pad = { l: 12, r: 12, t: 40, b: 24 };
        const x = (t: number): number => pad.l + ((t - start) / (end - start)) * (W - pad.l - pad.r);
        const alarm = ['moisture', 'smoke', 'heat', 'gas', 'carbon_monoxide'].includes(text(e.attributes.device_class));
        let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="#223140"/>`;
        rows.forEach((r, i) => {
            if (r.s !== 'on') {
                return;
            }
            const from = r.lu * 1000;
            const to = i + 1 < rows.length ? rows[i + 1].lu * 1000 : end;
            svg += `<rect x="${x(from)}" y="${pad.t}" width="${Math.max(1.5, x(to) - x(from))}" height="${H - pad.t - pad.b}" fill="${alarm ? '#e5534b' : '#f5a623'}"/>`;
        });
        const multiDay = end - start > 30 * 3600e3;
        for (let k = 0; k <= 4; k++) {
            const t = start + (k / 4) * (end - start);
            svg += `<text x="${x(t)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}">${dateFmt(t, multiDay)}</text>`;
        }
        const count = rows.filter((r, i) => r.s === 'on' && (i === 0 || rows[i - 1].s !== 'on')).length;
        svg += `<text x="${pad.l}" y="24" style="font-size:12px">${esc(binaryText(e, 'on'))}: ${count}× im Zeitraum</text></svg>`;
        chart.innerHTML = svg;
        chart.onpointermove = null;
        chart.onpointerleave = null;
    }

    window.addEventListener('hass-more-info', ev => {
        const id = (ev as CustomEvent<{ entityId?: string }>).detail?.entityId;
        const e = id ? entity(id) : undefined;
        if (!e) {
            return;
        }
        dialog ??= make();
        current = e.entity_id;
        showNow();
        actions(e);
        ranges();
        if (!dialog.open) {
            dialog.showModal();
        }
        void history();
        clearInterval(ticker);
        ticker = setInterval(showNow, 1000);
    });
}
