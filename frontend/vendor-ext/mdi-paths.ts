// Material Design symbols the page draws at once (sensor symbols in 3D and in the editor), without loading the whole
// set of @mdi/js: the 3D frontend imports this file too (frontend/vendor-ext/sensor-look.ts), its bundles stay small.
import {
    mdiAccessPoint,
    mdiBattery,
    mdiDoorClosed,
    mdiDoorOpen,
    mdiFire,
    mdiFridge,
    mdiGauge,
    mdiHomeFlood,
    mdiLightSwitch,
    mdiLightbulb,
    mdiMotionSensor,
    mdiMotionSensorOff,
    mdiPause,
    mdiPlay,
    mdiPowerPlug,
    mdiPowerPlugOff,
    mdiPowerSocketDe,
    mdiSmokeDetector,
    mdiSmokeDetectorAlert,
    mdiSnowflakeThermometer,
    mdiStorageTank,
    mdiThermometer,
    mdiWalk,
    mdiWater,
    mdiWaterAlert,
    mdiWaterBoiler,
    mdiWaterOff,
    mdiWaterPercent,
    mdiWeatherRainy,
    mdiWindowClosedVariant,
    mdiWindowOpenVariant,
} from '@mdi/js';

export const BUNDLED: Record<string, string> = {
    mdiAccessPoint,
    mdiBattery,
    mdiDoorClosed,
    mdiDoorOpen,
    mdiFire,
    mdiFridge,
    mdiGauge,
    mdiHomeFlood,
    mdiLightSwitch,
    mdiLightbulb,
    mdiMotionSensor,
    mdiMotionSensorOff,
    mdiPause,
    mdiPlay,
    mdiPowerPlug,
    mdiPowerPlugOff,
    mdiPowerSocketDe,
    mdiSmokeDetector,
    mdiSmokeDetectorAlert,
    mdiSnowflakeThermometer,
    mdiStorageTank,
    mdiThermometer,
    mdiWalk,
    mdiWater,
    mdiWaterAlert,
    mdiWaterBoiler,
    mdiWaterOff,
    mdiWaterPercent,
    mdiWeatherRainy,
    mdiWindowClosedVariant,
    mdiWindowOpenVariant,
};

/** "mdi:water-alert" → "mdiWaterAlert" (the export name in `@mdi/js`). */
export function exportName(icon: string): string {
    const name = icon.replace(/^mdi:/, '').toLowerCase();
    return `mdi${name.replace(/(^|-)([a-z0-9])/g, (_m: string, _d: string, c: string) => c.toUpperCase())}`;
}

/** The SVG path of a symbol of this file (null if it is not one of them). */
export function bundledPath(icon: string): string | null {
    return BUNDLED[exportName(icon)] ?? null;
}
