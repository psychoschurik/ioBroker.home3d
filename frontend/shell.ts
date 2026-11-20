/**
 * One bar instead of two: the page's own bar (`#shell`: logo, status, projects, devices, kiosk, help) moves into the
 * header of the 3D view, its slots "start" (the logo, where the title "3D Home" was) and "end" (before the version and
 * ⚙), patched in `oneBar` of tasks.ts. The caption goes. Not in the kiosk (it shows no bars) or the card view.
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
    move('end', ['#status', '#project-open', '#mapping-open', '.header-link']);
    document.documentElement.classList.add('one-bar');
}
