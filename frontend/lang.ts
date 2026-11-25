// The texts of the page around the 3D view (header, "Geräte verbinden", the detail dialog, projects, status and error
// messages) in German, English and Russian. The 3D view has its own (vendor i18n.ts with lang/<code>.json). The
// language is the one of the ioBroker system: German, Russian, else English.

export type Lang = 'de' | 'en' | 'ru';

export const TEXTS = {
    // header and the dialog "Geräte verbinden" (index.html: data-i18n …)
    home_aria: { de: '3D Home Startseite', en: '3D Home start page', ru: 'Главная страница 3D Home' },
    caption: { de: 'Dein Zuhause im Überblick', en: 'Your home at a glance', ru: 'Ваш дом с первого взгляда' },
    connecting: { de: 'Verbinde …', en: 'Connecting …', ru: 'Подключение …' },
    projects: { de: '⇅ Projekte', en: '⇅ Projects', ru: '⇅ Проекты' },
    project_button: { de: '⇅ {name}', en: '⇅ {name}', ru: '⇅ {name}' },
    projects_title: {
        de: 'Projekte öffnen, anlegen, exportieren oder importieren; Grundrisse mit Bildern und Geräten übertragen',
        en: 'Open, create, export or import projects; move floor plans with their pictures and devices',
        ru: 'Открыть, создать, экспортировать или импортировать проекты; переносить планы с изображениями и устройствами',
    },
    project_title_named: {
        de: 'Projekt „{name}“ – Projekte öffnen, anlegen, exportieren oder importieren',
        en: 'Project "{name}" – open, create, export or import projects',
        ru: 'Проект «{name}» – открыть, создать, экспортировать или импортировать проекты',
    },
    connect_devices: { de: '▤ Geräte verbinden', en: '▤ Connect devices', ru: '▤ Подключить устройства' },
    kiosk: { de: 'Kiosk ↗', en: 'Kiosk ↗', ru: 'Киоск ↗' },
    kiosk_title: {
        de: 'Die 3D-Ansicht ohne die oberen Leisten, in einem neuen Tab – für Wandtablets',
        en: 'The 3D view without the bars at the top, in a new tab – for wall tablets',
        ru: '3D-вид без верхних панелей в новой вкладке – для настенных планшетов',
    },
    help: { de: 'Hilfe', en: 'Help', ru: 'Справка' },
    objects_eyebrow: { de: 'IOBROKER OBJEKTE', en: 'IOBROKER OBJECTS', ru: 'ОБЪЕКТЫ IOBROKER' },
    mapping_title: { de: 'Geräte verbinden', en: 'Connect devices', ru: 'Подключить устройства' },
    mapping_title_single: { de: 'Datenpunkt auswählen', en: 'Choose a datapoint', ru: 'Выбрать точку данных' },
    mapping_hint: {
        de: 'Datenpunkte im Objektbaum auswählen und übernehmen. Bestehende Zuordnungen bleiben erhalten.',
        en: 'Choose datapoints in the object tree and apply them. Existing mappings are kept.',
        ru: 'Выберите точки данных в дереве объектов и примените их. Существующие привязки сохраняются.',
    },
    mapping_hint_single: {
        de: 'Objektbaum öffnen oder nach Name und Objekt-ID suchen. Alle Datenpunkte stehen zur Wahl; ein noch nicht verbundener wird beim Auswählen verbunden.',
        en: 'Open the object tree or search by name and object ID. All datapoints can be chosen; one not connected yet is connected when chosen.',
        ru: 'Откройте дерево объектов или ищите по имени и ID объекта. Можно выбрать любую точку данных; ещё не подключённая подключается при выборе.',
    },
    connecting_datapoint: {
        de: 'Datenpunkt wird verbunden …',
        en: 'Connecting the datapoint …',
        ru: 'Точка данных подключается …',
    },
    search_placeholder: {
        de: 'Objekt-ID oder Name suchen',
        en: 'Search object ID or name',
        ru: 'Поиск по ID объекта или имени',
    },
    search_aria: { de: 'Objekte suchen', en: 'Search objects', ru: 'Поиск объектов' },
    role_filter: { de: 'Rolle filtern', en: 'Filter by role', ru: 'Фильтр по роли' },
    all_roles: { de: 'Alle Rollen', en: 'All roles', ru: 'Все роли' },
    room_filter: { de: 'Raum filtern', en: 'Filter by room', ru: 'Фильтр по комнате' },
    all_rooms: { de: 'Alle Räume', en: 'All rooms', ru: 'Все комнаты' },
    object_browser: { de: '⌕ Objekt-Browser …', en: '⌕ Object browser …', ru: '⌕ Браузер объектов …' },
    object_browser_title: {
        de: 'Datenpunkte im Objekt-Browser von ioBroker auswählen',
        en: 'Choose datapoints in the object browser of ioBroker',
        ru: 'Выбрать точки данных в браузере объектов ioBroker',
    },
    refresh: { de: '↻ Aktualisieren', en: '↻ Refresh', ru: '↻ Обновить' },
    configured: { de: 'Verbundene Geräte', en: 'Connected devices', ru: 'Подключённые устройства' },
    configured_hint: {
        de: 'Entfernte Zuordnungen lassen den Grundriss bestehen, das betreffende Gerät zeigt dort aber keine Werte mehr.',
        en: 'Removed mappings leave the floor plan as it is, but the device shows no values there any more.',
        ru: 'Удалённые привязки не меняют план, но устройство больше не показывает на нём значения.',
    },
    advanced: { de: 'Erweiterte Zuordnungen', en: 'Advanced mappings', ru: 'Расширенные привязки' },
    advanced_hint: {
        de: 'Optionale JSON-Konfiguration für zusammengesetzte Geräte. Für die normale Auswahl genügt der Objektbaum.',
        en: 'Optional JSON configuration for composite devices. For the normal choice the object tree is enough.',
        ru: 'Необязательная конфигурация JSON для составных устройств. Для обычного выбора достаточно дерева объектов.',
    },
    mappings_json: { de: 'Zuordnungen als JSON', en: 'Mappings as JSON', ru: 'Привязки в формате JSON' },
    cancel: { de: 'Abbrechen', en: 'Cancel', ru: 'Отмена' },
    apply: { de: 'Übernehmen', en: 'Apply', ru: 'Применить' },
    choose: { de: 'Auswählen', en: 'Choose', ru: 'Выбрать' },
    close: { de: 'Schließen', en: 'Close', ru: 'Закрыть' },
    remove: { de: 'Entfernen', en: 'Remove', ru: 'Удалить' },
    remove_aria: {
        de: '{name} aus Zuordnungen entfernen',
        en: 'Remove {name} from the mappings',
        ru: 'Удалить {name} из привязок',
    },
    change: { de: 'Ändern', en: 'Change', ru: 'Изменить' },
    change_aria: {
        de: 'Datenpunkt von {name} ändern',
        en: 'Change the datapoint of {name}',
        ru: 'Изменить точку данных {name}',
    },
    changed_apply: {
        de: '{name}: {id} – mit Übernehmen speichern.',
        en: '{name}: {id} – save with Apply.',
        ru: '{name}: {id} – сохраните кнопкой «Применить».',
    },
    choose_apply: { de: 'Mit Auswählen übernehmen.', en: 'Take it with Choose.', ru: 'Подтвердите кнопкой «Выбрать».' },
    selected_new: {
        de: '{n} neue Datenpunkte ausgewählt.',
        en: '{n} new datapoints chosen.',
        ru: 'Выбрано новых точек данных: {n}.',
    },
    skipped_kind: {
        de: ' Ohne passende Geräteart übersprungen: {ids}',
        en: ' Skipped without a matching kind of device: {ids}',
        ru: ' Пропущены (нет подходящего типа устройства): {ids}',
    },
    loading_objects: { de: 'Objekte werden geladen …', en: 'Loading objects …', ru: 'Загрузка объектов …' },
    available: { de: '{n} Datenpunkte verfügbar.', en: '{n} datapoints available.', ru: 'Доступно точек данных: {n}.' },
    list_expected: { de: 'Eine Liste wird erwartet.', en: 'A list is expected.', ru: 'Ожидается список.' },
    saved_devices: { de: '{n} Geräte verbunden.', en: '{n} devices connected.', ru: 'Подключено устройств: {n}.' },
    // the object tree and the picker
    tree_aria: { de: 'ioBroker Objektbaum', en: 'ioBroker object tree', ru: 'Дерево объектов ioBroker' },
    col_id: { de: 'Objekt-ID / Name', en: 'Object ID / name', ru: 'ID объекта / имя' },
    col_role: { de: 'Rolle / Typ', en: 'Role / type', ru: 'Роль / тип' },
    col_value: { de: 'Wert', en: 'Value', ru: 'Значение' },
    collapse: { de: '{id} zuklappen', en: 'Collapse {id}', ru: 'Свернуть {id}' },
    expand: { de: '{id} aufklappen', en: 'Expand {id}', ru: 'Развернуть {id}' },
    select_aria: { de: '{name} ({id}) auswählen', en: 'Choose {name} ({id})', ru: 'Выбрать {name} ({id})' },
    adapter: { de: 'Adapter', en: 'Adapter', ru: 'Адаптер' },
    instance: { de: 'Instanz', en: 'Instance', ru: 'Экземпляр' },
    device_channel: { de: 'Gerät / Kanal', en: 'Device / channel', ru: 'Устройство / канал' },
    no_match: {
        de: 'Keine passenden Datenpunkte. Suche oder Filter ändern.',
        en: 'No matching datapoints. Change the search or the filters.',
        ru: 'Нет подходящих точек данных. Измените поиск или фильтры.',
    },
    show_more: { de: 'Weitere anzeigen ({n})', en: 'Show more ({n})', ru: 'Показать ещё ({n})' },
    // voice control through the adapter Assistant (assistant.ts)
    voice_in_room: { de: '{text} im Raum {room}', en: '{text} in the room {room}', ru: '{text} в комнате {room}' },
    voice_no_assistant: {
        de: 'Kein Assistant gefunden: Installiere den Adapter Assistant und schalte ihn ein.',
        en: 'No Assistant found: install the adapter Assistant and switch it on.',
        ru: 'Assistant не найден: установите адаптер Assistant и включите его.',
    },
    voice_no_answer: {
        de: '{instance} antwortet nicht (läuft er?)',
        en: '{instance} does not answer (is it running?)',
        ru: '{instance} не отвечает (он запущен?)',
    },
    choose_datapoint: { de: 'Datenpunkt auswählen', en: 'Choose a datapoint', ru: 'Выбрать точку данных' },
    choose_datapoints: { de: 'Datenpunkte auswählen', en: 'Choose datapoints', ru: 'Выбрать точки данных' },
    // status line
    offline: {
        de: 'Offline · Verbindung zu ioBroker getrennt',
        en: 'Offline · connection to ioBroker lost',
        ru: 'Нет связи · соединение с ioBroker потеряно',
    },
    connected: { de: 'Verbunden · {n} Geräte', en: 'Connected · {n} devices', ru: 'Подключено · устройств: {n}' },
    error: { de: 'Fehler · {error}', en: 'Error · {error}', ru: 'Ошибка · {error}' },
    // datapoints chosen in the editor
    datapoint_for: { de: 'Datenpunkt für {name}', en: 'Datapoint for {name}', ru: 'Точка данных для {name}' },
    picture_datapoint: {
        de: 'Datenpunkt mit dem Bild (z. B. slideshow.0.picture)',
        en: 'Datapoint with the picture (e.g. slideshow.0.picture)',
        ru: 'Точка данных с изображением (например, slideshow.0.picture)',
    },
    not_datapoint: {
        de: '{id} ist kein Datenpunkt.',
        en: '{id} is no datapoint.',
        ru: '{id} не является точкой данных.',
    },
    no_device: { de: 'Kein ioBroker-Gerät: {id}', en: 'No ioBroker device: {id}', ru: 'Не устройство ioBroker: {id}' },
    reach_saved: {
        de: '{name} · „nicht erreichbar“ gespeichert',
        en: '{name} · "unreachable" saved',
        ru: '{name} · «недоступно» сохранено',
    },
    battery_for: { de: 'Batterie für {name}', en: 'Battery for {name}', ru: 'Батарея для {name}' },
    battery_saved: {
        de: '{name} · Batterie: {battery}',
        en: '{name} · battery: {battery}',
        ru: '{name} · батарея: {battery}',
    },
    battery_none: { de: 'keine', en: 'none', ru: 'нет' },
    battery_auto: { de: 'automatisch', en: 'automatic', ru: 'автоматически' },
    position_pick: { de: 'Position (GPS)', en: 'Position (GPS)', ru: 'Позиция (GPS)' },
    position_from: { de: 'Position aus {id}', en: 'Position from {id}', ru: 'Позиция из {id}' },
    position_system: {
        de: 'Position aus den Systemeinstellungen',
        en: 'Position from the system settings',
        ru: 'Позиция из системных настроек',
    },
    timetravel_from: { de: 'Zeitreise aus {id}', en: 'Time travel from {id}', ru: '«Машина времени» из {id}' },
    timetravel_auto: {
        de: 'Zeitreise: Verlauf automatisch',
        en: 'Time travel: history chosen automatically',
        ru: '«Машина времени»: история выбирается автоматически',
    },
    reach_after: {
        de: 'Nicht erreichbar nach {n} min ohne Update',
        en: 'Unreachable after {n} min without an update',
        ru: 'Недоступно после {n} мин без обновлений',
    },
    reach_report: {
        de: 'Nicht erreichbar: wie das Gerät es meldet',
        en: 'Unreachable: as the device reports',
        ru: 'Недоступно: как сообщает устройство',
    },
    room_datapoints: {
        de: 'Datenpunkte für diesen Raum',
        en: 'Datapoints for this room',
        ru: 'Точки данных для этой комнаты',
    },
    added_devices: { de: '{n} Geräte verbunden', en: '{n} devices connected', ru: 'Подключено устройств: {n}' },
    added_skipped: { de: ' · übersprungen: {ids}', en: ' · skipped: {ids}', ru: ' · пропущено: {ids}' },
    // the detail dialog of a device
    unreachable: { de: 'nicht erreichbar', en: 'unreachable', ru: 'недоступно' },
    open: { de: 'offen', en: 'open', ru: 'открыто' },
    closed: { de: 'geschlossen', en: 'closed', ru: 'закрыто' },
    water: { de: 'Wasser erkannt', en: 'water detected', ru: 'обнаружена вода' },
    dry: { de: 'trocken', en: 'dry', ru: 'сухо' },
    smoke: { de: 'Rauch / Feuer!', en: 'smoke / fire!', ru: 'дым / огонь!' },
    no_smoke: { de: 'kein Rauch', en: 'no smoke', ru: 'нет дыма' },
    gas: { de: 'Gas erkannt', en: 'gas detected', ru: 'обнаружен газ' },
    no_gas: { de: 'kein Gas', en: 'no gas', ru: 'нет газа' },
    motion: { de: 'Bewegung', en: 'motion', ru: 'движение' },
    no_motion: { de: 'keine Bewegung', en: 'no motion', ru: 'нет движения' },
    power: { de: 'Strom da', en: 'power on', ru: 'есть питание' },
    no_power: { de: 'kein Strom', en: 'no power', ru: 'нет питания' },
    on: { de: 'an', en: 'on', ru: 'вкл.' },
    off: { de: 'aus', en: 'off', ru: 'выкл.' },
    turn_on: { de: 'Ein', en: 'On', ru: 'Вкл.' },
    turn_off: { de: 'Aus', en: 'Off', ru: 'Выкл.' },
    since: { de: 'seit {time}', en: 'since {time}', ru: 'с {time}' },
    range: { de: 'Zeitraum', en: 'Period', ru: 'Период' },
    days: { de: '{n} Tage', en: '{n} days', ru: '{n} дн.' },
    history_loading: { de: 'Verlauf wird geladen …', en: 'Loading the history …', ru: 'Загрузка истории …' },
    history_error: {
        de: 'Verlauf nicht lesbar: {error}',
        en: 'History not readable: {error}',
        ru: 'Не удалось прочитать историю: {error}',
    },
    history_empty: {
        de: 'Keine Werte in diesem Zeitraum.',
        en: 'No values in this period.',
        ru: 'Нет значений за этот период.',
    },
    times_in_range: {
        de: '{what}: {n}× im Zeitraum',
        en: '{what}: {n}× in this period',
        ru: '{what}: {n} раз(а) за период',
    },
    // projects
    projects_dialog: { de: 'Projekte', en: 'Projects', ru: 'Проекты' },
    projects_intro: {
        de: 'Jedes Projekt hat eigene Grundrisse, Bilder, 3D-Modelle, Geräte und Einstellungen – etwa ein Haus und ein Boot. Geöffnet wird es über seinen Link, der auch im Kiosk und in VIS gilt.',
        en: 'Each project has its own floor plans, pictures, 3D models, devices and settings – a house and a boat, say. It opens by its link, which works in the kiosk and in VIS too.',
        ru: 'У каждого проекта свои планы, изображения, 3D-модели, устройства и настройки – например, дом и лодка. Он открывается по своей ссылке, которая работает и в киоске, и в VIS.',
    },
    tab_projects: { de: 'Projekte', en: 'Projects', ru: 'Проекты' },
    tab_plans: { de: 'Grundriss-Dateien', en: 'Floor plan files', ru: 'Файлы планов' },
    plans_intro: {
        de: 'Eine Grundriss-Datei enthält einen Grundriss mit seinen Bildern und den verbundenen ioBroker-Datenpunkten. Beim Import entsteht ein neuer Grundriss im offenen Projekt; die vorhandenen bleiben unverändert.',
        en: 'A floor plan file holds one floor plan with its pictures and the connected ioBroker datapoints. An import creates a new floor plan in the open project; the others stay as they are.',
        ru: 'Файл плана содержит один план с его изображениями и подключёнными точками данных ioBroker. При импорте в открытом проекте создаётся новый план; остальные остаются без изменений.',
    },
    default_project: { de: 'Standardprojekt', en: 'Default project', ru: 'Проект по умолчанию' },
    project_open_now: { de: 'geöffnet', en: 'open', ru: 'открыт' },
    project_list_summary: {
        de: '{plans} Grundrisse, {devices} Geräte',
        en: '{plans} floor plans, {devices} devices',
        ru: 'планов: {plans}, устройств: {devices}',
    },
    project_broken: {
        de: 'data.json nicht lesbar',
        en: 'data.json not readable',
        ru: 'data.json не читается',
    },
    project_actions: { de: 'Aktionen für {name}', en: 'Actions for {name}', ru: 'Действия для {name}' },
    project_open: { de: 'Öffnen', en: 'Open', ru: 'Открыть' },
    project_rename: { de: 'Umbenennen …', en: 'Rename …', ru: 'Переименовать …' },
    project_copy: { de: 'Duplizieren …', en: 'Duplicate …', ru: 'Дублировать …' },
    project_download: { de: 'Exportieren: herunterladen', en: 'Export: download', ru: 'Экспорт: скачать' },
    project_store: {
        de: 'Exportieren: in ioBroker speichern',
        en: 'Export: save in ioBroker',
        ru: 'Экспорт: сохранить в ioBroker',
    },
    project_delete: { de: 'Löschen …', en: 'Delete …', ru: 'Удалить …' },
    project_delete_go: { de: 'Löschen', en: 'Delete', ru: 'Удалить' },
    project_delete_open: {
        de: 'Das geöffnete Projekt lässt sich nicht löschen: erst ein anderes öffnen.',
        en: 'The open project cannot be deleted: open another one first.',
        ru: 'Открытый проект удалить нельзя: сначала откройте другой.',
    },
    new_project: { de: 'Neues Projekt', en: 'New project', ru: 'Новый проект' },
    project_name: { de: 'Name des Projekts', en: 'Name of the project', ru: 'Название проекта' },
    project_create: { de: 'Anlegen und öffnen', en: 'Create and open', ru: 'Создать и открыть' },
    project_copy_name: { de: '{name} (Kopie)', en: '{name} (copy)', ru: '{name} (копия)' },
    project_copy_title: {
        de: 'Projekt „{name}“ duplizieren',
        en: 'Duplicate the project "{name}"',
        ru: 'Дублировать проект «{name}»',
    },
    project_rename_title: {
        de: 'Projekt „{name}“ umbenennen',
        en: 'Rename the project "{name}"',
        ru: 'Переименовать проект «{name}»',
    },
    project_delete_title: {
        de: 'Projekt „{name}“ löschen?',
        en: 'Delete the project "{name}"?',
        ru: 'Удалить проект «{name}»?',
    },
    project_delete_hint: {
        de: 'Alle Grundrisse, Bilder, 3D-Modelle, Wiederherstellungspunkte und Geräte des Projekts werden gelöscht. Das lässt sich nicht rückgängig machen – vorher exportieren, wenn du es noch brauchst.',
        en: 'All floor plans, pictures, 3D models, restore points and devices of the project are deleted. This cannot be undone – export it first if you still need it.',
        ru: 'Все планы, изображения, 3D-модели, точки восстановления и устройства проекта будут удалены. Это нельзя отменить – сначала экспортируйте проект, если он ещё нужен.',
    },
    project_deleted: {
        de: 'Projekt „{name}“ gelöscht.',
        en: 'Project "{name}" deleted.',
        ru: 'Проект «{name}» удалён.',
    },
    project_copied: {
        de: 'Projekt „{name}“ angelegt.',
        en: 'Project "{name}" created.',
        ru: 'Проект «{name}» создан.',
    },
    project_import: { de: 'Projekt importieren', en: 'Import a project', ru: 'Импорт проекта' },
    project_import_hint: {
        de: 'Eine Projektdatei (auch eine „Sicherung“ aus den Einstellungen des Editors) wird zu einem neuen Projekt.',
        en: 'A project file (also a "Backup" from the settings of the editor) becomes a new project.',
        ru: 'Файл проекта (также «Резервная копия» из настроек редактора) становится новым проектом.',
    },
    project_import_go: {
        de: 'Als neues Projekt importieren',
        en: 'Import as a new project',
        ru: 'Импортировать как новый проект',
    },
    project_imported: {
        de: 'Projekt „{name}“ importiert.',
        en: 'Project "{name}" imported.',
        ru: 'Проект «{name}» импортирован.',
    },
    project_file_summary: {
        de: '{plans} Grundrisse, {images} Bilder, {devices} Geräte',
        en: '{plans} floor plans, {images} pictures, {devices} devices',
        ru: 'планов: {plans}, изображений: {images}, устройств: {devices}',
    },
    backup_file: { de: 'Projektdatei wählen', en: 'Choose a project file', ru: 'Выбрать файл проекта' },
    project_missing: {
        de: 'Dieses Projekt gibt es nicht (mehr).',
        en: 'This project does not exist (any more).',
        ru: 'Такого проекта нет (больше нет).',
    },
    project_bad_id: {
        de: 'Ungültige Projekt-ID: {id}',
        en: 'Invalid project ID: {id}',
        ru: 'Недопустимый ID проекта: {id}',
    },
    project_name_missing: {
        de: 'Bitte einen Namen eingeben.',
        en: 'Please enter a name.',
        ru: 'Введите название.',
    },
    default_project_stays: {
        de: 'Das Standardprojekt bleibt erhalten.',
        en: 'The default project stays.',
        ru: 'Проект по умолчанию остаётся.',
    },
    no_backup: {
        de: 'Die Datei ist keine Projektdatei. Eine Grundriss-Datei wird unter „Grundriss-Dateien“ importiert.',
        en: 'The file is no project file. A floor plan file is imported under "Floor plan files".',
        ru: 'Файл не является файлом проекта. Файл плана импортируется в разделе «Файлы планов».',
    },
    export: { de: 'Exportieren', en: 'Export', ru: 'Экспорт' },
    import: { de: 'Importieren', en: 'Import', ru: 'Импорт' },
    plan: { de: 'Grundriss', en: 'Floor plan', ru: 'План' },
    main_plan: { de: 'Hauptgrundriss', en: 'Main floor plan', ru: 'Основной план' },
    file_name: { de: 'Dateiname', en: 'File name', ru: 'Имя файла' },
    download: { de: 'Herunterladen', en: 'Download', ru: 'Скачать' },
    save_iobroker: { de: 'In ioBroker speichern', en: 'Save in ioBroker', ru: 'Сохранить в ioBroker' },
    from_iobroker: { de: 'Aus ioBroker wählen …', en: 'Choose from ioBroker …', ru: 'Выбрать из ioBroker …' },
    from_computer: { de: 'Vom Computer …', en: 'From the computer …', ru: 'С компьютера …' },
    new_plan_name: { de: 'Name des neuen Grundrisses', en: 'Name of the new floor plan', ru: 'Название нового плана' },
    plan_file: { de: 'Grundriss-Datei wählen', en: 'Choose a floor plan file', ru: 'Выбрать файл плана' },
    plan_summary: {
        de: '{floors} Etagen, {rooms} Räume',
        en: '{floors} floors, {rooms} rooms',
        ru: 'этажей: {floors}, комнат: {rooms}',
    },
    project_summary: {
        de: '{floors} Etagen, {rooms} Räume, {images} Bilder, {devices} Geräte',
        en: '{floors} floors, {rooms} rooms, {images} pictures, {devices} devices',
        ru: 'этажей: {floors}, комнат: {rooms}, изображений: {images}, устройств: {devices}',
    },
    downloaded: { de: '„{name}“ heruntergeladen.', en: '"{name}" downloaded.', ru: '«{name}» скачан.' },
    saved_in: {
        de: 'Gespeichert in ioBroker: {path}',
        en: 'Saved in ioBroker: {path}',
        ru: 'Сохранено в ioBroker: {path}',
    },
    file_empty: { de: 'Datei leer: {path}', en: 'File empty: {path}', ru: 'Файл пуст: {path}' },
    imported: {
        de: 'Grundriss „{name}“ angelegt: {images} Bilder, {devices} Geräte. Oben im Grundriss-Menü auswählbar.',
        en: 'Floor plan "{name}" created: {images} pictures, {devices} devices. Choose it in the floor plan menu at the top.',
        ru: 'План «{name}» создан: изображений: {images}, устройств: {devices}. Его можно выбрать в меню планов вверху.',
    },
    renamed: {
        de: 'Umbenannt (gab es schon): {from} → {to}',
        en: 'Renamed (existed already): {from} → {to}',
        ru: 'Переименовано (уже существовало): {from} → {to}',
    },
    skipped: { de: 'Übersprungen: {id} – {reason}', en: 'Skipped: {id} – {reason}', ru: 'Пропущено: {id} – {reason}' },
    not_json: { de: 'Die Datei ist kein JSON.', en: 'The file is no JSON.', ru: 'Файл не в формате JSON.' },
    no_project: {
        de: 'Die Datei enthält keinen 3D-Home-Grundriss.',
        en: 'The file holds no 3D Home floor plan.',
        ru: 'Файл не содержит плана 3D Home.',
    },
    // errors of the storage and the mappings
    read_only: {
        de: 'Nur ansehen: Dieser Benutzer darf das Projekt nicht ändern.',
        en: 'View only: this user may not change the project.',
        ru: 'Только просмотр: этому пользователю нельзя изменять проект.',
    },
    bad_plan: { de: 'Ungültiger Grundriss.', en: 'Invalid floor plan.', ru: 'Недопустимый план.' },
    bad_floor: { de: 'Ungültiges Stockwerk.', en: 'Invalid floor.', ru: 'Недопустимый этаж.' },
    file_broken: { de: '{file} ist beschädigt.', en: '{file} is damaged.', ru: 'Файл {file} повреждён.' },
    image_type: {
        de: 'Nur PNG, JPEG, WebP oder GIF als Data-URL.',
        en: 'Only PNG, JPEG, WebP or GIF as a data URL.',
        ru: 'Только PNG, JPEG, WebP или GIF в виде data-URL.',
    },
    image_missing: { de: 'Bild fehlt.', en: 'Picture missing.', ru: 'Изображение отсутствует.' },
    model_type: {
        de: 'Nur 3D-Modelle als GLB, glTF, OBJ oder STL.',
        en: 'Only 3D models as GLB, glTF, OBJ or STL.',
        ru: 'Только 3D-модели в формате GLB, glTF, OBJ или STL.',
    },
    model_big: {
        de: 'Das 3D-Modell ist größer als {mb} MB.',
        en: 'The 3D model is larger than {mb} MB.',
        ru: '3D-модель больше {mb} МБ.',
    },
    model_missing: { de: '3D-Modell fehlt.', en: '3D model missing.', ru: '3D-модель отсутствует.' },
    image_unreadable: { de: 'Bild nicht lesbar.', en: 'Picture not readable.', ru: 'Изображение не читается.' },
    plan_missing: { de: 'Grundriss nicht vorhanden.', en: 'Floor plan not found.', ru: 'План не найден.' },
    bad_instance: {
        de: 'Ungültige Instanz für die Zeitreise.',
        en: 'Invalid instance for the time travel.',
        ru: 'Недопустимый экземпляр для «Машины времени».',
    },
    bad_minutes: {
        de: 'Minuten für „nicht erreichbar“: 1 bis 10080.',
        en: 'Minutes for "unreachable": 1 to 10080.',
        ru: 'Минуты для «недоступно»: от 1 до 10080.',
    },
    stale: {
        de: 'Inzwischen anderswo gespeichert. Bitte neu laden.',
        en: 'Saved elsewhere in the meantime. Please reload.',
        ru: 'Тем временем сохранено в другом месте. Перезагрузите страницу.',
    },
    bad_order: { de: 'Ungültige Reihenfolge.', en: 'Invalid order.', ru: 'Недопустимый порядок.' },
    bad_plan_id: { de: 'Ungültige Grundriss-ID.', en: 'Invalid floor plan ID.', ru: 'Недопустимый ID плана.' },
    main_plan_stays: {
        de: 'Der Hauptgrundriss bleibt erhalten.',
        en: 'The main floor plan stays.',
        ru: 'Основной план остаётся.',
    },
    no_packs: {
        de: 'Möbel-Packs werden in ioBroker nicht unterstützt.',
        en: 'Furniture packs are not supported in ioBroker.',
        ru: 'Пакеты мебели в ioBroker не поддерживаются.',
    },
    not_implemented: {
        de: 'Noch nicht für ioBroker implementiert: {type}',
        en: 'Not implemented for ioBroker yet: {type}',
        ru: 'Для ioBroker ещё не реализовано: {type}',
    },
    mappings_list: {
        de: 'Zuordnungen müssen eine Liste sein (max. 10000).',
        en: 'Mappings must be a list (at most 10000).',
        ru: 'Привязки должны быть списком (не более 10000).',
    },
    mappings_list_short: {
        de: 'Zuordnungen müssen eine Liste sein.',
        en: 'Mappings must be a list.',
        ru: 'Привязки должны быть списком.',
    },
    bad_entity_id: {
        de: 'Ungültige oder doppelte entity_id.',
        en: 'Invalid or duplicate entity_id.',
        ru: 'Недопустимый или повторяющийся entity_id.',
    },
    datapoint_missing: {
        de: 'Datenpunkt fehlt: {id}',
        en: 'Datapoint missing: {id}',
        ru: 'Точка данных отсутствует: {id}',
    },
    bad_when: {
        de: 'Bedingung braucht einen vorhandenen Datenpunkt und eine Liste von Werten: {id}',
        en: 'A condition needs an existing datapoint and a list of values: {id}',
        ru: 'Условию нужны существующая точка данных и список значений: {id}',
    },
    bad_else: {
        de: 'else der Bedingung muss Text sein.',
        en: 'else of the condition must be text.',
        ru: 'else условия должно быть текстом.',
    },
    bad_reach: {
        de: '„Nicht erreichbar“: report, never oder 1 bis 10080 Minuten: {id}',
        en: '"Unreachable": report, never or 1 to 10080 minutes: {id}',
        ru: '«Недоступно»: report, never или от 1 до 10080 минут: {id}',
    },
    bad_reach_connected: {
        de: 'reach_connected muss true oder false sein: {id}',
        en: 'reach_connected must be true or false: {id}',
        ru: 'reach_connected должно быть true или false: {id}',
    },
    bad_battery: {
        de: '„Batterie“ muss ein Datenpunkt oder none sein: {id}',
        en: '"Battery" must be a datapoint or none: {id}',
        ru: '«Батарея» должна быть точкой данных или none: {id}',
    },
    bad_parts: {
        de: '„parts“ muss die Datenpunkte nach Teil nennen: {id}',
        en: '"parts" must name the datapoints by part: {id}',
        ru: '«parts» должно называть точки данных по частям: {id}',
    },
    part_for: {
        de: '{part} für {name}',
        en: '{part} for {name}',
        ru: '{part} для {name}',
    },
    part_saved: {
        de: '{name}: {part} · {id}',
        en: '{name}: {part} · {id}',
        ru: '{name}: {part} · {id}',
    },
    part_removed: {
        de: '{name}: {part} entfernt',
        en: '{name}: {part} removed',
        ru: '{name}: {part} удалено',
    },
    part_last: {
        de: 'Ein Gerät braucht mindestens einen Datenpunkt.',
        en: 'A device needs at least one datapoint.',
        ru: 'Устройству нужна хотя бы одна точка данных.',
    },
    kind_taken: {
        de: 'Das Gerät {id} gibt es schon.',
        en: 'The device {id} exists already.',
        ru: 'Устройство {id} уже существует.',
    },
    kind_saved: {
        de: '{name}: jetzt {kind}, {n} Datenpunkte',
        en: '{name}: now {kind}, {n} datapoints',
        ru: '{name}: теперь {kind}, точек данных: {n}',
    },
    attribute_missing: {
        de: 'Attribut-Datenpunkt fehlt: {id}',
        en: 'Attribute datapoint missing: {id}',
        ru: 'Точка данных атрибута отсутствует: {id}',
    },
    actions_list: {
        de: 'Aktionen müssen Listen sein.',
        en: 'Actions must be lists.',
        ru: 'Действия должны быть списками.',
    },
    not_writable: {
        de: 'Datenpunkt nicht schreibbar: {id}',
        en: 'Datapoint not writable: {id}',
        ru: 'Точка данных недоступна для записи: {id}',
    },
    bad_action: {
        de: 'Aktion braucht field, value oder toggle.',
        en: 'An action needs field, value or toggle.',
        ru: 'Действию нужны field, value или toggle.',
    },
    bad_convert: {
        de: 'convert einer Aktion muss rgb_hex oder rgbw_hex sein.',
        en: 'convert of an action must be rgb_hex or rgbw_hex.',
        ru: 'convert действия должен быть rgb_hex или rgbw_hex.',
    },
    not_number: { de: '{key} muss eine Zahl sein.', en: '{key} must be a number.', ru: '{key} должно быть числом.' },
    weather_write: {
        de: 'Ein Wettercode kann nicht geschrieben werden.',
        en: 'A weather code cannot be written.',
        ru: 'Код погоды нельзя записать.',
    },
    unknown_device: { de: 'Unbekanntes Gerät: {id}', en: 'Unknown device: {id}', ru: 'Неизвестное устройство: {id}' },
    no_action: {
        de: 'Aktion {service} für {name} nicht zugeordnet.',
        en: 'Action {service} is not mapped for {name}.',
        ru: 'Действие {service} для {name} не привязано.',
    },
    bad_type: {
        de: 'Falscher Werttyp für {id}: erwartet {type}.',
        en: 'Wrong type of value for {id}: {type} expected.',
        ru: 'Неверный тип значения для {id}: ожидается {type}.',
    },
    bad_color: {
        de: 'Farbe muss [r, g, b] sein.',
        en: 'A colour must be [r, g, b].',
        ru: 'Цвет должен быть [r, g, b].',
    },
    entity_required: { de: 'entity_id erforderlich.', en: 'entity_id required.', ru: 'Требуется entity_id.' },
    param_missing: {
        de: 'Parameter {field} fehlt.',
        en: 'Parameter {field} missing.',
        ru: 'Отсутствует параметр {field}.',
    },
    not_writable_short: { de: 'Nicht schreibbar: {id}', en: 'Not writable: {id}', ru: 'Недоступно для записи: {id}' },
    out_of_range: {
        de: 'Wert außerhalb des Bereichs: {id}',
        en: 'Value out of range: {id}',
        ru: 'Значение вне диапазона: {id}',
    },
} satisfies Record<string, Record<Lang, string>>;

export type TextKey = keyof typeof TEXTS;

let current: Lang = 'de';

/** The language of the page from the one of the ioBroker system: German, Russian, else English. */
export function setLanguage(language: string | undefined): Lang {
    const l = (language || 'de').toLowerCase();
    current = l.startsWith('de') ? 'de' : l.startsWith('ru') ? 'ru' : 'en';
    if (typeof document !== 'undefined') {
        document.documentElement.lang = current;
    }
    try {
        // the help page opens in the same language
        localStorage.setItem('home3d-lang', current);
    } catch {
        // without storage the help stays German
    }
    return current;
}

/**
 * The page's language. `<html lang>` holds it, so a copy of this module in another bundle (the entity picker in the
 * 3D frontend's) speaks the same language.
 */
export function lang(): Lang {
    const page = typeof document !== 'undefined' ? document.documentElement.lang : '';
    return page === 'de' || page === 'en' || page === 'ru' ? page : current;
}

/** A text in the page's language; `{name}` in it is replaced by `vars.name`. */
export function t(key: TextKey, vars: Record<string, string | number> = {}): string {
    let s: string = TEXTS[key][lang()];
    for (const [k, v] of Object.entries(vars)) {
        s = s.split(`{${k}}`).join(String(v));
    }
    return s;
}

/**
 * Translates the static page: `data-i18n` sets the text, `data-i18n-title`, `data-i18n-placeholder` and
 * `data-i18n-aria` the attributes.
 */
export function translatePage(root: ParentNode = document): void {
    const attrs: [string, string][] = [
        ['data-i18n-title', 'title'],
        ['data-i18n-placeholder', 'placeholder'],
        ['data-i18n-aria', 'aria-label'],
    ];
    for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
        el.textContent = t(el.dataset.i18n as TextKey);
    }
    for (const [data, attr] of attrs) {
        for (const el of root.querySelectorAll<HTMLElement>(`[${data}]`)) {
            el.setAttribute(attr, t(el.getAttribute(data) as TextKey));
        }
    }
}
