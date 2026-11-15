// ioBroker picker adapter. Reuses the shell's object tree; keeps existing plan IDs stable.
import { css, html, LitElement, type TemplateResult } from 'lit';
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
    render(): TemplateResult {
        const current = [...this.fixed, ...this.options].find(o => o.id === this.value);
        return html`<button
            type="button"
            ?disabled=${this.disabled}
            @click=${this.pick}
            aria-label=${this.placeholder || 'Datenpunkt auswählen'}
        >
            <span>${current?.label || this.placeholder || 'Datenpunkt auswählen'}</span><b aria-hidden="true">▤</b>
        </button>`;
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
        `,
    ];
}
if (!customElements.get('fp3d-entity-picker')) {
    customElements.define('fp3d-entity-picker', EntityPicker);
}
