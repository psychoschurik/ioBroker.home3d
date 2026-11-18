interface Elements {
    'mapping-dialog': HTMLDialogElement;
    search: HTMLInputElement;
    'role-filter': HTMLSelectElement;
    'room-filter': HTMLSelectElement;
    'mapping-json': HTMLTextAreaElement;
    'mapping-save': HTMLButtonElement;
    app: HTMLElement;
    status: HTMLElement;
    candidates: HTMLElement;
    'mapping-result': HTMLElement;
    'configured-list': HTMLElement;
    'configured-count': HTMLElement;
    'mapping-title': HTMLElement;
    'mapping-advanced': HTMLElement;
    configured: HTMLElement;
    discover: HTMLElement;
    'fixed-options': HTMLElement;
    'mapping-description': HTMLElement;
    'mapping-open': HTMLElement;
    'mapping-close': HTMLElement;
    'project-open': HTMLButtonElement;
    'object-browser': HTMLButtonElement;
    'help-link': HTMLAnchorElement;
}
export function element<K extends keyof Elements>(id: K): Elements[K] {
    const node = document.getElementById(id);
    if (!node) {
        throw new Error(`Missing UI element: ${id}`);
    }
    return node as Elements[K];
}
