// Keys this browser keeps per project in localStorage (tasks.ts patches building-controller.ts and panel.ts): the
// unsaved edits of a floor plan and the plan last shown belong to the open project, since plan IDs (`main`) repeat in
// every project. The default project keeps the keys the 3D view always had.

/** The open project, as the page set it (bridge.ts, from `?project=`); `default` when none. */
export function openProject(): string {
    return (typeof document !== 'undefined' && document.documentElement.dataset.project) || 'default';
}

/** What a link of the page adds for the open project (`&project=<id>`); nothing in the default project. */
export function projectParam(project = openProject()): string {
    return project === 'default' ? '' : `&project=${encodeURIComponent(project)}`;
}

/** `key` in the default project, `key@<project>` in another one. */
export function projectKey(key: string, project = openProject()): string {
    return project === 'default' ? key : `${key}@${project}`;
}
