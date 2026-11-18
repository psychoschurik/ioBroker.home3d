// Dialogs with React and @iobroker/gui-components, loaded on demand by bridge.ts and device-dialog.ts:
//   const { openProjects } = await import('./react/index.js');
import { DialogSelectID } from '@iobroker/gui-components';
import type { Connection } from '@iobroker/socket-client';
import { iobTheme, show } from './host.js';
import { ProjectsDialog, type ProjectContext } from './ProjectsDialog.js';
import { t } from '../lang.js';

export type { ProjectContext };

/** The dialog "Projekte": export and import of floor plans with pictures and devices. */
export async function openProjects(ctx: ProjectContext): Promise<void> {
    await show(ctx.language, close => (
        <ProjectsDialog
            ctx={ctx}
            onClose={close}
        />
    ));
}

/**
 * The object browser of ioBroker (DialogSelectID): resolves with the chosen state IDs, or null when cancelled.
 * Objects are loaded when it opens; values only for the rows shown.
 */
export function selectObjects(options: {
    socket: Connection;
    language: string;
    selected?: string[];
    multiSelect?: boolean;
    title?: string;
}): Promise<string[] | null> {
    return new Promise(resolve => {
        let result: string[] | null = null;
        void show(options.language, close => (
            <DialogSelectID
                socket={options.socket}
                theme={iobTheme()}
                themeType="dark"
                lang={options.language as ioBroker.Languages}
                dialogName="home3d-objects"
                title={options.title ?? t('choose_datapoints')}
                imagePrefix="../"
                types={['state']}
                multiSelect={options.multiSelect ?? true}
                selected={options.selected ?? []}
                onOk={selected => {
                    result = (Array.isArray(selected) ? selected : selected ? [selected] : []).filter(Boolean);
                }}
                onClose={() => {
                    close();
                    resolve(result);
                }}
            />
        ));
    });
}
