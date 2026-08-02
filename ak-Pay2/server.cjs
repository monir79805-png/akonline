var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_config = require("dotenv/config");
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");

// mikrotikService.ts
var import_routeros_client = require("routeros-client");
var DEFAULT_MIKROTIK_API_PORT = 8728;
function parseConnectionOptions(body) {
  const host = String(body.ip || body.routerIp || body.host || "").trim();
  const username = String(body.apiUsername || body.username || body.user || "").trim();
  const password = String(body.apiPassword || body.password || "").trim();
  const port = body.port ? Number(body.port) : DEFAULT_MIKROTIK_API_PORT;
  if (!host) {
    throw new Error("MikroTik router IP address is required.");
  }
  if (!username) {
    throw new Error("MikroTik API username is required.");
  }
  if (!password) {
    throw new Error("MikroTik API password is required.");
  }
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error("MikroTik API port must be a valid number between 1 and 65535.");
  }
  return { host, port, username, password };
}
async function connectToMikroTik(body) {
  const { host, port, username, password } = parseConnectionOptions(body);
  const api = new import_routeros_client.RouterOSClient({
    host,
    port,
    user: username,
    password,
    timeout: 2e4
  });
  const client = await api.connect();
  return { api, client };
}
async function testMikroTikConnection(body) {
  const { api, client } = await connectToMikroTik(body);
  try {
    const identity = await client.menu("/system identity").getOnly();
    const resource = await client.menu("/system resource").getOnly();
    return {
      identity: String(identity.identity || "Unknown MikroTik"),
      boardName: String(resource.boardName || "MikroTik RouterBOARD"),
      version: String(resource.version || "unknown"),
      uptime: String(resource.uptime || "unknown"),
      cpuLoad: String(resource.cpuLoad ?? "0%"),
      activeMemory: resource.activeMemory ? String(resource.activeMemory) : void 0,
      freeMemory: resource.freeMemory ? String(resource.freeMemory) : void 0
    };
  } finally {
    api.close();
  }
}
async function syncMikroTikUser(body) {
  const credentials = parseConnectionOptions(body);
  const targetUsername = String(body.targetUsername || body.userToSync || body.mikrotikUsername || body.pppoeUsername || body.username || "").trim();
  if (!targetUsername) {
    throw new Error("Target MikroTik username is required to sync a user.");
  }
  const action = String(body.action || body.status || "status").trim().toLowerCase();
  const requestType = String(body.requestType || "").trim().toLowerCase();
  const isDisable = action === "disable" || action === "expired" || requestType === "disable";
  const isEnable = action === "enable" || action === "active" || requestType === "enable";
  const { api, client } = await connectToMikroTik(credentials);
  try {
    const targets = [
      { path: "/ppp/secret", label: "PPPoE Secret" },
      { path: "/ip/hotspot/user", label: "Hotspot User" }
    ];
    for (const target of targets) {
      const menu = client.menu(target.path);
      try {
        const entry = await menu.where({ name: targetUsername }).getOnly();
        const model = client.model(entry);
        if (action === "remove" || requestType === "remove") {
          await model.remove();
          return {
            message: `Removed ${target.label} '${targetUsername}' from MikroTik router.`,
            action: "removed",
            username: targetUsername,
            target: target.path,
            routerId: credentials.host,
            routedAction: "remove"
          };
        }
        if (isDisable) {
          await model.update({ disabled: "yes" });
          return {
            message: `Disabled ${target.label} '${targetUsername}' successfully.`,
            action: "disabled",
            username: targetUsername,
            target: target.path,
            routerId: credentials.host,
            routedAction: "disable"
          };
        }
        if (isEnable) {
          await model.update({ disabled: "no" });
          return {
            message: `Enabled ${target.label} '${targetUsername}' successfully.`,
            action: "enabled",
            username: targetUsername,
            target: target.path,
            routerId: credentials.host,
            routedAction: "enable"
          };
        }
        return {
          message: `Verified ${target.label} '${targetUsername}' exists in MikroTik router.`,
          action: "verified",
          username: targetUsername,
          target: target.path,
          routerId: credentials.host,
          routedAction: "verify"
        };
      } catch (error) {
        continue;
      }
    }
    throw new Error(`No matching PPPoE secret or Hotspot user found for '${targetUsername}'.`);
  } finally {
    api.close();
  }
}
async function getMikroTikBandwidth(body) {
  const credentials = parseConnectionOptions(body);
  const targetUsername = String(body.userToSync || body.targetUsername || body.mikrotikUsername || body.pppoeUsername || body.username || body.routerUsername || "").trim();
  const { api, client } = await connectToMikroTik(credentials);
  try {
    const response = {
      username: targetUsername || "unknown",
      ipAddress: "unknown",
      macAddress: "unknown",
      uptime: "unknown",
      rxMbps: 0,
      txMbps: 0,
      totalDownloadedMB: 0,
      totalUploadedMB: 0,
      lastUpdated: (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    };
    if (!targetUsername) {
      return response;
    }
    const activeMenus = [
      { path: "/ppp/active", nameField: "name" },
      { path: "/ip/hotspot/active", nameField: "user" }
    ];
    for (const menuItem of activeMenus) {
      try {
        const activeEntry = await client.menu(menuItem.path).where({ [menuItem.nameField]: targetUsername }).getOnly();
        response.ipAddress = String(activeEntry.address || activeEntry.remoteAddress || response.ipAddress);
        response.macAddress = String(activeEntry.macAddress || activeEntry.mac || response.macAddress);
        response.uptime = String(activeEntry.uptime || response.uptime);
        response.rxMbps = Number(activeEntry.rx || activeEntry["rx-rate"] || response.rxMbps) || response.rxMbps;
        response.txMbps = Number(activeEntry.tx || activeEntry["tx-rate"] || response.txMbps) || response.txMbps;
        response.totalDownloadedMB = Number(activeEntry["bytes-in"] || activeEntry["bytes-received"] || response.totalDownloadedMB) || response.totalDownloadedMB;
        response.totalUploadedMB = Number(activeEntry["bytes-out"] || activeEntry["bytes-sent"] || response.totalUploadedMB) || response.totalUploadedMB;
        return response;
      } catch (err) {
        continue;
      }
    }
    return response;
  } finally {
    api.close();
  }
}
async function pollMikroTikRouterStatus(body) {
  const credentials = parseConnectionOptions(body);
  const { api, client } = await connectToMikroTik(credentials);
  try {
    const identity = await client.menu("/system identity").getOnly();
    const resource = await client.menu("/system resource").getOnly();
    let pppActive = [];
    let hotspotActive = [];
    let pppSecrets = [];
    let hotspotUsers = [];
    try {
      pppActive = await client.menu("/ppp/active").get();
    } catch {
      pppActive = [];
    }
    try {
      hotspotActive = await client.menu("/ip/hotspot/active").get();
    } catch {
      hotspotActive = [];
    }
    try {
      pppSecrets = await client.menu("/ppp/secret").get();
    } catch {
      pppSecrets = [];
    }
    try {
      hotspotUsers = await client.menu("/ip/hotspot/user").get();
    } catch {
      hotspotUsers = [];
    }
    const activeSessions = [
      ...pppActive.map((entry) => ({
        ...entry,
        sessionType: "ppp"
      })),
      ...hotspotActive.map((entry) => ({
        ...entry,
        sessionType: "hotspot"
      }))
    ];
    const allUsers = [
      ...pppSecrets.map((entry) => ({
        id: String(entry[".id"] || entry.id || `${credentials.host}-ppp-${entry.name || entry.user || Date.now()}`),
        routerId: credentials.host,
        routerName: String(credentials.host),
        username: String(entry.name || entry.user || "").trim(),
        serviceType: "pppoe",
        profile: String(entry.profile || ""),
        disabled: String(entry.disabled || "no").trim().toLowerCase() === "yes",
        comment: String(entry.comment || ""),
        address: String(entry.address || ""),
        macAddress: String(entry["mac-address"] || entry.macAddress || ""),
        isOnline: false
      })),
      ...hotspotUsers.map((entry) => ({
        id: String(entry[".id"] || entry.id || `${credentials.host}-hotspot-${entry.name || entry.user || Date.now()}`),
        routerId: credentials.host,
        routerName: String(credentials.host),
        username: String(entry.name || entry.user || "").trim(),
        serviceType: "hotspot",
        profile: String(entry.profile || ""),
        disabled: String(entry.disabled || "no").trim().toLowerCase() === "yes",
        comment: String(entry.comment || ""),
        address: String(entry.address || ""),
        macAddress: String(entry["mac-address"] || entry.macAddress || ""),
        isOnline: false
      }))
    ];
    const activeUserKeys = new Set(
      activeSessions.map((item) => `${String(item.name || item.user || "").trim()}@${credentials.host}`).filter((key) => key.length > 0)
    );
    const routerUsers = allUsers.map((user) => ({
      ...user,
      isOnline: activeUserKeys.has(`${user.username}@${user.routerId}`)
    }));
    const activeSessionsTransformed = activeSessions.map((entry) => ({
      id: String(entry[".id"] || entry.id || `${credentials.host}-session-${entry.name || entry.user || Date.now()}`),
      routerId: credentials.host,
      routerName: String(credentials.host),
      username: String(entry.name || entry.user || "").trim(),
      serviceType: entry.sessionType === "ppp" ? "pppoe" : "hotspot",
      ipAddress: String(entry.address || entry.remoteAddress || entry["remote-address"] || ""),
      macAddress: String(entry["mac-address"] || entry.macAddress || ""),
      uptime: String(entry.uptime || ""),
      rxMbps: Number(entry.rx || entry["rx-rate"] || 0) || 0,
      txMbps: Number(entry.tx || entry["tx-rate"] || 0) || 0,
      totalDownloadedMB: Number(entry["bytes-in"] || entry["bytes-received"] || 0) || 0,
      totalUploadedMB: Number(entry["bytes-out"] || entry["bytes-sent"] || 0) || 0,
      lastUpdated: (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      sessionType: entry.sessionType,
      comment: String(entry.comment || "")
    }));
    const activeUsernames = Array.from(
      new Set(
        activeSessions.map((item) => String(item.name || item.user || "").trim()).filter((name) => name.length > 0)
      )
    );
    return {
      identity: String(identity.identity || "Unknown MikroTik"),
      boardName: String(resource.boardName || "MikroTik RouterBOARD"),
      version: String(resource.version || "unknown"),
      uptime: String(resource.uptime || "unknown"),
      cpuLoad: String(resource.cpuLoad ?? "0%"),
      activeMemory: resource.activeMemory ? String(resource.activeMemory) : void 0,
      freeMemory: resource.freeMemory ? String(resource.freeMemory) : void 0,
      pppActiveCount: pppActive.length,
      hotspotActiveCount: hotspotActive.length,
      activeSessionCount: activeSessionsTransformed.length,
      activeUsers: activeUsernames.length,
      activeUsernames,
      routerUsers,
      activeSessions: activeSessionsTransformed,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  } finally {
    api.close();
  }
}

// server.ts
var app = (0, import_express.default)();
var PORT = Number(process.env.PORT || 3e3);
var HOST = process.env.HOST || "0.0.0.0";
app.use(import_express.default.json({ limit: "20mb" }));
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "AK Online - MikroTik Router & Expiry Management API",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    hotline: "+8801811111711"
  });
});
var handleRouterHealthRequest = async (req, res) => {
  try {
    const details = await testMikroTikConnection(req.body);
    return res.json({ success: true, isConnected: true, details });
  } catch (error) {
    return res.status(500).json({
      success: false,
      isConnected: false,
      message: error?.message || "MikroTik connection failed. Check API credentials and network reachability."
    });
  }
};
app.post(["/api/mikrotik/test-connection", "/api/mikrotik/test_connection", "/api/mikrotik/router-health"], handleRouterHealthRequest);
app.post(["/api/mikrotik/router-status", "/api/mikrotik/poll"], async (req, res) => {
  try {
    const details = await pollMikroTikRouterStatus(req.body);
    return res.json({ success: true, details });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to poll router status from MikroTik."
    });
  }
});
app.post(["/api/mikrotik/sync-user", "/api/mikrotik/sync_users"], async (req, res) => {
  try {
    const result = await syncMikroTikUser(req.body);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to sync MikroTik user. Check credentials, router access, and username presence."
    });
  }
});
app.post("/api/mikrotik/bandwidth", async (req, res) => {
  try {
    const result = await getMikroTikBandwidth(req.body);
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch bandwidth data from MikroTik."
    });
  }
});
app.get("/api/mikrotik/bandwidth/:username", async (req, res) => {
  const username = String(req.params.username || "").trim();
  if (!username) {
    return res.status(400).json({ success: false, message: "Username is required" });
  }
  try {
    const body = { ...req.query, username, targetUsername: username, ip: req.query.ip, port: req.query.port, apiUsername: req.query.username, apiPassword: req.query.password };
    const result = await getMikroTikBandwidth(body);
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch bandwidth data from MikroTik."
    });
  }
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, HOST, () => {
    console.log(`\u{1F680} AK Online ISP Server running on http://${HOST}:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
