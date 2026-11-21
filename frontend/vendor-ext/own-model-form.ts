// The editor's fields of an own 3D object (furniture type "model3d"): one of the models uploaded before, or a new file
// (GLB, glTF with its data inside, OBJ, STL). The file is read here first, so one the 3D view could not show is
// refused with the reason before it is stored; its natural size becomes the item's box.
import { html, nothing, type TemplateResult } from 'lit';
import { bytesBase64, MODEL_EXTS, MODEL_MANY_TRIS, MODEL_MAX_BYTES, modelExt, type ModelInfo } from './model-files';
import { cacheModel, ModelError, readModel } from './own-models';

/** What the form needs of the editor. */
export interface ModelFormHost {
    hass?: { callWS<T>(msg: Record<string, unknown>): Promise<T> } | null;
    admin: boolean;
    /** A text of the 3D view's i18n. */
    t(key: string): string;
    update(patch: Record<string, unknown>): void;
    redraw(): void;
}

let list: ModelInfo[] | null = null;
let listing = false;
let busy = false;
let note: { text: string; error: boolean } | null = null;
/** The item's model when the list was last loaded: which models are in use changes with it. */
let listedFor: string | null | undefined;
let later: ReturnType<typeof setTimeout> | undefined;

/** Loads the list again once the plan with the item's new model is saved. */
function refreshLater(host: ModelFormHost): void {
    clearTimeout(later);
    later = setTimeout(() => void refresh(host), 2000);
}

async function refresh(host: ModelFormHost): Promise<void> {
    if (!host.hass || listing) {
        return;
    }
    listing = true;
    try {
        list = (await host.hass.callWS<{ models: ModelInfo[] }>({ type: 'home3d/model/list' })).models;
    } catch (e) {
        list ??= [];
        note = { text: (e as Error).message, error: true };
    } finally {
        listing = false;
        host.redraw();
    }
}

function errorText(e: unknown, host: ModelFormHost): string {
    if (e instanceof ModelError) {
        const text = host.t(`model3d_err_${e.code}`);
        return e.code === 'format' && e.message !== e.code ? `${text} (${e.message})` : text;
    }
    return (e as Error)?.message || String(e);
}

const metres = (n: number): string =>
    (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const round = (n: number): number => Math.max(0.01, Math.round(n * 100) / 100);
/** "840 KB", "3,4 MB". */
export const fileSize = (bytes: number): string =>
    bytes < 1024 * 1024
        ? `${Math.max(1, Math.round(bytes / 1024))} KB`
        : `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;

async function upload(e: Event, host: ModelFormHost): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !host.hass) {
        return;
    }
    busy = true;
    note = null;
    host.redraw();
    try {
        const ext = modelExt(file.name);
        if (!ext) {
            throw new ModelError('format');
        }
        if (file.size > MODEL_MAX_BYTES) {
            throw new ModelError('big');
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const template = await readModel(bytes, ext);
        const r = await host.hass.callWS<{ model_id: string }>({
            type: 'home3d/model/set',
            name:
                file.name
                    .replace(/\.[^.]+$/, '')
                    .trim()
                    .slice(0, 80) || file.name,
            ext,
            data: bytesBase64(bytes),
            size: template.size,
            tris: template.tris,
        });
        cacheModel(r.model_id, template);
        host.update({
            model: r.model_id,
            w: round(template.size[0]),
            d: round(template.size[1]),
            h: round(template.size[2]),
        });
        note = template.tris > MODEL_MANY_TRIS ? { text: host.t('model3d_many'), error: false } : null;
        await refresh(host);
    } catch (err) {
        note = { text: errorText(err, host), error: true };
    } finally {
        busy = false;
        host.redraw();
    }
}

async function prune(host: ModelFormHost): Promise<void> {
    if (!host.hass) {
        return;
    }
    try {
        await host.hass.callWS({ type: 'home3d/model/prune' });
        note = null;
    } catch (e) {
        note = { text: (e as Error).message, error: true };
    }
    await refresh(host);
}

/** The fields: the model, the upload, what the model is and its original size. */
export function modelForm(f: { model?: string | null }, host: ModelFormHost): TemplateResult {
    if (!list && !listing) {
        void refresh(host);
    } else if (listedFor !== undefined && listedFor !== (f.model ?? null)) {
        refreshLater(host);
    }
    listedFor = f.model ?? null;
    const models = list ?? [];
    const info = models.find(m => m.id === f.model);
    const unused = models.filter(m => !m.used && m.id !== f.model).length;
    return html`<div class="fp3d-form">
        <label class="fp3d-field fp3d-wide"
            >${host.t('model3d_file')}
            <select
                ?disabled=${!host.admin || busy}
                @change=${(e: Event) => {
                    const id = (e.target as HTMLSelectElement).value || null;
                    const m = models.find(x => x.id === id);
                    host.update(
                        m
                            ? { model: id, w: round(m.size[0]), d: round(m.size[1]), h: round(m.size[2]) }
                            : { model: id },
                    );
                }}
            >
                <option
                    value=""
                    ?selected=${!f.model}
                >
                    ${host.t('model3d_none')}
                </option>
                ${models.map(
                    m =>
                        html`<option
                            value=${m.id}
                            ?selected=${m.id === f.model}
                        >
                            ${m.name}
                        </option>`,
                )}
                ${
                    f.model && list && !info
                        ? html`<option
                              value=${f.model}
                              selected
                          >
                              ${host.t('model3d_missing')}
                          </option>`
                        : nothing
                }
            </select></label
        >
        ${
            host.admin
                ? html`<label class="fp3d-btn fp3d-upload fp3d-wide"
                      >${busy ? host.t('model3d_reading') : host.t('model3d_upload')}<input
                          type="file"
                          accept=${MODEL_EXTS.map(x => `.${x}`).join(',')}
                          hidden
                          ?disabled=${busy}
                          @change=${(e: Event) => void upload(e, host)}
                  /></label>`
                : nothing
        }
        ${
            info
                ? html`<p class="fp3d-sub fp3d-wide">
                      ${info.ext.toUpperCase()} · ${fileSize(info.bytes)} · ${info.tris.toLocaleString()}
                      ${host.t('model3d_tris')} · ${metres(info.size[0])} × ${metres(info.size[1])} ×
                      ${metres(info.size[2])} m
                  </p>`
                : nothing
        }
        ${note ? html`<p class="fp3d-sub fp3d-wide ${note.error ? 'fp3d-pack-error' : ''}">${note.text}</p>` : nothing}
        ${
            info && host.admin
                ? html`<button
                      class="fp3d-btn fp3d-field-btn"
                      @click=${() => host.update({ w: round(info.size[0]), d: round(info.size[1]), h: round(info.size[2]) })}
                  >
                      ${host.t('model3d_natural')}
                  </button>`
                : nothing
        }
        ${
            unused && host.admin
                ? html`<button
                      class="fp3d-btn fp3d-field-btn"
                      title=${host.t('model3d_prune_hint')}
                      @click=${() => void prune(host)}
                  >
                      ${host.t('model3d_prune')} (${unused})
                  </button>`
                : nothing
        }
        <p class="fp3d-sub fp3d-wide">${host.t('model3d_hint')}</p>
    </div>`;
}
