/**
 * One bar instead of two: the page's own bar (`#shell`: logo, status, projects, devices, kiosk, help) moves into the
 * header of the 3D view, its slots "start" (the logo, where the title "3D Home" was) and "end" (before the version and
 * ⚙), patched in `oneBar` of tasks.ts. The caption goes. Not in the kiosk (it shows no bars) or the card view.
 * "Projekte" and "Geräte verbinden" go to the slot "edit", shown only in the editor; the status too while all is
 * fine, else to the slot "status", shown in the 3D view as well.
 */
export function joinBars(panel: HTMLElement): void {
    const shell = document.getElementById('shell');
    if (!shell || document.documentElement.classList.contains('kiosk')) {
        return;
    }
    const move = (slot: string, selectors: string[]): void => {
        for (const selector of selectors) {
            for (const el of shell.querySelectorAll<HTMLElement>(selector)) {
                el.slot = slot;
                panel.append(el);
            }
        }
    };
    move('start', ['.brand', '.shell-divider']);
    move('status', ['#status']);
    move('edit', ['#project-open', '#mapping-open']);
    move('end', ['.header-link']);
    document.documentElement.classList.add('one-bar');
    const status = document.getElementById('status');
    if (status) {
        placeStatus(status, status.classList.contains('ok'));
    }
}

/** The status line; `ok`: connected without error, then it shows only in the editor (in one bar). */
export function placeStatus(status: HTMLElement, ok: boolean): void {
    status.classList.toggle('ok', ok);
    if (document.documentElement.classList.contains('one-bar')) {
        status.slot = ok ? 'edit' : 'status';
    }
}
