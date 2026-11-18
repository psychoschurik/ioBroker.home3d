// ioBroker picker adapter. Reuses the shell's object tree; keeps existing plan IDs stable.
import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { tokens } from './picker-styles.js';
export interface PickerOption {
    id: string;
    label: string;
}
export class EntityPicker extends LitElement {
    static properties = {
        options: { attribute: false },
        fixed: { attribute: false },
        value: { attribute: false },
        disabled: { type: Boolean },
        placeholder: { attribute: false },
    };
    declare options: PickerOption[];
    declare fixed: PickerOption[];
    declare value: string | null;
    declare disabled: boolean;
    declare placeholder: string;
    constructor() {
        super();
        this.options = [];
        this.fixed = [];
        this.value = null;
        this.disabled = false;
        this.placeholder = 'Datenpunkt auswählen';
    }
    private pick(): void {
        if (this.disabled) {
            return;
        }
        this.dispatchEvent(
            new CustomEvent('iobroker-pick', {
                bubbles: true,
                composed: true,
                detail: {
                    options: this.options,
                    fixed: this.fixed,
                    value: this.value,
                    choose: (value: string) => {
                        this.value = value;
                        this.dispatchEvent(
                            new CustomEvent('change', {
                                detail: { value },
                                bubbles: true,
                                composed: true,
                            }),
                        );
                    },
                },
            }),
        );
    }
    /** The ioBroker ID of the chosen entity, from the hass of the editor around it; else the entity ID. */
    private sourceId(value: string): string {
        let node: Node = this;
        for (let i = 0; i < 8; i++) {
            const host = (node.getRootNode() as ShadowRoot).host as
                | (Element & { hass?: { states?: Record<string, { attributes?: Record<string, unknown> }> } })
                | undefined;
            if (!host) {
                break;
            }
            const id = host.hass?.states?.[value]?.attributes?.iobroker_id;
            if (typeof id === 'string' && id) {
                return id;
            }
            if (host.hass) {
                break;
            }
            node = host;
        }
        return value;
    }
    render(): TemplateResult {
        const current = [...this.fixed, ...this.options].find(o => o.id === this.value);
        // the chosen datapoint's ID below the field (not for "none" and the other fixed choices)
        const id = this.value && !this.fixed.some(o => o.id === this.value) ? this.sourceId(this.value) : '';
        return html`<button
                type="button"
                ?disabled=${this.disabled}
                @click=${this.pick}
                aria-label=${this.placeholder || 'Datenpunkt auswählen'}
            >
                <span>${current?.label || this.placeholder || 'Datenpunkt auswählen'}</span
                ><b aria-hidden="true">▤</b></button
            >${id ? html`<small title=${id}>${id}</small>` : nothing}`;
    }
    static styles = [
        tokens,
        css`
            :host {
                display: block;
            }
            button {
                display: flex;
                align-items: center;
                gap: 12px;
                width: 100%;
                padding: 9px 11px;
                background: var(--fp3d-chrome-solid);
                color: var(--fp3d-text);
                border: 1px solid var(--fp3d-line);
                border-radius: 4px;
                font: inherit;
                text-align: left;
                cursor: pointer;
            }
            span {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            b {
                color: var(--fp3d-accent);
                font-size: 20px;
            }
            button:focus-visible {
                outline: 2px solid var(--fp3d-accent);
            }
            button:disabled {
                opacity: 0.45;
                cursor: default;
            }
            small {
                display: block;
                margin-top: 4px;
                color: var(--fp3d-muted, #8a9bb8);
                font-size: 12px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                overflow-wrap: anywhere;
                user-select: text;
            }
        `,
    ];
}
if (!customElements.get('fp3d-entity-picker')) {
    customElements.define('fp3d-entity-picker', EntityPicker);
}
