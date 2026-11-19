import assert from 'node:assert/strict';
import test from 'node:test';
import {
    autoRole,
    deviceCards,
    deviceFields,
    deviceKind,
    deviceLink,
    deviceModule,
    deviceWatched,
    mainEntity,
    robotState,
    vacuumPhase,
    type DeviceHost,
    type DeviceItem,
} from '../frontend/vendor-ext/device-cards';

type St = { state: string; attributes: Record<string, unknown>; last_changed?: string };
const st = (state: string, attributes: Record<string, unknown> = {}): St => ({ state, attributes });
const io = (id: string, name: string, role = '', more: Record<string, unknown> = {}): Record<string, unknown> => ({
    friendly_name: name,
    iobroker_id: id,
    iobroker_role: role,
    ...more,
});

const states: Record<string, St> = {
    // a Roborock: its state code, battery and buttons below the same device
    'sensor.v_state': st('5', io('mihome-vacuum.0.info.state', 'Saugroboter Status', 'value.state')),
    'sensor.v_bat': st('82', io('mihome-vacuum.0.info.battery', 'Akku', 'value.battery', { unit_of_measurement: '%' })),
    'switch.v_start': st('off', io('mihome-vacuum.0.control.start', 'start', 'button')),
    'switch.v_pause': st('off', io('mihome-vacuum.0.control.pause', 'pause', 'button')),
    'switch.v_home': st('off', io('mihome-vacuum.0.control.home', 'home', 'button')),
    // a Landroid
    'sensor.m_state': st('4', io('worx.0.123.mower.status', 'Landroid Status', 'value')),
    'sensor.m_bat': st('34', io('worx.0.123.mower.batteryState', 'Batterie', 'value.battery', { unit_of_measurement: '%' })),
    'switch.m_start': st('off', io('worx.0.123.mower.state', 'Mähen starten', 'switch')),
    // a coffee machine
    'switch.c_power': st('on', io('jura.0.power', 'Kaffeemaschine', 'switch.power')),
    'sensor.c_w': st('1200', io('jura.0.watt', 'Kaffeemaschine Leistung', 'value.power', { unit_of_measurement: 'W' })),
    'binary_sensor.c_water': st('on', io('jura.0.water_empty', 'Wassertank leer', 'indicator')),
    'sensor.c_beans': st('60', io('jura.0.beans', 'Bohnen', 'value', { unit_of_measurement: '%' })),
    'sensor.c_cups': st('1234', io('jura.0.counter', 'Bezüge gesamt', 'value')),
    'switch.c_esp': st('off', io('jura.0.espresso', 'Espresso', 'button')),
    'switch.c_cap': st('off', io('jura.0.cappuccino', 'Cappuccino', 'button')),
    'sensor.room': st('21', io('hm.0.temp', 'Wohnzimmer Temperatur', 'value.temperature')),
};
const hass = { states };

const vacuum: DeviceItem = { id: 'v', type: 'robot_vacuum', entity: 'sensor.v_state' };
const mower: DeviceItem = { id: 'm', type: 'robot_mower', entity: 'sensor.m_state' };
const coffee: DeviceItem = { id: 'c', type: 'coffee_machine' };

test('the kinds and the states of robots', () => {
    assert.equal(deviceKind('robot_vacuum'), 'vacuum');
    assert.equal(deviceKind('robot_mower'), 'mower');
    assert.equal(deviceKind('coffee_machine'), 'coffee');
    assert.equal(deviceKind('sofa'), null);
    assert.equal(vacuumPhase('5'), 'cleaning');
    assert.equal(vacuumPhase(8), 'docked');
    assert.equal(vacuumPhase('returning'), 'returning');
    assert.equal(vacuumPhase('Fährt zurück zur Station'), 'returning');
    assert.equal(vacuumPhase('Reinigung pausiert'), 'paused');
    assert.equal(vacuumPhase('Charging error'), 'error');
    assert.equal(vacuumPhase('docked'), 'docked');
    // the 3D robot drives by the words it knows
    assert.equal(robotState('5'), 'cleaning');
    assert.equal(robotState('10'), 'idle');
    assert.equal(robotState(undefined), undefined);
});

test('the datapoints are found below the same device, a chosen one wins, "none" switches one off', () => {
    assert.equal(autoRole(hass, vacuum, 'battery'), 'sensor.v_bat');
    assert.equal(autoRole(hass, vacuum, 'start'), 'switch.v_start');
    assert.equal(autoRole(hass, vacuum, 'pause'), 'switch.v_pause');
    assert.equal(autoRole(hass, vacuum, 'home'), 'switch.v_home');
    assert.equal(autoRole(hass, mower, 'battery'), 'sensor.m_bat');
    assert.equal(autoRole(hass, mower, 'start'), 'switch.m_start');
    // the coffee machine's switch by its name, its parts below it
    assert.equal(mainEntity(hass, coffee), 'switch.c_power');
    assert.equal(autoRole(hass, coffee, 'power'), 'sensor.c_w');
    assert.equal(autoRole(hass, coffee, 'water'), 'binary_sensor.c_water');
    assert.equal(autoRole(hass, coffee, 'cups'), 'sensor.c_cups');
    assert.deepEqual([autoRole(hass, coffee, 'drink1'), autoRole(hass, coffee, 'drink2'), autoRole(hass, coffee, 'drink3')], ['switch.c_cap', 'switch.c_esp', null]);
    const chosen: DeviceItem = { ...vacuum, device_links: { battery: 'sensor.room', pause: 'none' } };
    assert.equal(deviceLink(hass, chosen, 'battery'), 'sensor.room');
    assert.equal(deviceLink(hass, chosen, 'pause'), null);
});

test('the cards: state, battery, warnings, buttons that switch only through the mappings', async () => {
    const calls: string[] = [];
    let saved: unknown = null;
    const b = { floors: [{ id: 'eg', furniture: [vacuum, mower, coffee, { id: 's', type: 'sofa' }] }] };
    const host: DeviceHost = {
        hass: () => hass,
        building: () => b,
        language: () => 'de',
        callService: (d, s, data) => {
            calls.push(`${d}.${s}:${String(data?.entity_id)}`);
            return Promise.resolve();
        },
        updateBuilding: m => {
            const next = structuredClone(b);
            m(next);
            saved = next;
        },
    };
    type Card = {
        id: string;
        live: string;
        rows: { label: string; value: string; at?: number }[];
        hint?: { text: string };
        main?: { text: string };
        chips?: { items: { label: string; onTap(): void }[] }[];
        buttons: { label: string; title: string; on: boolean; onTap(): void }[];
    };
    const cards = deviceCards(host) as Card[];
    assert.deepEqual(cards.map(c => c.id), ['devices:v', 'devices:m', 'devices:c']);
    const [v, m, c] = cards;
    assert.equal(v.live, 'saugt');
    assert.deepEqual(v.rows[0], { label: 'Akku', value: '82 %', at: 82, fill: true, color: '#4cd97b' });
    assert.deepEqual(v.buttons.map(x => [x.label, x.title, x.on]), [
        ['▶', 'Start', true],
        ['⏸', 'Pause', false],
        ['⌂', 'Zur Station', false],
    ]);
    v.buttons[2].onTap();
    // Landroid 4 = returning home; without its own pause and dock datapoints only "Start"
    assert.equal(m.live, 'fährt zur Station');
    assert.equal(m.buttons.length, 1);
    assert.equal(c.live, 'heizt');
    assert.equal(c.main?.text, '1.234');
    assert.match(c.hint?.text ?? '', /Wassertank auffüllen/);
    assert.deepEqual(c.rows.find(r => r.label === 'Bohnen'), { label: 'Bohnen', value: '60 %', at: 60, fill: true });
    assert.deepEqual(c.chips?.[0].items.map(i => i.label), ['Cappuccino', 'Espresso']);
    c.chips?.[0].items[1].onTap();
    c.buttons[0].onTap();
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(calls, ['switch.turn_on:switch.v_home', 'switch.turn_on:switch.c_esp', 'switch.toggle:switch.c_power']);
    assert.ok(deviceWatched(host).includes('binary_sensor.c_water'));
    // the form: switching the card off, choosing a datapoint
    const fields = deviceFields(host, vacuum) as { kind: string; label?: string; auto?: string; set?: (v: unknown) => void }[];
    assert.equal(fields.find(f => f.label === 'Akku')?.auto, 'sensor.v_bat');
    fields.find(f => f.label === 'Pause')?.set?.('switch.v_home');
    assert.equal((saved as typeof b).floors[0].furniture[0].device_links?.pause, 'switch.v_home');
    fields.find(f => f.kind === 'check')?.set?.(false);
    assert.equal((saved as typeof b).floors[0].furniture[0].device_card, false);
    assert.equal(deviceModule.id, 'home3d.devices');
});
