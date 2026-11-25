// What both tabs of the dialog "Projekte" share: the context, files to the computer or to home3d.0/exports/, the
// file picker of ioBroker and the notice below.
import { DialogSelectFile } from '@iobroker/gui-components';
import type { Connection } from '@iobroker/socket-client';
import { Alert, Button } from '@mui/material';
import type { JSX } from 'react';
import { fileText } from '../file-text.js';
import { EXPORTS_FOLDER, type Projects } from '../projects.js';
import type { CallWS } from '../types.js';
import { iobTheme } from './host.js';
import { t } from '../lang.js';

export interface ProjectContext {
    callWS: CallWS;
    socket: Connection;
    language: string;
    /** The instance whose file storage holds the projects (home3d.0). */
    namespace: string;
    /** The ID of the open project. */
    project: string;
    projects: Projects;
    /** Opens a project: a new page load. */
    open: (id: string) => void;
    /** A project was deleted: its names leave home3d.0.places. */
    forget: (id: string) => Promise<void>;
}

export type Notice = {
    severity: 'success' | 'error' | 'info';
    text: string;
    details?: string[];
    /** A project the notice offers to open. */
    open?: string;
} | null;

export function download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves a text file in `home3d.0/exports/`; returns its path. */
export async function saveExport(ctx: ProjectContext, name: string, text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    await ctx.socket.writeFile64(ctx.namespace, `${EXPORTS_FOLDER}/${name}`, bytes.buffer);
    return `${ctx.namespace}/${EXPORTS_FOLDER}/${name}`;
}

/** Reads a file chosen in DialogSelectFile (`home3d.0/exports/x.json`). */
export async function readStored(ctx: ProjectContext, path: string): Promise<string> {
    const [adapter, ...rest] = path.split('/');
    const r = await ctx.socket.readFile(adapter, rest.join('/'), true);
    if (!r?.file) {
        throw new Error(t('file_empty', { path }));
    }
    return fileText(r.file, r.mimeType);
}

/** A json file name from what was typed: no folders, `.json` at the end. */
export function jsonName(name: string): string {
    const clean = name.trim().replace(/[\\/]/g, '-');
    return clean.endsWith('.json') ? clean : `${clean}.json`;
}

export function NoticeBox({ notice, onOpen }: { notice: Notice; onOpen?: (id: string) => void }): JSX.Element | null {
    if (!notice) {
        return null;
    }
    const open = notice.open;
    return (
        <Alert
            severity={notice.severity}
            sx={{ mt: 2 }}
            action={
                open && onOpen ? (
                    <Button
                        color="inherit"
                        size="small"
                        onClick={() => onOpen(open)}
                    >
                        {t('project_open')}
                    </Button>
                ) : undefined
            }
        >
            {notice.text}
            {notice.details?.length ? (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {notice.details.map(d => (
                        <li key={d}>{d}</li>
                    ))}
                </ul>
            ) : null}
        </Alert>
    );
}

/** The file picker of ioBroker for the exports of home3d.0. */
export function PickExport({
    ctx,
    title,
    onClose,
    onPick,
}: {
    ctx: ProjectContext;
    title: string;
    onClose: () => void;
    onPick: (path: string) => void;
}): JSX.Element {
    return (
        <DialogSelectFile
            socket={ctx.socket}
            theme={iobTheme()}
            themeType="dark"
            lang={ctx.language as ioBroker.Languages}
            title={title}
            dialogName="home3d-projects"
            imagePrefix="../"
            filterFiles={['json']}
            restrictToFolder={`${ctx.namespace}/${EXPORTS_FOLDER}`}
            allowNonRestricted
            allowUpload
            allowDownload
            allowCreateFolder={false}
            allowDelete
            onClose={onClose}
            onOk={selected => {
                onClose();
                const path = Array.isArray(selected) ? selected[0] : selected;
                if (path) {
                    onPick(path);
                }
            }}
        />
    );
}
