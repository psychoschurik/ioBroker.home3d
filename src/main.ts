import * as utils from "@iobroker/adapter-core";
import { Backend } from "./lib/backend.js";
import { createServer } from "./lib/server.js";
class Home3D extends utils.Adapter {
  declare config: ioBroker.AdapterConfig & {
    accessToken: string;
    port: number;
    bind: string;
    language: string;
  };
  liveStates: Record<string, ioBroker.State>;
  stateObjects: Record<string, ioBroker.StateObject>;
  roomObjects: Record<string, ioBroker.EnumObject>;
  backend?: Backend;
  server?: import("node:http").Server;

  constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "3d-home" });
    this.on("ready", () => this.ready());
    this.on("unload", (cb) => this.unload(cb));
    this.on("stateChange", (id, state) => {
      if (state) this.liveStates[id] = state;
      else delete this.liveStates[id];
    });
    this.on("objectChange", (id, obj) => {
      if (id.startsWith("enum.rooms.")) {
        if (obj?.type === "enum") this.roomObjects[id] = obj;
        else delete this.roomObjects[id];
      } else {
        if (obj?.type === "state") this.stateObjects[id] = obj;
        else delete this.stateObjects[id];
      }
    });
    this.liveStates = {};
    this.stateObjects = {};
    this.roomObjects = {};
  }
  async ready() {
    try {
      await this.setStateAsync("info.connection", false, true);
      if (!this.config.accessToken || this.config.accessToken.length < 16)
        throw new Error(
          "Zugangsschlüssel mit mindestens 16 Zeichen in den Adaptereinstellungen setzen.",
        );
      await this.setObjectNotExistsAsync("storage", {
        type: "state",
        common: {
          name: "Plans, images and device mappings",
          type: "string",
          role: "json",
          read: true,
          write: false,
        },
        native: {},
      });
      this.stateObjects = await this.getForeignObjectsAsync("*", "state");
      this.roomObjects = await this.getForeignObjectsAsync(
        "enum.rooms.*",
        "enum",
      );
      await this.subscribeForeignObjectsAsync("*");
      await this.subscribeForeignStatesAsync("*");
      this.liveStates = await this.getForeignStatesAsync("*");
      const stored = await this.getStateAsync("storage");
      const data =
        typeof stored?.val === "string" && stored.val
          ? JSON.parse(stored.val)
          : null;
      this.backend = new Backend(
        {
          objects: async () => this.stateObjects,
          rooms: async () => this.roomObjects,
          states: async () => this.liveStates,
          getObject: (id) => this.getForeignObjectAsync(id),
          getState: (id) => this.getForeignStateAsync(id),
          setState: (id, val) =>
            this.setForeignStateAsync(id, { val, ack: false }),
        },
        data,
        (data) => this.setStateAsync("storage", JSON.stringify(data), true),
        this.config.language,
      );
      this.server = createServer(this.backend, this.config.accessToken);
      this.server.on("error", (e) => {
        this.log.error(e.message);
        void this.setStateAsync("info.connection", false, true);
      });
      const server = this.server;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(
          this.config.port || 8097,
          this.config.bind || "0.0.0.0",
          resolve,
        );
      });
      await this.setStateAsync("info.connection", true, true);
      this.log.info(`3D Home bereit auf Port ${this.config.port || 8097}`);
    } catch (e) {
      this.log.error(`Start fehlgeschlagen: ${e.message}`);
    }
  }
  unload(cb: () => void) {
    try {
      this.server?.close();
      this.server?.closeAllConnections();
      cb();
    } catch {
      cb();
    }
  }
}
if (module.parent)
  module.exports = (options: Partial<utils.AdapterOptions>) =>
    new Home3D(options);
else new Home3D();
