// The projects of home3d.0 in the dialog "Projekte": open one (its link), create, rename, duplicate, export, import
// and delete. The work is done by `Projects` (projects.ts); opening is a new page load.
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Divider,
    IconButton,
    Link,
    List,
    ListItem,
    ListItemText,
    Menu,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import {
    DEFAULT_PROJECT,
    projectLabel,
    projectLink,
    readBackup,
    type ProjectBackup,
    type ProjectInfo,
} from '../projects.js';
import { t } from '../lang.js';
import {
    download,
    NoticeBox,
    PickExport,
    readStored,
    saveExport,
    type Notice,
    type ProjectContext,
} from './project-files.js';

/** A name that no project in the list has yet: `name`, `name (2)` … */
function freeName(name: string, list: ProjectInfo[]): string {
    const taken = new Set(list.map(projectLabel));
    let free = name;
    for (let i = 2; taken.has(free); i++) {
        free = `${name} (${i})`;
    }
    return free;
}

/** What a project file holds, for the preview. */
function backupSummary(b: ProjectBackup): string {
    return t('project_file_summary', {
        plans: 1 + (Array.isArray(b.plans) ? b.plans.length : 0),
        images: b.images && typeof b.images === 'object' ? Object.keys(b.images).length : 0,
        devices: Array.isArray(b.mappings) ? b.mappings.length : 0,
    });
}

type Ask = { kind: 'rename' | 'copy'; project: ProjectInfo; value: string } | null;

export function ProjectList({ ctx }: { ctx: ProjectContext }): JSX.Element {
    const [list, setList] = useState<ProjectInfo[]>([]);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);
    const [menu, setMenu] = useState<{ anchor: HTMLElement; project: ProjectInfo } | null>(null);
    const [ask, setAsk] = useState<Ask>(null);
    const [deleting, setDeleting] = useState<ProjectInfo | null>(null);
    const [newName, setNewName] = useState('');
    const [file, setFile] = useState<{ text: string; data: ProjectBackup; source: string } | null>(null);
    const [importName, setImportName] = useState('');
    const [picking, setPicking] = useState(false);
    const input = useRef<HTMLInputElement>(null);

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
    const refresh = useCallback(async (): Promise<ProjectInfo[]> => {
        const next = await ctx.projects.list();
        setList(next);
        return next;
    }, [ctx]);
    useEffect(() => {
        void (async () => {
            setBusy(true);
            try {
                await refresh();
            } catch (e) {
                setNotice({ severity: 'error', text: (e as Error).message || String(e) });
            } finally {
                setBusy(false);
            }
        })();
    }, [ctx, refresh]);

    const url = (id: string): string => new URL(projectLink(id), location.href).href;
    const current = (p: ProjectInfo): boolean => p.id === ctx.project;

    const create = (): Promise<void> =>
        run(async () => {
            const id = await ctx.projects.create(newName);
            ctx.open(id);
        });
    const answer = (): Promise<void> =>
        run(async () => {
            if (!ask) {
                return;
            }
            const { kind, project, value } = ask;
            if (kind === 'rename') {
                if (current(project)) {
                    // through the page's own store: the title and the button follow at once
                    await ctx.callWS({ type: 'home3d/iobroker/project/name', name: value });
                } else {
                    await ctx.projects.rename(project.id, value);
                }
            } else {
                const id = await ctx.projects.copy(project.id, value);
                setNotice({ severity: 'success', text: t('project_copied', { name: value.trim() }), open: id });
            }
            setAsk(null);
            await refresh();
        });
    const remove = (): Promise<void> =>
        run(async () => {
            const p = deleting!;
            setDeleting(null);
            await ctx.projects.remove(p.id);
            await ctx.forget(p.id).catch(() => {});
            await refresh();
            setNotice({ severity: 'success', text: t('project_deleted', { name: projectLabel(p) }) });
        });
    const exportProject = (p: ProjectInfo, to: 'download' | 'store'): Promise<void> =>
        run(async () => {
            const { name, text } = await ctx.projects.exportFile(p.id);
            if (to === 'download') {
                download(name, text);
                setNotice({ severity: 'success', text: t('downloaded', { name: projectLabel(p) }) });
            } else {
                setNotice({ severity: 'success', text: t('saved_in', { path: await saveExport(ctx, name, text) }) });
            }
        });
    const loaded = (text: string, source: string): void => {
        const data = readBackup(text);
        setFile({ text, data, source });
        const proposed =
            (typeof data.name === 'string' && data.name.trim()) ||
            source
                .split('/')
                .pop()!
                .replace(/\.json$/i, '');
        setImportName(freeName(proposed, list));
    };
    const importProject = (): Promise<void> =>
        run(async () => {
            const res = await ctx.projects.importFile(file!.text, importName);
            setFile(null);
            await refresh();
            setNotice({
                severity: res.skipped.length ? 'info' : 'success',
                text: t('project_imported', { name: importName.trim() }),
                details: res.skipped.map(s => t('skipped', { id: s.id, reason: s.reason })),
                open: res.id,
            });
        });

    const chosen = menu?.project;
    const close = (): void => setMenu(null);
    return (
        <>
            <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1 }}
            >
                {t('projects_intro')}
            </Typography>
            <List dense>
                {list.map(p => (
                    <ListItem
                        key={p.id}
                        divider
                        secondaryAction={
                            <IconButton
                                edge="end"
                                aria-label={t('project_actions', { name: projectLabel(p) })}
                                disabled={busy}
                                onClick={e => setMenu({ anchor: e.currentTarget, project: p })}
                            >
                                <MoreVertIcon />
                            </IconButton>
                        }
                    >
                        <ListItemText
                            primary={
                                <Stack
                                    direction="row"
                                    spacing={1}
                                    sx={{ alignItems: 'center' }}
                                >
                                    <span>{projectLabel(p)}</span>
                                    {current(p) ? (
                                        <Chip
                                            size="small"
                                            color="primary"
                                            label={t('project_open_now')}
                                        />
                                    ) : null}
                                </Stack>
                            }
                            secondary={
                                <>
                                    {p.broken
                                        ? t('project_broken')
                                        : t('project_list_summary', { plans: p.plans, devices: p.devices })}
                                    {' · '}
                                    <Link
                                        href={projectLink(p.id)}
                                        underline="hover"
                                        sx={{ wordBreak: 'break-all' }}
                                    >
                                        {url(p.id)}
                                    </Link>
                                </>
                            }
                        />
                    </ListItem>
                ))}
            </List>
            <Menu
                anchorEl={menu?.anchor}
                open={!!menu}
                onClose={close}
            >
                <MenuItem
                    disabled={!chosen || current(chosen)}
                    onClick={() => {
                        close();
                        ctx.open(chosen!.id);
                    }}
                >
                    {t('project_open')}
                </MenuItem>
                <MenuItem
                    disabled={chosen?.broken}
                    onClick={() => {
                        close();
                        setAsk({ kind: 'rename', project: chosen!, value: chosen!.name ?? '' });
                    }}
                >
                    {t('project_rename')}
                </MenuItem>
                <MenuItem
                    disabled={chosen?.broken}
                    onClick={() => {
                        close();
                        setAsk({
                            kind: 'copy',
                            project: chosen!,
                            value: freeName(t('project_copy_name', { name: projectLabel(chosen!) }), list),
                        });
                    }}
                >
                    {t('project_copy')}
                </MenuItem>
                <MenuItem
                    disabled={chosen?.broken}
                    onClick={() => {
                        close();
                        void exportProject(chosen!, 'download');
                    }}
                >
                    {t('project_download')}
                </MenuItem>
                <MenuItem
                    disabled={chosen?.broken}
                    onClick={() => {
                        close();
                        void exportProject(chosen!, 'store');
                    }}
                >
                    {t('project_store')}
                </MenuItem>
                {chosen?.id !== DEFAULT_PROJECT ? <Divider /> : null}
                {chosen?.id !== DEFAULT_PROJECT ? (
                    <MenuItem
                        disabled={!chosen || current(chosen)}
                        onClick={() => {
                            close();
                            setDeleting(chosen!);
                        }}
                    >
                        <ListItemText
                            primary={t('project_delete')}
                            secondary={chosen && current(chosen) ? t('project_delete_open') : undefined}
                            slotProps={{ secondary: { sx: { whiteSpace: 'normal', maxWidth: 260 } } }}
                        />
                    </MenuItem>
                ) : null}
            </Menu>

            <Typography
                variant="subtitle1"
                sx={{ mt: 2 }}
            >
                {t('new_project')}
            </Typography>
            <Stack
                direction="row"
                spacing={1}
                sx={{ mt: 1, mb: 3 }}
            >
                <TextField
                    label={t('project_name')}
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && newName.trim() && !busy) {
                            void create();
                        }
                    }}
                    size="small"
                    sx={{ flex: 1 }}
                />
                <Button
                    variant="contained"
                    disabled={busy || !newName.trim()}
                    onClick={() => void create()}
                >
                    {t('project_create')}
                </Button>
            </Stack>
            <Divider />
            <Typography
                variant="subtitle1"
                sx={{ mt: 2 }}
            >
                {t('project_import')}
            </Typography>
            <Typography
                variant="body2"
                color="text.secondary"
            >
                {t('project_import_hint')}
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
                        const chosenFile = e.target.files?.[0];
                        e.target.value = '';
                        if (chosenFile) {
                            void run(async () => loaded(await chosenFile.text(), chosenFile.name));
                        }
                    }}
                />
            </Stack>
            {file ? (
                <Box sx={{ mt: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="body2">{file.source}</Typography>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 2 }}
                    >
                        {backupSummary(file.data)}
                    </Typography>
                    <Stack
                        direction="row"
                        spacing={1}
                    >
                        <TextField
                            label={t('project_name')}
                            value={importName}
                            onChange={e => setImportName(e.target.value)}
                            size="small"
                            sx={{ flex: 1 }}
                        />
                        <Button
                            variant="contained"
                            disabled={busy || !importName.trim()}
                            onClick={() => void importProject()}
                        >
                            {t('project_import_go')}
                        </Button>
                    </Stack>
                </Box>
            ) : null}
            <NoticeBox
                notice={notice}
                onOpen={ctx.open}
            />

            {ask ? (
                <Dialog
                    open
                    onClose={() => setAsk(null)}
                    maxWidth="xs"
                    fullWidth
                >
                    <DialogTitle>
                        {t(ask.kind === 'rename' ? 'project_rename_title' : 'project_copy_title', {
                            name: projectLabel(ask.project),
                        })}
                    </DialogTitle>
                    <DialogContent>
                        <TextField
                            autoFocus
                            fullWidth
                            label={t('project_name')}
                            value={ask.value}
                            onChange={e => setAsk({ ...ask, value: e.target.value })}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && ask.value.trim() && !busy) {
                                    void answer();
                                }
                            }}
                            size="small"
                            sx={{ mt: 1 }}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setAsk(null)}>{t('cancel')}</Button>
                        <Button
                            variant="contained"
                            // the default project may go without a name of its own
                            disabled={
                                busy ||
                                (!ask.value.trim() && !(ask.kind === 'rename' && ask.project.id === DEFAULT_PROJECT))
                            }
                            onClick={() => void answer()}
                        >
                            {t('apply')}
                        </Button>
                    </DialogActions>
                </Dialog>
            ) : null}
            {deleting ? (
                <Dialog
                    open
                    onClose={() => setDeleting(null)}
                    maxWidth="xs"
                >
                    <DialogTitle>{t('project_delete_title', { name: projectLabel(deleting) })}</DialogTitle>
                    <DialogContent>
                        <DialogContentText>{t('project_delete_hint')}</DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            autoFocus
                            onClick={() => setDeleting(null)}
                        >
                            {t('cancel')}
                        </Button>
                        <Button
                            color="error"
                            variant="contained"
                            onClick={() => void remove()}
                        >
                            {t('project_delete_go')}
                        </Button>
                    </DialogActions>
                </Dialog>
            ) : null}
            {picking ? (
                <PickExport
                    ctx={ctx}
                    title={t('backup_file')}
                    onClose={() => setPicking(false)}
                    onPick={path => void run(async () => loaded(await readStored(ctx, path), path))}
                />
            ) : null}
        </>
    );
}
