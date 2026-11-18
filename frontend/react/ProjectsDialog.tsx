// "Projekte": export a floor plan with its pictures and devices as a file, import one as a new floor plan.
// Files go to the computer or into the file storage of ioBroker (home3d.0/projects/), chosen with DialogSelectFile.
import { DialogSelectFile } from '@iobroker/gui-components';
import type { Connection } from '@iobroker/socket-client';
import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import { useEffect, useRef, useState, type JSX } from 'react';
import { fileText } from '../file-text.js';
import { projectFileName, readProject, type Project, type ProjectFile } from '../project.js';
import type { PlanList } from '../store.js';
import type { CallWS } from '../types.js';
import { iobTheme } from './host.js';
import { t } from '../lang.js';

export interface ProjectContext {
    callWS: CallWS;
    socket: Connection;
    language: string;
    /** The instance whose file storage holds the projects (home3d.0). */
    namespace: string;
}

/** Folder of the projects in the file storage of the instance. */
export const PROJECT_FOLDER = 'projects';

interface ImportResult {
    plan: string;
    name: string;
    images: number;
    devices: number;
    renamed: { from: string; to: string }[];
    skipped: { id: string; reason: string }[];
}
type Notice = { severity: 'success' | 'error' | 'info'; text: string; details?: string[] } | null;

function download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const summary = (p: Project): string => {
    const rooms = p.building.floors.reduce((n, f) => n + f.rooms.length, 0);
    return t('project_summary', {
        floors: p.building.floors.length,
        rooms,
        images: Object.keys(p.images).length,
        devices: p.mappings.length,
    });
};

export function ProjectsDialog({ ctx, onClose }: { ctx: ProjectContext; onClose: () => void }): JSX.Element {
    const [plans, setPlans] = useState<PlanList['plans']>([]);
    const [plan, setPlan] = useState('main');
    // null: the name follows the chosen floor plan
    const [fileName, setFileName] = useState<string | null>(null);
    // the file as read (the store checks it again on import) and what it contains, for the preview
    const [project, setProject] = useState<{ text: string; data: Project; source: string } | null>(null);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [picking, setPicking] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        ctx.callWS({ type: 'home3d/plans/list' })
            .then((list: PlanList) => setPlans(list.plans))
            .catch((e: Error) => setNotice({ severity: 'error', text: e.message }));
    }, [ctx]);
    const label = (id: string): string => {
        const p = plans.find(x => x.id === id);
        return p?.name || t(id === 'main' ? 'main_plan' : 'plan');
    };
    const shownName = fileName ?? projectFileName(plans.length ? label(plan) : null);

    const run = async (job: () => Promise<void>): Promise<void> => {
        setBusy(true);
        setNotice(null);
        try {
            await job();
        } catch (e) {
            setNotice({ severity: 'error', text: (e as Error).message || String(e) });
        } finally {
            setBusy(false);
        }
    };
    const exported = async (): Promise<string> => {
        const file: ProjectFile = await ctx.callWS({ type: 'home3d/project/export', plan });
        return JSON.stringify(file, null, 1);
    };
    const target = (): string => (shownName.trim() || projectFileName(label(plan))).replace(/[\\/]/g, '-');

    const exportDownload = (): Promise<void> =>
        run(async () => {
            download(target().endsWith('.json') ? target() : `${target()}.json`, await exported());
            setNotice({ severity: 'success', text: t('downloaded', { name: label(plan) }) });
        });
    const exportStore = (): Promise<void> =>
        run(async () => {
            const name = target().endsWith('.json') ? target() : `${target()}.json`;
            const bytes = new TextEncoder().encode(await exported());
            await ctx.socket.writeFile64(ctx.namespace, `${PROJECT_FOLDER}/${name}`, bytes.buffer);
            setNotice({
                severity: 'success',
                text: t('saved_in', { path: `${ctx.namespace}/${PROJECT_FOLDER}/${name}` }),
            });
        });

    const loaded = (text: string, source: string): void => {
        const data = readProject(text);
        setProject({ text, data, source });
        const base =
            data.name ||
            source
                .split('/')
                .pop()!
                .replace(/\.json$/i, '');
        // a name that is not taken yet, so both plans can be told apart in the menu
        const taken = new Set(plans.map(p => p.name).filter(Boolean));
        let free = base;
        for (let i = 2; taken.has(free); i++) {
            free = `${base} (${i})`;
        }
        setName(free);
        setNotice(null);
    };
    const fromStorage = (path: string): Promise<void> =>
        run(async () => {
            const [adapter, ...rest] = path.split('/');
            const r = await ctx.socket.readFile(adapter, rest.join('/'), true);
            if (!r?.file) {
                throw new Error(t('file_empty', { path }));
            }
            loaded(fileText(r.file, r.mimeType), path);
        });
    const fromComputer = (file: File): Promise<void> => run(async () => loaded(await file.text(), file.name));
    const importProject = (): Promise<void> =>
        run(async () => {
            const res: ImportResult = await ctx.callWS({
                type: 'home3d/project/import',
                project: project!.text,
                name: name.trim() || undefined,
            });
            setProject(null);
            setNotice({
                severity: res.skipped.length ? 'info' : 'success',
                text: t('imported', { name: res.name, images: res.images, devices: res.devices }),
                details: [
                    ...res.renamed.map(r => t('renamed', { from: r.from, to: r.to })),
                    ...res.skipped.map(s => t('skipped', { id: s.id, reason: s.reason })),
                ],
            });
        });

    return (
        <>
            <Dialog
                open
                onClose={onClose}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>{t('projects_dialog')}</DialogTitle>
                <DialogContent>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 2 }}
                    >
                        {t('projects_intro')}
                    </Typography>
                    <Typography variant="subtitle1">{t('export')}</Typography>
                    <Stack
                        spacing={2}
                        sx={{ mt: 1, mb: 3 }}
                    >
                        <TextField
                            select
                            label={t('plan')}
                            // until the list is loaded, MUI knows no option for it
                            value={plans.some(p => p.id === plan) ? plan : ''}
                            onChange={e => {
                                setPlan(e.target.value);
                                setFileName(null);
                            }}
                            size="small"
                        >
                            {plans.map(p => (
                                <MenuItem
                                    key={p.id}
                                    value={p.id}
                                >
                                    {`${p.icon ? `${p.icon} ` : ''}${label(p.id)} · ${t('plan_summary', { floors: p.floors, rooms: p.rooms })}`}
                                </MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            label={t('file_name')}
                            value={shownName}
                            onChange={e => setFileName(e.target.value)}
                            size="small"
                        />
                        <Stack
                            direction="row"
                            spacing={1}
                        >
                            <Button
                                variant="contained"
                                disabled={busy || !plans.length}
                                onClick={() => void exportDownload()}
                            >
                                {t('download')}
                            </Button>
                            <Button
                                variant="outlined"
                                disabled={busy || !plans.length}
                                onClick={() => void exportStore()}
                            >
                                {t('save_iobroker')}
                            </Button>
                        </Stack>
                    </Stack>
                    <Divider />
                    <Typography
                        variant="subtitle1"
                        sx={{ mt: 2 }}
                    >
                        {t('import')}
                    </Typography>
                    <Stack
                        direction="row"
                        spacing={1}
                        sx={{ mt: 1 }}
                    >
                        <Button
                            variant="outlined"
                            disabled={busy}
                            onClick={() => setPicking(true)}
                        >
                            {t('from_iobroker')}
                        </Button>
                        <Button
                            variant="outlined"
                            disabled={busy}
                            onClick={() => input.current?.click()}
                        >
                            {t('from_computer')}
                        </Button>
                        <input
                            ref={input}
                            type="file"
                            accept="application/json,.json"
                            hidden
                            onChange={e => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (file) {
                                    void fromComputer(file);
                                }
                            }}
                        />
                    </Stack>
                    {project ? (
                        <Box sx={{ mt: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Typography variant="body2">{project.source}</Typography>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mb: 2 }}
                            >
                                {summary(project.data)}
                            </Typography>
                            <Stack
                                direction="row"
                                spacing={1}
                            >
                                <TextField
                                    label={t('new_plan_name')}
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    size="small"
                                    sx={{ flex: 1 }}
                                />
                                <Button
                                    variant="contained"
                                    disabled={busy}
                                    onClick={() => void importProject()}
                                >
                                    {t('import')}
                                </Button>
                            </Stack>
                        </Box>
                    ) : null}
                    {notice ? (
                        <Alert
                            severity={notice.severity}
                            sx={{ mt: 2 }}
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
                    ) : null}
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>{t('close')}</Button>
                </DialogActions>
            </Dialog>
            {picking ? (
                <DialogSelectFile
                    socket={ctx.socket}
                    theme={iobTheme()}
                    themeType="dark"
                    lang={ctx.language as ioBroker.Languages}
                    title={t('project_file')}
                    dialogName="home3d-projects"
                    imagePrefix="../"
                    filterFiles={['json']}
                    restrictToFolder={`${ctx.namespace}/${PROJECT_FOLDER}`}
                    allowNonRestricted
                    allowUpload
                    allowDownload
                    allowCreateFolder={false}
                    allowDelete
                    onClose={() => setPicking(false)}
                    onOk={selected => {
                        setPicking(false);
                        const path = Array.isArray(selected) ? selected[0] : selected;
                        if (path) {
                            void fromStorage(path);
                        }
                    }}
                />
            ) : null}
        </>
    );
}
