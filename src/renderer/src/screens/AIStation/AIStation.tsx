import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../../components/useI18n";
import {
  RefreshCw,
  Cpu,
  Image,
  Mic,
  Video,
  Bot,
  Layers,
  Play,
  Square,
  RotateCw,
  FileText,
  Wifi,
  WifiOff,
  Settings2,
  ExternalLink,
} from "lucide-react";

type TabView = "services" | "status";

interface ServiceState {
  id: string;
  name: string;
  status: "running" | "stopped" | "unknown";
  port?: number;
  description: string;
}

type ServiceAction = "start" | "stop" | "restart";

function getServiceIcon(id: string): React.JSX.Element {
  const style = { width: 18, height: 18 };
  if (id === "comfyui") return <Image style={style} />;
  if (id === "facefusion") return <Layers style={style} />;
  if (id === "gptsovits" || id === "gpt-sovits" || id === "f5tts" || id === "meeting") return <Mic style={style} />;
  if (id === "moneyprinter" || id === "ted_scroll" || id === "ted_landscape") return <Video style={style} />;
  if (id === "srt_subtitle") return <FileText style={style} />;
  if (id === "ollama") return <Bot style={style} />;
  return <Cpu style={style} />;
}

function buildServiceUrl(baseUrl: string, port: number): string {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.hostname}:${port}`;
  } catch {
    return `http://100.109.139.92:${port}`;
  }
}

function ServiceCard({
  service,
  onControl,
  baseUrl,
}: {
  service: ServiceState;
  onControl: (id: string, action: ServiceAction) => Promise<void>;
  baseUrl: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [controlling, setControlling] = useState(false);

  const handleControl = useCallback(
    async (action: ServiceAction) => {
      setControlling(true);
      try {
        await onControl(service.id, action);
      } finally {
        setControlling(false);
      }
    },
    [onControl, service.id],
  );

  const handleToggleLogs = useCallback(async () => {
    if (logsOpen) { setLogsOpen(false); return; }
    setLoadingLogs(true);
    try {
      const result = await window.hermesAPI.aiStationGetLogs(service.id);
      setLogs(result);
      setLogsOpen(true);
    } finally {
      setLoadingLogs(false);
    }
  }, [logsOpen, service.id]);

  const badgeClass =
    service.status === "running" ? "running" :
    service.status === "stopped" ? "stopped" : "unknown";

  const statusLabel =
    service.status === "running" ? t("aistation.running") :
    service.status === "stopped" ? t("aistation.stopped") : t("aistation.unknown");

  return (
    <div className={`aistation-card${service.status === "running" ? " running" : ""}`}>
      <div className="aistation-card-header">
        <div className="aistation-card-icon">
          {getServiceIcon(service.id)}
        </div>
        <div className="aistation-card-meta">
          <div className="aistation-card-name">{service.name}</div>
          {service.port != null && (
            <div className="aistation-card-port">:{service.port}</div>
          )}
        </div>
        <span className={`aistation-badge ${badgeClass}`}>
          <span className="aistation-badge-dot" />
          {statusLabel}
        </span>
      </div>

      <div className="aistation-card-body">
        <p className="aistation-card-desc">{service.description}</p>
      </div>

      <div className="aistation-card-footer">
        {service.status !== "running" ? (
          <button
            className="btn btn-sm"
            style={{ background: "var(--success)", color: "#fff", border: "none" }}
            disabled={controlling}
            onClick={() => handleControl("start")}
          >
            <Play size={11} />
            {t("aistation.start")}
          </button>
        ) : (
          <button
            className="btn btn-danger btn-sm"
            disabled={controlling}
            onClick={() => handleControl("stop")}
          >
            <Square size={11} />
            {t("aistation.stop")}
          </button>
        )}
        <button
          className="btn btn-secondary btn-sm"
          disabled={controlling}
          onClick={() => handleControl("restart")}
        >
          <RotateCw size={11} />
          {t("aistation.restart")}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          style={{ marginLeft: "auto" }}
          disabled={loadingLogs}
          onClick={handleToggleLogs}
        >
          <FileText size={11} />
          {logsOpen ? t("aistation.hideLogs") : t("aistation.viewLogs")}
        </button>
        {service.port != null && (
          <button
            className="btn btn-secondary btn-sm"
            title={buildServiceUrl(baseUrl, service.port)}
            onClick={() => window.hermesAPI.openExternal(buildServiceUrl(baseUrl, service.port!))}
          >
            <ExternalLink size={11} />
          </button>
        )}
      </div>

      {logsOpen && (
        <pre className="aistation-card-logs">
          {logs || "(empty)"}
        </pre>
      )}
    </div>
  );
}

function ServicesTab(): React.JSX.Element {
  const { t } = useI18n();
  const [services, setServices] = useState<ServiceState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("http://100.109.139.92:8080");

  useEffect(() => {
    window.hermesAPI.aiStationGetConfig().then((cfg) => {
      if (cfg.url) setBaseUrl(cfg.url);
    }).catch(() => {});
  }, []);

  const loadServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.hermesAPI.aiStationListServices();
      setServices(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadServices(); }, [loadServices]);

  const handleControl = useCallback(
    async (serviceId: string, action: "start" | "stop" | "restart") => {
      // Optimistically mark the service as transitioning so the card reflects activity
      setServices((prev) =>
        prev.map((s) => s.id === serviceId ? { ...s, status: "unknown" as const } : s),
      );
      const result = await window.hermesAPI.aiStationControl(serviceId, action);
      if (!result.success) {
        setError(result.error ?? t("aistation.serviceFailed"));
        await loadServices();
        return;
      }
      // Give the service 1.2 s to start / stop before querying status (matches original)
      setTimeout(() => loadServices(), 1200);
    },
    [loadServices, t],
  );

  return (
    <div className="aistation-tab-content">
      <div className="aistation-services-toolbar">
        {error ? (
          <span style={{ fontSize: 12, color: "var(--error)" }}>{error}</span>
        ) : (
          <span className="aistation-services-count">
            {services.length > 0 ? `${services.length} services` : ""}
          </span>
        )}
        <button className="btn btn-secondary btn-sm" onClick={loadServices} disabled={loading}>
          <RefreshCw size={13} style={loading ? { animation: "spin 0.8s linear infinite" } : {}} />
          {t("aistation.refresh")}
        </button>
      </div>

      {loading && services.length === 0 ? (
        <div className="aistation-loading">
          <div className="loading-spinner" />
          <span>{t("aistation.loadingServices")}</span>
        </div>
      ) : services.length === 0 ? (
        <div className="aistation-empty">
          <Cpu size={28} style={{ opacity: 0.25 }} />
          <span>{t("aistation.noServices")}</span>
        </div>
      ) : (
        <div className="aistation-services-scroll">
          <div className="aistation-grid">
            {services.map((svc) => (
              <ServiceCard key={svc.id} service={svc} onControl={handleControl} baseUrl={baseUrl} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusTab(): React.JSX.Element {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "connected" | "disconnected">("idle");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.hermesAPI.aiStationGetConfig().then((cfg) => setUrl(cfg.url));
  }, []);

  const handleTest = useCallback(async () => {
    setConnectionState("connecting");
    try {
      const ok = await window.hermesAPI.aiStationTestConnection(url);
      setConnectionState(ok ? "connected" : "disconnected");
    } catch {
      setConnectionState("disconnected");
    }
  }, [url]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await window.hermesAPI.aiStationSetConfig(url);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [url]);

  return (
    <div className="aistation-tab-content">
      <div className="aistation-status-body">
        <div className="aistation-settings-block">
          <div className="aistation-settings-intro">
            <h3>{t("aistation.settingsTitle")}</h3>
            <p>Configure the 9Router LLM API endpoint (default: http://localhost:20128/v1)</p>
          </div>

          <div>
            <div className="aistation-field-label">{t("aistation.connectionUrl")}</div>
            <input
              type="text"
              className="input"
              value={url}
              placeholder="http://localhost:20128/v1"
              onChange={(e) => { setUrl(e.target.value); setConnectionState("idle"); }}
            />
          </div>

          <div className="aistation-actions-row">
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleTest}
              disabled={connectionState === "connecting" || !url}
            >
              <Wifi size={13} />
              {connectionState === "connecting" ? t("aistation.connecting") : t("aistation.testConnection")}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={saving || !url}
            >
              {saved ? "✓ Saved" : t("aistation.save")}
            </button>
          </div>

          {(connectionState === "connected" || connectionState === "disconnected") && (
            <div className={`aistation-conn-result ${connectionState === "connected" ? "success" : "error"}`}>
              {connectionState === "connected"
                ? <><Wifi size={14} /> {t("aistation.connected")}</>
                : <><WifiOff size={14} /> {t("aistation.disconnected")}</>
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AIStation(): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabView>("services");
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    window.hermesAPI.aiStationGetConfig().then(async (cfg) => {
      if (!cfg.url) return;
      const ok = await window.hermesAPI.aiStationTestConnection(cfg.url);
      setConnected(ok);
    });
  }, []);

  const tabItems: Array<{ id: TabView; label: string; Icon: typeof Cpu }> = [
    { id: "services", label: t("aistation.tabServices"), Icon: Cpu },
    { id: "status", label: t("aistation.tabStatus"), Icon: Settings2 },
  ];

  return (
    <div className="aistation-container">
      {/* Header */}
      <div className="aistation-header">
        <div className="aistation-header-left">
          <div className="aistation-icon-wrap">
            <Cpu size={17} />
          </div>
          <div className="aistation-header-text">
            <h2>{t("aistation.title")}</h2>
            <p>AI Service Manager</p>
          </div>
        </div>
        {connected !== null && (
          <span className={`aistation-status-pill ${connected ? "connected" : "disconnected"}`}>
            <span className="aistation-status-dot" />
            {connected ? t("aistation.connected") : t("aistation.disconnected")}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="aistation-tabbar">
        {tabItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`aistation-tab${tab === id ? " active" : ""}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "services" && <ServicesTab />}
      {tab === "status" && <StatusTab />}
    </div>
  );
}
