import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Cable,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Cloud,
  Download,
  Eye,
  FileText,
  Gauge,
  Globe2,
  KeyRound,
  Languages,
  ListChecks,
  Loader2,
  LockKeyhole,
  Network,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  Route,
  Save,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Upload,
  UploadCloud,
  Volume2,
  VolumeX,
  Wifi,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import { api } from './api.js';
import { selectAurelkaMeowFile } from './aurelkaAudio.js';
import { createTranslator, languages } from './i18n.js';
import { buildGoogleYoutubeGeminiDualWanRules, googleYoutubeGeminiCidrs } from './dualWanRuleTemplates.js';
import DualWanServiceRouting from './DualWanServiceRouting.jsx';
import RouterSetupWizard from './RouterSetupWizard.jsx';
import { applyVpnProfile, vpnProfiles } from './vpnProfiles.js';
import {
  buildOpenVpnProfile,
  defaultOpenVpnTemplate,
  openVpnDnsPresets,
  readOpenVpnProfileDefaults,
} from './openVpnProfileEditor.js';
import {
  resolveDualWanPatch,
  resolveSmartWanPatch,
  resolveVpnPatch,
  smartWanConflictMessages,
  syncConfigWithDetectedWans,
  vpnConflictMessages,
} from './configConflicts.js';

const defaultConfigForm = {
  enabled: false,
  activePreset: '',
  routingMode: 'manual_rules',
  orchestrationEnabled: false,
  orchestrationMode: 'observe_only',
  autoDiscoverWans: true,
  healthProbeStrategy: 'per_wan_public_ipv4',
  healthProbePolicy: 'majority',
  failoverAction: 'runtime_policy_override',
  restoreAction: 'restore_dualwan_balance',
  suspendAsusRulesOnFailover: true,
  restoreAsusRulesOnRecovery: true,
  conntrackOnSwitch: 'failed_wan',
  rememberedDualWanPreset: '',
  primaryWan: 'wan0',
  failoverWan: 'wan1',
  manageMainDefault: false,
  wan0Label: '',
  wan1Label: '',
  wan0Ifname: '',
  wan1Ifname: '',
  wan0Gateway: '',
  wan1Gateway: '',
  wan0Table: '',
  wan1Table: '',
  serviceRules: '',
  domainRulesEnabled: false,
  domainRules: '',
  hostRules: '',
  watchdogEnabled: false,
  watchdogTargets: '',
  watchdogInterval: '1',
  watchdogFailCount: '2',
  watchdogRecoverCount: '3',
  watchdogServiceEnabled: true,
  watchdogPartialFailoverEnabled: true,
  watchdogServiceTargets: [
    'https://connectivitycheck.gstatic.com/generate_204|204',
    'https://www.cloudflare.com/cdn-cgi/trace|200',
    'https://1.1.1.1/cdn-cgi/trace|200',
  ].join('\n'),
  watchdogServiceInterval: '5',
  watchdogServiceTimeout: '2',
  vpnManagementEnabled: false,
  vpnInterface: 'tun21',
  vpnSubnet: '10.8.0.0/24',
  vpnAdditionalProfiles: '',
  vpnLanSubnet: '192.168.1.0/24',
  vpnPolicyMode: 'prefer_wan_with_failover',
  vpnPreferredWan: 'wan1',
  vpnAllowRouter: true,
  vpnAllowLan: true,
  vpnAllowInternet: true,
  vpnNatEnabled: true,
  dmzEnabled: false,
  dmzTargetIp: '',
  dmzPreferredWan: 'wan1',
  dmzFailoverMode: 'follow_failover',
  runtimeDir: '/tmp',
  logEnabled: true,
  logMaxLines: '300',
  testMode: false,
};

const defaultDualWanForm = {
  enabled: true,
  primary: 'wan',
  secondary: 'lan',
  mode: 'lb',
  ratioPrimary: '9',
  ratioSecondary: '1',
  routingEnabled: true,
  lanPort: '',
  rules: [],
  rulesSource: 'empty',
  rawRuleList: '',
};

const defaultDmzPolicy = {
  enabled: false,
  targetIp: '',
  preferredWan: 'wan1',
  failoverMode: 'follow_failover',
  managed: false,
  native: { enabled: false, targetIp: '' },
  runtime: {
    wan: '',
    ifname: '',
    status: 'inactive',
    natChainActive: false,
    forwardChainActive: false,
    returnRuleActive: false,
    priority: '95',
  },
};

const tabs = [
  { id: 'dashboard', icon: Gauge, label: 'dashboard', level: 0 },
  { id: 'networkmap', icon: Workflow, label: 'networkMap', level: 0 },
  { id: 'setup', icon: ListChecks, label: 'setup', level: 1 },
  { id: 'smartwan', icon: Network, label: 'smartWan', level: 1 },
  { id: 'dualwan', icon: Cable, label: 'dualWan', level: 2 },
  { id: 'dmz', icon: ShieldCheck, label: 'dmz', level: 1 },
  { id: 'vpn', icon: LockKeyhole, label: 'vpn', level: 1 },
  { id: 'backup', icon: Save, label: 'backup', level: 1 },
  { id: 'ssh', icon: KeyRound, label: 'sshKey', level: 2 },
  { id: 'scripts', icon: UploadCloud, label: 'scripts', level: 2 },
  { id: 'logs', icon: ScrollText, label: 'logs', level: 0 },
  { id: 'routes', icon: Route, label: 'routes', level: 0 },
  { id: 'tools', icon: Wrench, label: 'tools', level: 0 },
];

const uiModeLevels = { safe: 0, basic: 1, advanced: 2, expert: 3 };

function formatKb(kb) {
  if (!kb) return 'n/a';
  if (kb > 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(kb / 1024)} MB`;
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return 'n/a';
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function ContextHelp({ title, children, t }) {
  return (
    <details className="context-help">
      <summary aria-label={`${t('explain')}: ${title}`} title={t('explain')}>
        <CircleHelp size={16} />
      </summary>
      <div className="context-help-popover">
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </details>
  );
}

function VpnDisclosure({
  title,
  copy,
  icon: Icon,
  eyebrow,
  className = '',
  defaultOpen = false,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={`panel vpn-disclosure ${className}`.trim()}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <div>
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <h2>{title}</h2>
          {copy ? <p>{copy}</p> : null}
        </div>
        <span className="vpn-disclosure-icons" aria-hidden="true">
          {Icon ? <Icon /> : null}
          <ChevronDown className="vpn-disclosure-chevron" />
        </span>
      </summary>
      <div className="vpn-disclosure-body">
        {children}
      </div>
    </details>
  );
}

function SectionTitle({ children, helpTitle, helpText, t }) {
  return (
    <div className="section-title">
      <h3>{children}</h3>
      {helpText ? <ContextHelp title={helpTitle || children} t={t}>{helpText}</ContextHelp> : null}
    </div>
  );
}

function ConflictNotice({ messages, t }) {
  if (!messages?.length) return null;
  return (
    <div className="conflict-notice" role="status">
      <AlertTriangle size={19} />
      <div>
        <strong>{t('conflictNoticeTitle')}</strong>
        {messages.map((message) => <p key={message}>{t(message)}</p>)}
      </div>
    </div>
  );
}

function Field({ label, children, hint, helpTitle, helpText, t }) {
  return (
    <label className="field">
      <span className="field-label">
        <span>{label}</span>
        {helpText ? <ContextHelp title={helpTitle || label} t={t}>{helpText}</ContextHelp> : null}
      </span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function TextInput(props) {
  return <input {...props} />;
}

function TextArea(props) {
  return <textarea {...props} />;
}

function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'is-on' : ''}`}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      aria-pressed={checked}
      disabled={disabled}
    >
      <span />
      {label}
    </button>
  );
}

function ActionButton({ children, icon: Icon, busy, variant = 'primary', ...props }) {
  return (
    <button className={`action ${variant}`} disabled={busy || props.disabled} {...props}>
      {busy ? <Loader2 className="spin" size={16} /> : Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}

function CodeBlock({ children, compact = false }) {
  return <pre className={`code-block ${compact ? 'compact' : ''}`}>{children || 'n/a'}</pre>;
}

function parsePercent(value) {
  const match = String(value || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function formatUptime(raw = '') {
  if (!raw) return 'n/a';
  const compact = raw.replace(/^.* up\s+/, '').replace(/,\s+\d+\s+users?.*$/, '').replace(/,\s+load average.*$/, '');
  return compact || raw;
}

function connectionLabel(state, t) {
  if (state === 'connected') return t('online');
  if (state === 'offline') return t('offline');
  return t('unknown');
}

function StatusDot({ state }) {
  return <span className={`status-dot ${state === 'connected' ? 'online' : state === 'offline' ? 'offline' : ''}`} />;
}

function App() {
  const [language, setLanguage] = useState(() => localStorage.getItem('smartwan-language') || 'en');
  const t = useMemo(() => createTranslator(language), [language]);
  const [uiMode, setUiMode] = useState(() => localStorage.getItem('smartwan-ui-mode') || 'basic');
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('smartwan-map-sound') === '1');
  const ambientAudioRef = useRef(null);
  const configHydratedRef = useRef(false);
  const dualWanHydratedRef = useRef(false);
  const routerRefreshRef = useRef(null);
  const [auth, setAuth] = useState({ checked: false, configured: false, authenticated: false, username: '', resetCommand: '' });
  const [loginForm, setLoginForm] = useState({ username: 'admin', password: '' });
  const [publicMapOpen, setPublicMapOpen] = useState(false);
  const [publicMapState, setPublicMapState] = useState(null);
  const [publicMapBusy, setPublicMapBusy] = useState(false);
  const [publicMapError, setPublicMapError] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [settings, setSettings] = useState(null);
  const [routerState, setRouterState] = useState(null);
  const [connectionState, setConnectionState] = useState('unknown');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [configForm, setConfigForm] = useState(defaultConfigForm);
  const [presets, setPresets] = useState({ presets: [], activePreset: '' });
  const [presetName, setPresetName] = useState('');
  const [dualWanState, setDualWanState] = useState(null);
  const [dualWanForm, setDualWanForm] = useState(defaultDualWanForm);
  const [dualWanGroupsRefreshToken, setDualWanGroupsRefreshToken] = useState(0);
  const [dualWanPresets, setDualWanPresets] = useState({ presets: [], activePreset: '' });
  const [dualWanPresetName, setDualWanPresetName] = useState('');
  const [dmzPolicy, setDmzPolicy] = useState(defaultDmzPolicy);
  const [panelKey, setPanelKey] = useState(null);
  const [hostKeys, setHostKeys] = useState([]);
  const [keyOptions, setKeyOptions] = useState({ comment: 'smartwan-manager', passphrase: '', overwrite: false });
  const [preserveConfig, setPreserveConfig] = useState(true);
  const [backupFile, setBackupFile] = useState(null);
  const [backupRestore, setBackupRestore] = useState({
    restoreRouter: false,
    restoreSmartwan: true,
    restartWan: false,
    installHooks: true,
    confirm: '',
  });

  useEffect(() => {
    localStorage.setItem('smartwan-language', language);
  }, [language]);

  useEffect(() => {
    let cancelled = false;
    void api.get('/api/public/ui-language')
      .then((result) => {
        if (!cancelled && ['pl', 'en'].includes(result.language)) {
          setLanguage(result.language);
        }
      })
      .catch(() => undefined);

    const events = new EventSource('/api/public/ui-language-events');
    const receiveLanguage = (event) => {
      try {
        const result = JSON.parse(event.data);
        if (['pl', 'en'].includes(result.language)) setLanguage(result.language);
      } catch {
        // Ignore malformed events; EventSource reconnects automatically.
      }
    };
    events.addEventListener('language', receiveLanguage);
    return () => {
      cancelled = true;
      events.removeEventListener('language', receiveLanguage);
      events.close();
    };
  }, []);

  const changeGlobalLanguage = (nextLanguage) => {
    if (!['pl', 'en'].includes(nextLanguage)) return;
    setLanguage(nextLanguage);
    void api.post('/api/public/ui-language', { language: nextLanguage })
      .catch(() => undefined);
  };

  useEffect(() => {
    localStorage.setItem('smartwan-ui-mode', uiMode);
    const activeLevel = tabs.find((tab) => tab.id === activeTab)?.level ?? 0;
    if (activeLevel > uiModeLevels[uiMode]) setActiveTab('dashboard');
  }, [uiMode, activeTab]);

  useEffect(() => {
    localStorage.setItem('smartwan-map-sound', soundEnabled ? '1' : '0');
    if (!soundEnabled || activeTab !== 'networkmap') {
      ambientAudioRef.current?.pause();
      ambientAudioRef.current = null;
      return undefined;
    }
    const audio = new Audio('/audio/network-ambient.wav');
    audio.loop = true;
    audio.volume = 0.08;
    ambientAudioRef.current = audio;
    void audio.play().catch(() => undefined);
    return () => {
      audio.pause();
      ambientAudioRef.current = null;
    };
  }, [soundEnabled, activeTab]);

  useEffect(() => {
    void loadAuthStatus();
  }, []);

  useEffect(() => {
    if (!auth.checked || auth.authenticated) return undefined;
    let cancelled = false;
    let timer = 0;
    const refresh = async () => {
      try {
        const data = await api.get('/api/public/network-map');
        if (!cancelled) {
          setPublicMapState(data);
          setPublicMapError('');
        }
      } catch (_error) {
        if (!cancelled) setPublicMapError(t('publicStatusUnavailable'));
      } finally {
        if (!cancelled) {
          setPublicMapBusy(false);
          timer = window.setTimeout(refresh, 10_000);
        }
      }
    };
    setPublicMapBusy(true);
    void refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [auth.checked, auth.authenticated, t]);

  useEffect(() => {
    const handleAuthRequired = () => {
      setAuth((current) => ({ ...current, checked: true, authenticated: false }));
      setBusy('');
      setNotice(t('sessionExpired'));
    };
    window.addEventListener('smartwan:auth-required', handleAuthRequired);
    return () => window.removeEventListener('smartwan:auth-required', handleAuthRequired);
  }, [t]);

  useEffect(() => {
    if (auth.authenticated) {
      void loadInitial();
    }
  }, [auth.authenticated]);

  useEffect(() => {
    if (!auth.authenticated || !settings) return;

    void refreshRouterState({ silent: true, preserveEditors: true });
    if (activeTab === 'dualwan' || activeTab === 'smartwan') {
      void loadDualWan(false, { preserveEditor: true });
      void loadDualWanPresets(false);
    }
    if (activeTab === 'dmz') {
      void loadDmz(false);
    }
  }, [activeTab, auth.authenticated, settings]);

  useEffect(() => {
    if (!auth.authenticated || !settings || connectionState !== 'offline') return undefined;
    const timer = window.setInterval(() => {
      void refreshRouterState({ silent: true, preserveEditors: true, retryAttempts: 2 });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [auth.authenticated, settings, connectionState]);

  async function run(label, action) {
    setBusy(label);
    setNotice('');
    try {
      const result = await action();
      setNotice(t('success'));
      return result;
    } catch (error) {
      setNotice(`${t('failed')}: ${error.message}`);
      throw error;
    } finally {
      setBusy('');
    }
  }

  function mutationAllowed() {
    if (uiMode !== 'safe') return true;
    setNotice(t('safeModeBlocked'));
    return false;
  }

  function showConflicts(messages) {
    if (!messages?.length) return;
    setNotice(`${t('conflictAdjusted')}: ${messages.map((message) => t(message)).join(' ')}`);
  }

  function playUiSound() {
    if (!soundEnabled) return;
    const audio = new Audio('/audio/network-select.wav');
    audio.volume = 0.18;
    void audio.play().catch(() => undefined);
  }

  function navigateTo(tabId) {
    const required = tabs.find((tab) => tab.id === tabId)?.level ?? 0;
    if (required > uiModeLevels[uiMode]) {
      setNotice(t('modeUpgradeRequired'));
      return;
    }
    playUiSound();
    setActiveTab(tabId);
  }

  async function loadAuthStatus() {
    setBusy('auth-status');
    try {
      const status = await api.get('/api/auth/status');
      setAuth({ checked: true, ...status });
      setLoginForm((current) => ({ ...current, username: status.username || 'admin' }));
    } catch (error) {
      setNotice(`${t('failed')}: ${error.message}`);
      setAuth((current) => ({ ...current, checked: true }));
    } finally {
      setBusy('');
    }
  }

  async function loginPanel() {
    setBusy('login');
    setNotice('');
    try {
      const result = await api.post('/api/auth/login', loginForm);
      setAuth({ checked: true, configured: true, ...result });
      setLoginForm((current) => ({ ...current, password: '' }));
    } catch (error) {
      setNotice(`${t('failed')}: ${error.message}`);
    } finally {
      setBusy('');
    }
  }

  async function logoutPanel() {
    await api.post('/api/auth/logout').catch(() => undefined);
    setAuth((current) => ({ ...current, authenticated: false }));
    setSettings(null);
    setRouterState(null);
    setConnectionState('unknown');
  }

  async function togglePublicMap() {
    if (publicMapOpen) {
      setPublicMapOpen(false);
      return;
    }
    setPublicMapOpen(true);
    if (!publicMapState) {
      setPublicMapBusy(true);
      setPublicMapError('');
      try {
        setPublicMapState(await api.get('/api/public/network-map'));
      } catch (_error) {
        setPublicMapError(t('publicStatusUnavailable'));
      } finally {
        setPublicMapBusy(false);
      }
    }
  }

  async function loadInitial() {
    setBusy('initial');
    setNotice('');
    try {
      const [settingsData, keyData] = await Promise.all([
        api.get('/api/settings'),
        api.get('/api/ssh/panel-key'),
      ]);
      setSettings(settingsData);
      setPanelKey(keyData);
      if (settingsData?.ui?.language) {
        setLanguage(settingsData.ui.language);
      }
    } catch (error) {
      setNotice(`${t('failed')}: ${error.message}`);
    } finally {
      setBusy('');
    }
  }

  function updateRouterSettings(patch) {
    setSettings((current) => ({
      ...current,
      router: {
        ...(current?.router || {}),
        ...patch,
      },
    }));
  }

  async function saveConnectionSettings() {
    await run('save-settings', async () => {
      const saved = await api.post('/api/settings', {
        router: settings.router,
        ui: { language },
      });
      setSettings(saved);
      return saved;
    });
  }

  async function updateFirmwareCompatibilityExpanded(expanded) {
    const previous = settings?.ui?.firmwareCompatibilityExpanded === true;
    setSettings((current) => ({
      ...current,
      ui: {
        ...(current?.ui || {}),
        firmwareCompatibilityExpanded: expanded,
      },
    }));
    try {
      const saved = await api.post('/api/settings', {
        ui: { firmwareCompatibilityExpanded: expanded },
      });
      setSettings(saved);
    } catch (error) {
      setSettings((current) => ({
        ...current,
        ui: {
          ...(current?.ui || {}),
          firmwareCompatibilityExpanded: previous,
        },
      }));
      setNotice(`${t('failed')}: ${error.message}`);
    }
  }

  async function testSsh() {
    await saveConnectionSettings();
    const result = await run('test-ssh', () => api.post('/api/ssh/test'));
    setConnectionState(result.ok ? 'connected' : 'offline');
  }

  async function fetchRouterStateWithRetry(attempts = 3) {
    if (routerRefreshRef.current) return routerRefreshRef.current;
    const request = (async () => {
      let lastError;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await api.get('/api/router/state');
        } catch (error) {
          lastError = error;
          if (attempt + 1 < attempts) {
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
          }
        }
      }
      throw lastError;
    })();
    routerRefreshRef.current = request;
    try {
      return await request;
    } finally {
      routerRefreshRef.current = null;
    }
  }

  async function refreshRouterState(options = {}) {
    if (options.silent) {
      try {
        const state = await fetchRouterStateWithRetry(options.retryAttempts || 3);
        setRouterState(state);
        setConnectionState(state.ok ? 'connected' : 'offline');
        if (state.config?.form && (!options.preserveEditors || !configHydratedRef.current)) {
          setConfigForm(syncConfigWithDetectedWans(
            { ...defaultConfigForm, ...state.config.form },
            state.wanStatus,
          ));
          configHydratedRef.current = true;
        }
        await loadPresets(false);
      } catch (_error) {
        setConnectionState('offline');
      }
      return;
    }

    await saveConnectionSettings();
    const state = await run('refresh-router', () => fetchRouterStateWithRetry(3));
    setRouterState(state);
    setConnectionState(state.ok ? 'connected' : 'offline');
    if (state.config?.form) {
      setConfigForm(syncConfigWithDetectedWans(
        { ...defaultConfigForm, ...state.config.form },
        state.wanStatus,
      ));
      configHydratedRef.current = true;
    }
    await Promise.all([
      loadPresets(false),
      loadDualWan(false),
      loadDualWanPresets(false),
    ]);
  }

  async function readRouterConfig() {
    const config = await run('read-config', () => api.get('/api/router/config'));
    setConfigForm({ ...defaultConfigForm, ...config.form });
    configHydratedRef.current = true;
  }

  async function applyConfig() {
    if (!mutationAllowed()) return;
    const resolved = resolveSmartWanPatch(configForm, {});
    const payload = { ...resolved.config, domainRulesEnabled: false };
    if (configForm.domainRulesEnabled || resolved.messages.length) {
      setConfigForm(payload);
      showConflicts(resolved.messages);
    }
    await run('apply-config', () => api.post('/api/router/config/apply', payload));
    await refreshRouterState();
  }

  async function loadPresets(showNotice = true) {
    const action = async () => {
      const data = await api.get('/api/router/presets');
      setPresets(data);
      return data;
    };
    if (showNotice) {
      await run('presets', action);
    } else {
      await action().catch(() => undefined);
    }
  }

  async function createPreset() {
    if (!mutationAllowed()) return;
    await run('create-preset', () => api.post('/api/router/presets', { name: presetName }));
    setPresetName('');
    await loadPresets(false);
  }

  async function loadSmartWanPresetToEditor(name) {
    const preset = await run('load-preset-editor', () => api.get(`/api/router/presets/${encodeURIComponent(name)}`));
    if (preset?.form) {
      setConfigForm({ ...defaultConfigForm, ...preset.form, activePreset: preset.name });
    }
  }

  async function activatePreset(name) {
    if (!mutationAllowed()) return;
    await run('activate-preset', () => api.post(`/api/router/presets/${encodeURIComponent(name)}/activate`));
    await refreshRouterState();
    await loadPresets(false);
  }

  async function deletePreset(name) {
    if (!mutationAllowed()) return;
    await run('delete-preset', () => api.del(`/api/router/presets/${encodeURIComponent(name)}`));
    await loadPresets(false);
  }

  async function loadDualWan(showNotice = true, options = {}) {
    const action = async () => {
      const data = await api.get('/api/router/dualwan');
      setDualWanState(data);
      if (!options.preserveEditor || !dualWanHydratedRef.current) {
        setDualWanForm({ ...defaultDualWanForm, ...(data.form || {}), rules: data.form?.rules || [] });
        dualWanHydratedRef.current = true;
      }
      if (showNotice || options.refreshGroups) {
        setDualWanGroupsRefreshToken((current) => current + 1);
      }
      return data;
    };
    if (showNotice) {
      await run('dualwan-load', action);
    } else {
      await action().catch(() => undefined);
    }
  }

  async function applyDualWan() {
    if (!mutationAllowed()) return;
    if (routerState?.status?.failover_override_active === '1') {
      setNotice(t('conflictFailoverApplyBlocked'));
      return;
    }
    await run('dualwan-apply', () => api.post('/api/router/dualwan/apply', dualWanForm));
    await loadDualWan(false, { refreshGroups: true });
    await loadDualWanPresets(false);
  }

  async function loadDualWanPresets(showNotice = true) {
    const action = async () => {
      const data = await api.get('/api/router/dualwan/presets');
      setDualWanPresets(data);
      return data;
    };
    if (showNotice) {
      await run('dualwan-presets', action);
    } else {
      await action().catch(() => undefined);
    }
  }

  async function saveDualWanPreset() {
    if (!mutationAllowed()) return;
    await run('dualwan-save-preset', () => api.post('/api/router/dualwan/presets', {
      name: dualWanPresetName,
      config: dualWanForm,
    }));
    setDualWanPresetName('');
    await loadDualWanPresets(false);
  }

  function loadDualWanPresetToEditor(name) {
    const preset = dualWanPresets.presets?.find((item) => item.name === name);
    if (preset?.config) {
      setDualWanForm({ ...defaultDualWanForm, ...preset.config, rules: preset.config.rules || [] });
      dualWanHydratedRef.current = true;
    }
  }

  async function activateDualWanPreset(name) {
    if (!mutationAllowed()) return;
    if (routerState?.status?.failover_override_active === '1') {
      setNotice(t('conflictFailoverApplyBlocked'));
      return;
    }
    await run('dualwan-activate-preset', () => api.post(`/api/router/dualwan/presets/${encodeURIComponent(name)}/activate`));
    await loadDualWan(false);
    await loadDualWanPresets(false);
  }

  async function deleteDualWanPreset(name) {
    if (!mutationAllowed()) return;
    await run('dualwan-delete-preset', () => api.del(`/api/router/dualwan/presets/${encodeURIComponent(name)}`));
    await loadDualWanPresets(false);
  }

  async function loadDmz(showNotice = true) {
    const action = async () => {
      const data = await api.get('/api/router/dmz');
      setDmzPolicy({ ...defaultDmzPolicy, ...data, runtime: { ...defaultDmzPolicy.runtime, ...(data.runtime || {}) } });
      return data;
    };
    if (showNotice) {
      await run('dmz-load', action);
    } else {
      await action().catch(() => undefined);
    }
  }

  async function applyDmz() {
    if (!mutationAllowed()) return;
    const result = await run('dmz-apply', () => api.put('/api/router/dmz', {
      enabled: dmzPolicy.enabled,
      targetIp: dmzPolicy.targetIp,
      preferredWan: dmzPolicy.preferredWan,
      failoverMode: dmzPolicy.failoverMode,
    }));
    if (result?.policy) {
      setDmzPolicy({
        ...defaultDmzPolicy,
        ...result.policy,
        runtime: { ...defaultDmzPolicy.runtime, ...(result.policy.runtime || {}) },
      });
    }
    await refreshRouterState({ silent: true, preserveEditors: true });
  }

  async function generatePanelKey() {
    if (!mutationAllowed()) return;
    const key = await run('generate-key', () => api.post('/api/ssh/panel-key', keyOptions));
    setPanelKey(key);
    updateRouterSettings({ authMethod: 'key', privateKeyPath: key.privateKeyPath });
  }

  async function readHostKey() {
    const result = await run('host-key', () => api.post('/api/ssh/host-key'));
    setHostKeys(result.keys || []);
  }

  async function installScripts() {
    if (!mutationAllowed()) return;
    await run('install-scripts', () => api.post('/api/router/scripts/install', { preserveConfig }));
    await refreshRouterState();
  }

  function downloadJson(data, prefix) {
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `${prefix}-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportVpnPolicyFile() {
    const data = await run('vpn-export-policy', () => api.post('/api/router/vpn/export-policy', configForm));
    downloadJson(data, 'smartwan-vpn-policy');
  }

  async function createBackup(kind) {
    const backup = await run(`backup-${kind}`, () => api.post('/api/backups/create', { kind }));
    downloadJson(backup, `smartwan-${kind}-backup`);
  }

  async function readBackupUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      setBackupFile({ name: file.name, backup });
      setNotice(t('success'));
    } catch (error) {
      setNotice(`${t('failed')}: ${error.message}`);
    }
  }

  async function restoreUploadedBackup() {
    if (!mutationAllowed()) return;
    if (!backupFile?.backup) {
      setNotice(`${t('failed')}: ${t('backupNoFile')}`);
      return;
    }
    await run('backup-restore', () => api.post('/api/backups/restore', {
      backup: backupFile.backup,
      ...backupRestore,
    }));
    await refreshRouterState();
  }

  function selectVpnProfile(profileId) {
    if (!mutationAllowed()) return;
    const profile = vpnProfiles.find((item) => item.id === profileId);
    if (configForm.orchestrationEnabled && profile?.policyMode === 'force_wan') {
      setNotice(t('conflictVpnForceWan'));
      return;
    }
    const selected = applyVpnProfile(configForm, profileId);
    const resolved = resolveVpnPatch(selected, {});
    setConfigForm(resolved.config);
    showConflicts(resolved.messages);
  }

  const router = settings?.router || {};
  const files = routerState?.files || {};
  const status = routerState?.status || {};
  const identity = routerState?.identity || {};
  const routerPanelUrl = router.host ? `http://${router.host}/` : '';
  const visibleTabs = tabs.filter((tab) => tab.level <= uiModeLevels[uiMode]);

  if (!auth.checked) {
    return <div className="login-shell"><div className="panel login-panel"><Loader2 className="spin" /><strong>{t('loading')}</strong></div></div>;
  }

  if (!auth.authenticated) {
    return (
      <LoginPanel
        t={t}
        auth={auth}
        notice={notice}
        busy={busy}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        onLogin={loginPanel}
        language={language}
        setLanguage={changeGlobalLanguage}
        publicMapOpen={publicMapOpen}
        publicMapState={publicMapState}
        publicMapBusy={publicMapBusy}
        publicMapError={publicMapError}
        onTogglePublicMap={togglePublicMap}
      />
    );
  }

  return (
    <div className={`app-shell ui-mode-${uiMode}`}>
      <aside className="sidebar">
        <div className="brand">
          <Network size={28} />
          <div>
            <strong>{t('appTitle')}</strong>
          </div>
        </div>
        <div className="device-line">
          <Server size={15} />
          <span>ASUS RT-N18U</span>
        </div>
        <nav>
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => navigateTo(tab.id)}
              >
                <Icon size={18} />
                {t(tab.label)}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-connection">
          <div>
            <span>{t('connection')}</span>
            <strong className={connectionState === 'connected' ? 'ok' : ''}>
              {connectionLabel(connectionState, t)}
            </strong>
          </div>
          <p>SSH: {connectionState === 'connected' ? t('connected') : t('notChecked')}</p>
          <p>{t('host')}: {router.host || t('notConfigured')}</p>
          <p>{t('user')}: {router.username || t('notConfigured')}</p>
          <p>{t('port')}: {router.port || t('notConfigured')}</p>
          <button type="button" onClick={testSsh}>{t('testSsh')}</button>
        </div>
        <div className="sidebar-mode">
          <span>{t('interfaceMode')}</span>
          <strong>{t(`uiMode_${uiMode}`)}</strong>
          <small>{t(`uiMode_${uiMode}_copy`)}</small>
        </div>
        <div className="sidebar-note">
          <ShieldCheck size={16} />
          <span>{t('docsStoredRouter')}</span>
        </div>
        <footer className="sidebar-version">SmartWAN Manager v1.0.0</footer>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="router-status-strip">
            <strong>
              <StatusDot state={connectionState} />
              {t('routerConnection')}: <span>{connectionLabel(connectionState, t)}</span>
            </strong>
            <em>{router.host || t('noRouterConfigured')}</em>
            <em>{t('model')}: {identity.model || 'RT-N18U'}</em>
            <em>{t('firmware')}: {identity.firmware || t('unknown')}</em>
            <em>{t('uptime')}: {formatUptime(identity.uptime)}</em>
          </div>
          <div className="topbar-actions">
            {routerPanelUrl ? (
              <a className="action secondary router-panel-link" href={routerPanelUrl} target="_blank" rel="noreferrer">
                <Server size={16} />
                {t('openRouterPanel')}
              </a>
            ) : (
              <span className="action secondary router-panel-link disabled">
                <Server size={16} />
                {t('openRouterPanel')}
              </span>
            )}
            <ActionButton icon={RefreshCw} busy={busy === 'refresh-router'} onClick={() => refreshRouterState()} variant="secondary">
              {t('refreshRouterState')}
            </ActionButton>
            <button
              className="icon-button"
              type="button"
              aria-label={t('openSmartWanConfig')}
              title={t('openSmartWanConfig')}
              onClick={() => navigateTo('smartwan')}
            >
              <Settings size={17} />
            </button>
            <div className="mode-select">
              {uiMode === 'safe' ? <Eye size={16} /> : <SlidersHorizontal size={16} />}
              <select value={uiMode} onChange={(event) => setUiMode(event.target.value)} title={t('interfaceMode')}>
                <option value="safe">{t('uiMode_safe')}</option>
                <option value="basic">{t('uiMode_basic')}</option>
                <option value="advanced">{t('uiMode_advanced')}</option>
                <option value="expert">{t('uiMode_expert')}</option>
              </select>
            </div>
            <div className="language-select">
              <Languages size={16} />
              <select value={language} onChange={(event) => changeGlobalLanguage(event.target.value)}>
                {languages.map((item) => (
                  <option value={item.code} key={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              className={`icon-button ${soundEnabled ? 'is-active' : ''}`}
              type="button"
              aria-label={t('mapSound')}
              title={t('mapSound')}
              onClick={() => setSoundEnabled((current) => !current)}
            >
              {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
            <button className="icon-button" type="button" aria-label={t('logout')} title={t('logout')} onClick={logoutPanel}>
              <Power size={17} />
            </button>
          </div>
        </header>

        {notice ? <div className={`notice ${notice.includes(t('failed')) ? 'error' : ''}`}>{notice}</div> : null}

        {activeTab === 'setup' ? (
          <SetupPanel
            t={t}
            router={router}
            auth={auth}
            updateRouterSettings={updateRouterSettings}
            onSave={saveConnectionSettings}
            onTest={testSsh}
            busy={busy}
          />
        ) : null}
        {activeTab === 'dashboard' ? (
          <DashboardPanel
            t={t}
            routerState={routerState}
            files={files}
            status={status}
            routerHost={router.host || ''}
            identity={identity}
            connectionState={connectionState}
            configForm={configForm}
            firmwareCompatibilityExpanded={settings?.ui?.firmwareCompatibilityExpanded === true}
            onFirmwareCompatibilityExpandedChange={updateFirmwareCompatibilityExpanded}
            onSetup={() => navigateTo('setup')}
          />
        ) : null}
        {activeTab === 'networkmap' ? (
          <NetworkMapPanel
            t={t}
            routerState={routerState}
            configForm={configForm}
            uiMode={uiMode}
            soundEnabled={soundEnabled}
            onNavigate={navigateTo}
          />
        ) : null}
        {activeTab === 'smartwan' ? (
          <SmartWanPanel
            t={t}
            configForm={configForm}
            setConfigForm={setConfigForm}
            onRead={readRouterConfig}
            onApply={applyConfig}
            routerState={routerState}
            presets={presets}
            presetName={presetName}
            setPresetName={setPresetName}
            onLoadPresets={loadPresets}
            onCreatePreset={createPreset}
            onLoadPresetToEditor={loadSmartWanPresetToEditor}
            onActivatePreset={activatePreset}
            onDeletePreset={deletePreset}
            busy={busy}
            uiMode={uiMode}
            dualWanForm={dualWanForm}
            onConflict={showConflicts}
          />
        ) : null}
        {activeTab === 'dualwan' ? (
          <DualWanPanel
            t={t}
            language={language}
            dualWanState={dualWanState}
            groupsRefreshToken={dualWanGroupsRefreshToken}
            dualWanForm={dualWanForm}
            setDualWanForm={setDualWanForm}
            presets={dualWanPresets}
            presetName={dualWanPresetName}
            setPresetName={setDualWanPresetName}
            onLoad={loadDualWan}
            onApply={applyDualWan}
            onLoadPresets={loadDualWanPresets}
            onSavePreset={saveDualWanPreset}
            onLoadPresetToEditor={loadDualWanPresetToEditor}
            onActivatePreset={activateDualWanPreset}
            onDeletePreset={deleteDualWanPreset}
            busy={busy}
            uiMode={uiMode}
            smartWanStatus={status}
            localClients={routerState?.clients || []}
            wanStatus={routerState?.wanStatus || []}
            onConflict={showConflicts}
          />
        ) : null}
        {activeTab === 'dmz' ? (
          <DmzPanel
            t={t}
            policy={dmzPolicy}
            setPolicy={setDmzPolicy}
            routerState={routerState}
            busy={busy}
            onLoad={loadDmz}
            onApply={applyDmz}
          />
        ) : null}
        {activeTab === 'vpn' ? (
          <VpnPanel
            t={t}
            configForm={configForm}
            setConfigForm={setConfigForm}
            status={status}
            routerHost={router.host || ''}
            uiMode={uiMode}
            onSelectProfile={selectVpnProfile}
            onApply={applyConfig}
            onExportPolicy={exportVpnPolicyFile}
            busy={busy}
            onConflict={showConflicts}
            onRefresh={refreshRouterState}
          />
        ) : null}
        {activeTab === 'backup' ? (
          <BackupPanel
            t={t}
            routerState={routerState}
            backupFile={backupFile}
            backupRestore={backupRestore}
            setBackupRestore={setBackupRestore}
            onCreateBackup={createBackup}
            onUpload={readBackupUpload}
            onRestore={restoreUploadedBackup}
            busy={busy}
          />
        ) : null}
        {activeTab === 'ssh' ? (
          <SshKeyPanel
            t={t}
            panelKey={panelKey}
            keyOptions={keyOptions}
            setKeyOptions={setKeyOptions}
            onGenerate={generatePanelKey}
            onReadHostKey={readHostKey}
            hostKeys={hostKeys}
            busy={busy}
          />
        ) : null}
        {activeTab === 'scripts' ? (
          <ScriptsPanel
            t={t}
            files={files}
            preserveConfig={preserveConfig}
            setPreserveConfig={setPreserveConfig}
            onInstall={installScripts}
            routerState={routerState}
            onRefresh={() => refreshRouterState()}
            busy={busy}
          />
        ) : null}
        {activeTab === 'logs' ? <LogsPanel t={t} routerState={routerState} /> : null}
        {activeTab === 'routes' ? <RoutesPanel t={t} routerState={routerState} onNavigate={navigateTo} /> : null}
        {activeTab === 'tools' ? <ToolsPanel t={t} routerState={routerState} onNavigate={navigateTo} /> : null}
      </main>
    </div>
  );
}

function MapNode({
  icon: Icon,
  title,
  subtitle,
  meta,
  detail,
  tone = 'cyan',
  active = true,
  onClick,
}) {
  const accessibleSummary = [title, subtitle, meta, detail].filter(Boolean).join(' - ');
  return (
    <button
      type="button"
      className={`network-node ${tone} ${active ? 'is-active' : 'is-offline'} ${onClick ? '' : 'read-only'}`}
      onClick={onClick}
      disabled={!onClick}
      title={accessibleSummary}
    >
      <span className="network-node-icon"><Icon size={24} /></span>
      <span className="network-node-copy">
        <strong>{title}</strong>
        <small>{subtitle || 'n/a'}</small>
        {meta ? <em>{meta}</em> : null}
        {detail ? <span className="network-node-detail">{detail}</span> : null}
      </span>
      {onClick ? <ArrowRight size={16} className="network-node-open" /> : <Eye size={16} className="network-node-open" />}
    </button>
  );
}

function NetworkMapPanel({ t, routerState, configForm, uiMode, soundEnabled, onNavigate, readOnly = false }) {
  const wanStatus = routerState?.wanStatus || [];
  const dualWan = routerState?.dualWan || {};
  const status = routerState?.status || {};
  const network = routerState?.network || {};
  const clients = routerState?.clients || [];
  const viewer = routerState?.viewer || {};
  const wan0 = wanStatus.find((wan) => wan.id === 'wan0') || {};
  const wan1 = wanStatus.find((wan) => wan.id === 'wan1') || {};
  const isOnline = (wan) => ['ok', 'reachable'].includes(wan.internetStatus);
  const failoverActive = status.failover_override_active === '1';
  const smartWanActive = status.enabled === '1';
  const vpnActive = status.vpn_interface_up === '1';
  const nodeAction = (tabId) => (readOnly ? undefined : () => onNavigate?.(tabId));
  const activeClients = clients.filter((client) => client.active !== false);
  const wifiClients = activeClients.filter((client) => client.connectionType === 'wifi');
  const ethernetClients = activeClients.filter((client) => client.connectionType === 'ethernet');
  const unknownClients = activeClients.filter((client) => !['wifi', 'ethernet'].includes(client.connectionType));
  const wifiClientCount = readOnly ? Number(network.wifi_client_count || 0) : wifiClients.length;
  const ethernetClientCount = readOnly ? Number(network.ethernet_client_count || 0) : ethernetClients.length;
  const unknownClientCount = readOnly ? Number(network.unknown_client_count || 0) : unknownClients.length;
  const dnsServers = (value) => {
    const values = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
    return [...new Set(values.map((server) => server.trim()).filter(Boolean))];
  };
  const formatWanDns = (wan) => {
    const servers = dnsServers(wan.dnsServers);
    if (!servers.length) return t('unavailable');
    return servers
      .slice(0, 2)
      .map((server, index) => `${index === 0 ? t('primaryDns') : t('secondaryDns')}: ${server}`)
      .join(' / ');
  };
  const dnsModeLabel = (mode) => (
    mode === 'manual'
      ? t('dnsModeManual')
      : mode === 'automatic'
        ? t('dnsModeAutomatic')
        : t('dnsModeDetected')
  );
  const lanDnsServers = dnsServers(network.lan_dns_servers || [
    network.lan_dns_primary,
    network.lan_dns_secondary,
    network.dns,
  ]);

  return (
    <section className="network-map-page">
      <div className="panel network-map-header">
        <div>
          <span className="eyebrow">{t('liveTopology')}</span>
          <h1>{t('networkMap')}</h1>
          <p>{readOnly ? t('publicNetworkMapCopy') : t('networkMapCopy')}</p>
        </div>
        <div className="network-map-legend">
          <span className="ok"><i />{t('trafficActive')}</span>
          <span className="warn"><i />{t('policyOverride')}</span>
          <span><i />{t('detectedConfig')}</span>
          {readOnly ? <span><ShieldCheck size={15} />{t('publicReadOnly')}</span> : null}
          <span>{soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}{t('localSound')}</span>
        </div>
      </div>

      <div className={`network-map-canvas map-${uiMode}`}>
        <svg className="network-flow-svg" viewBox="0 0 1200 720" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="flowCyan" x1="0" x2="1">
              <stop offset="0" stopColor="#17d5e5" stopOpacity="0.35" />
              <stop offset="1" stopColor="#69aefb" stopOpacity="0.95" />
            </linearGradient>
            <filter id="flowGlow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <path className={`flow-path ${isOnline(wan0) ? 'running' : 'stopped'}`} d="M245 120 C245 190 430 170 510 250" />
          <path className={`flow-path ${isOnline(wan1) ? 'running' : 'stopped'}`} d="M955 120 C955 190 770 170 690 250" />
          <path className={`flow-path ${dualWan.enabled ? 'running' : 'stopped'}`} d="M600 315 C600 370 600 380 600 430" />
          <path className={`flow-path ${ethernetClientCount ? 'running' : 'stopped'}`} d="M600 500 C470 550 270 540 205 625" />
          <path className={`flow-path ${wifiClientCount ? 'running' : 'stopped'}`} d="M600 500 C600 555 600 565 600 625" />
          <path className={`flow-path ${vpnActive ? 'running' : 'stopped'}`} d="M600 500 C730 550 930 540 995 625" />
        </svg>

        <div className="network-map-layer map-sources">
          <MapNode
            icon={Cloud}
            title={`${wan0.label || 'WAN0'} / ${wan0.asusPort || 'WAN0'}`}
            subtitle={`${t('publicIp')}: ${wan0.publicIp || t('unavailable')}${wan0.publicIpStale ? ` · ${t('publicIpLastConfirmed')}` : ''}`}
            meta={`${wan0.ipaddr || t('noWanIp')} · ${wan0.gateway || t('noGateway')}`}
            detail={`${t('upstreamDns')}: ${formatWanDns(wan0)} (${dnsModeLabel(wan0.dnsMode)})`}
            tone="cyan"
            active={isOnline(wan0)}
            onClick={nodeAction('routes')}
          />
          <MapNode
            icon={Cloud}
            title={`${wan1.label || 'WAN1'} / ${wan1.asusPort || 'WAN1'}`}
            subtitle={`${t('publicIp')}: ${wan1.publicIp || t('unavailable')}${wan1.publicIpStale ? ` · ${t('publicIpLastConfirmed')}` : ''}`}
            meta={`${wan1.ipaddr || t('noWanIp')} · ${wan1.gateway || t('noGateway')}`}
            detail={`${t('upstreamDns')}: ${formatWanDns(wan1)} (${dnsModeLabel(wan1.dnsMode)})`}
            tone="blue"
            active={isOnline(wan1)}
            onClick={nodeAction('routes')}
          />
        </div>

        <div className="network-map-layer map-core">
          <MapNode
            icon={Cable}
            title={`${t('dualWan')} · ${dualWan.mode === 'lb' ? t('dualWanLoadBalance') : t('dualWanFailover')}`}
            subtitle={`${dualWan.ratio || 'n/a'} · ${dualWan.ruleCount || 0} ${t('dualWanRoutes')}`}
            meta={dualWan.enabled ? t('enabled') : t('disabled')}
            tone="green"
            active={dualWan.enabled}
            onClick={nodeAction('dualwan')}
          />
          <MapNode
            icon={Network}
            title={t('smartWanOrchestrator')}
            subtitle={t(status.effective_mode || 'observe_only')}
            meta={failoverActive ? t('emergencyOverrideActive') : t('normalPolicyActive')}
            tone={failoverActive ? 'amber' : 'cyan'}
            active={smartWanActive}
            onClick={nodeAction('smartwan')}
          />
        </div>

        <div className="network-map-router">
          <span><Server size={31} /></span>
          <div>
            <small>{t('routerGateway')}</small>
            <strong>ASUS RT-N18U</strong>
            <em>{network.lan_ipaddr || '192.168.1.1'} · {routerState?.identity?.firmware || '386.3_3'}</em>
          </div>
        </div>

        <div className="network-map-layer map-services">
          <MapNode icon={Wifi} title="DHCP / LAN" subtitle={`${network.dhcp_start || 'n/a'} - ${network.dhcp_end || 'n/a'}`} meta={network.lan_netmask || ''} onClick={nodeAction('setup')} />
          <MapNode
            icon={Globe2}
            title={t('lanClientDns')}
            subtitle={lanDnsServers.join(' / ') || network.lan_ipaddr || t('routerManaged')}
            meta={t('asusDnsResolver')}
            detail={t('lanDnsPath')}
            tone="blue"
            onClick={nodeAction('tools')}
          />
          <MapNode icon={ShieldCheck} title="NAT / Firewall" subtitle={network.nat_enabled === '1' ? t('enabled') : t('detectedConfig')} meta={`${network.nat_rules || 0} ${t('natRules')}`} tone="green" onClick={nodeAction('routes')} />
          <MapNode icon={LockKeyhole} title="OpenVPN Server 1" subtitle={status.vpn_interface_ip || configForm.vpnSubnet} meta={vpnActive ? t('tunnelActive') : t('tunnelWaiting')} tone="amber" active={vpnActive} onClick={nodeAction('vpn')} />
        </div>

        <div className="network-map-layer map-clients">
          <MapNode
            icon={Cable}
            title={t('ethernetClients')}
            subtitle={`${ethernetClientCount} ${t('activeNow')}`}
            meta={unknownClientCount ? `${unknownClientCount} ${t('unclassifiedClients')}` : network.lan_subnet || configForm.vpnLanSubnet}
            tone="cyan"
            active={ethernetClientCount > 0}
            onClick={nodeAction('tools')}
          />
          <MapNode
            icon={Wifi}
            title={t('wifiClients')}
            subtitle={`${wifiClientCount} ${t('activeNow')}`}
            meta={network.lan_subnet || configForm.vpnLanSubnet}
            tone="blue"
            active={wifiClientCount > 0}
            onClick={nodeAction('tools')}
          />
          <MapNode icon={LockKeyhole} title={t('vpnClients')} subtitle={vpnActive ? t('tunnelActive') : t('noActiveTunnel')} meta={configForm.vpnSubnet} tone="amber" active={vpnActive} onClick={nodeAction('vpn')} />
        </div>

        {activeClients.length ? (
          <div className="network-client-strip">
            {activeClients.slice(0, 8).map((client) => (
              <span className={client.ip === viewer.ip ? 'is-viewer' : ''} key={`${client.ip}-${client.mac}`}>
                {client.connectionType === 'wifi' ? <Wifi size={12} /> : <Cable size={12} />}
                {client.name || t('client')} <b>{client.ip}</b>{client.ip === viewer.ip ? <em>{t('thisDevice')}</em> : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function VpnPanel({
  t,
  configForm,
  setConfigForm,
  status,
  routerHost,
  uiMode,
  onSelectProfile,
  onApply,
  onExportPolicy,
  busy,
  onConflict,
  onRefresh,
}) {
  const level = uiModeLevels[uiMode];
  const update = (patch) => {
    const resolved = resolveVpnPatch(configForm, patch);
    setConfigForm(resolved.config);
    onConflict(resolved.messages);
  };
  const managed = configForm.vpnManagementEnabled;
  const conflicts = vpnConflictMessages(configForm);
  const additionalVpnProfiles = String(configForm.vpnAdditionalProfiles || '')
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const server2ProfileIndex = (() => {
    const detected = additionalVpnProfiles.findIndex((entry) => (
      entry.startsWith('tun22|') || entry.split('|')[1] === '10.16.0.0/24'
    ));
    return detected >= 0 ? detected : additionalVpnProfiles.length ? 0 : -1;
  })();
  const server2Parts = (server2ProfileIndex >= 0
    ? additionalVpnProfiles[server2ProfileIndex]
    : 'tun22|10.16.0.0/24|wan0').split('|');
  const server2Managed = server2ProfileIndex >= 0;
  const server2Profile = {
    interface: server2Parts[0] || 'tun22',
    subnet: server2Parts[1] || '10.16.0.0/24',
    preferredWan: server2Parts[2] || configForm.vpnPreferredWan || 'wan0',
  };
  const vpnTunnelStates = (() => {
    const tunnels = new Map();
    const addTunnel = (interfaceName, subnet = '', up = false) => {
      const normalizedInterface = String(interfaceName || '').trim();
      if (!normalizedInterface) return;
      tunnels.set(normalizedInterface, {
        interface: normalizedInterface,
        subnet: String(subnet || '').trim(),
        up: Boolean(up),
      });
    };

    addTunnel(
      status.vpn_interface || configForm.vpnInterface,
      status.vpn_subnet || configForm.vpnSubnet,
      status.vpn_interface_up === '1',
    );
    additionalVpnProfiles.forEach((entry) => {
      const [interfaceName, subnet] = entry.split('|');
      addTunnel(interfaceName, subnet, false);
    });
    String(status.vpn_profiles_up || '')
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const [interfaceName, subnet, state] = entry.split('|');
        addTunnel(interfaceName, subnet, state === '1');
      });

    return [...tunnels.values()];
  })();
  const updateServer2Profile = (patch, enabled = true) => {
    const nextProfiles = [...additionalVpnProfiles];
    if (!enabled) {
      if (server2ProfileIndex >= 0) nextProfiles.splice(server2ProfileIndex, 1);
    } else {
      const next = { ...server2Profile, ...patch };
      const serialized = `${next.interface}|${next.subnet}|${next.preferredWan}`;
      if (server2ProfileIndex >= 0) nextProfiles[server2ProfileIndex] = serialized;
      else nextProfiles.push(serialized);
    }
    update({ vpnAdditionalProfiles: nextProfiles.join('\n') });
  };
  return (
    <section className="vpn-page">
      <div className="panel vpn-hero">
        <div>
          <span className="eyebrow">{t('persistentMerlinPolicy')}</span>
          <div className="title-with-help">
            <h1>{t('vpnManagement')}</h1>
            <ContextHelp title={t('helpVpnTitle')} t={t}>{t('helpVpnCopy')}</ContextHelp>
          </div>
          <p>{t('vpnManagementCopy')}</p>
        </div>
        <div className="vpn-state-grid">
          {vpnTunnelStates.map((tunnel) => (
            <span key={tunnel.interface} className={tunnel.up ? 'ok' : 'warn'} title={tunnel.subnet || undefined}>
              <LockKeyhole />
              <b>{tunnel.interface}</b>
              <small>{tunnel.up ? t('tunnelActive') : t('tunnelWaiting')}</small>
            </span>
          ))}
          <span className={status.vpn_nat_chain_active === '1' ? 'ok' : ''}><ShieldCheck /><b>NAT</b><small>{status.vpn_nat_chain_active === '1' ? t('managedActive') : t('notApplied')}</small></span>
          <span className={status.hooks_installed === '1' ? 'ok' : 'warn'}><RefreshCw /><b>{t('persistence')}</b><small>{status.hooks_installed === '1' ? t('merlinHooksReady') : t('hooksRequired')}</small></span>
        </div>
      </div>

      <VpnDisclosure
        className="vpn-profiles"
        title={t('vpnProfiles')}
        copy={t('vpnProfilesCopy')}
        icon={LockKeyhole}
      >
        <div className="vpn-profile-grid">
          {vpnProfiles
            .filter((profile) => !(configForm.orchestrationEnabled && profile.policyMode === 'force_wan'))
            .map((profile) => {
            const conflictsWithFailover = configForm.orchestrationEnabled && profile.policyMode === 'force_wan';
            return (
              <button
                type="button"
                key={profile.id}
                className={configForm.vpnPolicyMode === profile.policyMode && (profile.policyMode !== 'force_wan' || configForm.vpnPreferredWan === (profile.preferredRole === 'failover' ? configForm.failoverWan : configForm.primaryWan)) ? 'active' : ''}
                onClick={() => onSelectProfile(profile.id)}
                disabled={conflictsWithFailover}
                title={conflictsWithFailover ? t('conflictVpnForceWan') : ''}
              >
                <ShieldCheck size={20} />
                <strong>{t(`vpnProfile_${profile.id}`)}</strong>
                <small>{conflictsWithFailover ? t('disabledByConflict') : t(`vpnProfile_${profile.id}_copy`)}</small>
              </button>
            );
          })}
        </div>
      </VpnDisclosure>

      <OpenVpnProfileEditor t={t} serverUnit={1} routerHost={routerHost}>
        <div className="form-grid two vpn-advanced">
          <Field label={t('vpnInterface')} helpText={t('helpVpnInterfaceCopy')} t={t}>
            <TextInput value={configForm.vpnInterface} onChange={(event) => update({ vpnInterface: event.target.value })} />
          </Field>
          <Field label={t('vpnSubnet')}>
            <TextInput value={configForm.vpnSubnet} onChange={(event) => update({ vpnSubnet: event.target.value })} />
          </Field>
          <Field label={t('vpnPreferredWan')}>
            <select value={configForm.vpnPreferredWan} onChange={(event) => update({ vpnPreferredWan: event.target.value })}>
              <option value="wan0">WAN0 · {configForm.wan0Label || 'WAN0'}</option>
              <option value="wan1">WAN1 · {configForm.wan1Label || 'WAN1'}</option>
            </select>
          </Field>
        </div>
        <div className="button-row">
          <ActionButton icon={Save} busy={busy === 'apply-config'} onClick={onApply}>{t('applyVpnPolicy')}</ActionButton>
        </div>
      </OpenVpnProfileEditor>

      <OpenVpnProfileEditor t={t} serverUnit={2} routerHost={routerHost}>
        <div className="switch-row">
          <Toggle checked={server2Managed} disabled={!managed} onChange={(value) => updateServer2Profile({}, value)} label={t('vpnManageServer2')} />
        </div>
        <div className="form-grid two vpn-advanced">
          <Field label={t('vpnInterface')}>
            <TextInput
              disabled={!server2Managed}
              value={server2Profile.interface}
              onChange={(event) => updateServer2Profile({ interface: event.target.value })}
            />
          </Field>
          <Field label={t('vpnSubnet')}>
            <TextInput
              disabled={!server2Managed}
              value={server2Profile.subnet}
              onChange={(event) => updateServer2Profile({ subnet: event.target.value })}
            />
          </Field>
          <Field label={t('vpnServer2PreferredWan')} hint={t('vpnServer2PreferredWanHint')}>
            <select
              disabled={!server2Managed}
              value={server2Profile.preferredWan}
              onChange={(event) => updateServer2Profile({ preferredWan: event.target.value })}
            >
              <option value="wan0">WAN0 · {configForm.wan0Label || 'WAN0'}</option>
              <option value="wan1">WAN1 · {configForm.wan1Label || 'WAN1'}</option>
            </select>
          </Field>
        </div>
        <div className="button-row">
          <ActionButton icon={Save} busy={busy === 'apply-config'} onClick={onApply}>{t('applyVpnPolicy')}</ActionButton>
        </div>
      </OpenVpnProfileEditor>

      <VpnDisclosure
        className="vpn-settings"
        title={t('vpnPolicySettings')}
        copy={t('vpnPolicySettingsCopy')}
        icon={SlidersHorizontal}
      >
        <div className="switch-row">
          <Toggle checked={managed} onChange={(value) => update({ vpnManagementEnabled: value })} label={managed ? t('enabled') : t('disabled')} />
          <Toggle checked={configForm.vpnAllowRouter} disabled={!managed} onChange={(value) => update({ vpnAllowRouter: value })} label={t('vpnAllowRouter')} />
          <Toggle checked={configForm.vpnAllowLan} disabled={!managed} onChange={(value) => update({ vpnAllowLan: value })} label={t('vpnAllowLan')} />
          <Toggle checked={configForm.vpnAllowInternet} disabled={!managed || configForm.vpnPolicyMode === 'lan_only'} onChange={(value) => update({ vpnAllowInternet: value })} label={t('vpnAllowInternet')} />
          {level >= 2 ? (
            <Toggle checked={configForm.vpnNatEnabled} disabled={!managed || configForm.vpnPolicyMode === 'lan_only'} onChange={(value) => update({ vpnNatEnabled: value })} label={t('vpnNatEnabled')} />
          ) : null}
        </div>
        <ConflictNotice messages={conflicts} t={t} />

        {level >= 2 ? (
          <div className="form-grid two vpn-advanced">
            <Field label={t('vpnAdditionalProfiles')} helpText={t('helpVpnAdditionalProfiles')} t={t}>
              <TextInput
                value={configForm.vpnAdditionalProfiles}
                onChange={(event) => update({ vpnAdditionalProfiles: event.target.value })}
                placeholder="tun22|10.16.0.0/24|wan0"
              />
            </Field>
            <Field label={t('vpnLanSubnet')}><TextInput value={configForm.vpnLanSubnet} onChange={(event) => update({ vpnLanSubnet: event.target.value })} /></Field>
          </div>
        ) : null}

        {level >= 3 ? (
          <div className="vpn-diagnostics">
            <CodeBlock compact>{[
              `policy=${configForm.vpnPolicyMode}`,
              `policy_rule=${status.vpn_policy_rule_active || '0'}`,
              `input_chain=${status.vpn_input_chain_active || '0'}`,
              `forward_chain=${status.vpn_forward_chain_active || '0'}`,
              `nat_chain=${status.vpn_nat_chain_active || '0'}`,
              `failover_override=${status.failover_override_active || '0'}`,
            ].join('\n')}</CodeBlock>
          </div>
        ) : null}

        <div className="warning compact"><ShieldCheck size={17} /><span>{t('vpnPreservesAsusRules')}</span></div>
        <div className="button-row">
          <ActionButton icon={Save} busy={busy === 'apply-config'} onClick={onApply}>{t('applyVpnPolicy')}</ActionButton>
          <ActionButton icon={Download} busy={busy === 'vpn-export-policy'} variant="secondary" onClick={onExportPolicy}>{t('exportVpnPolicy')}</ActionButton>
        </div>
      </VpnDisclosure>

      <CloudflareDdnsPanel
        t={t}
        wan0Label={configForm.wan0Label || 'WAN0'}
        wan1Label={configForm.wan1Label || 'WAN1'}
        server1PreferredWan={configForm.vpnPreferredWan}
        server2PreferredWan={server2Profile.preferredWan}
        onRoutingSynchronized={onRefresh}
      />
      <TailscaleAccessPanel t={t} />
    </section>
  );
}

function TailscaleAccessPanel({ t }) {
  const editingRef = useRef(false);
  const [form, setForm] = useState({
    installed: false,
    enabled: false,
    connected: false,
    needsLogin: false,
    backendState: 'Unknown',
    hostname: 'smartwan-panel',
    deviceName: 'smartwan-panel',
    dnsName: '',
    tailscaleIps: [],
    advertiseRoutes: ['192.168.1.0/24'],
    advertiseExitNode: false,
    tailnet: '',
    authUrl: '',
    lastError: '',
  });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async (quiet = false) => {
    try {
      const status = await api.get('/api/router/vpn/tailscale');
      setForm((current) => (
        quiet && editingRef.current
          ? {
            ...current,
            ...status,
            hostname: current.hostname,
            advertiseRoutes: current.advertiseRoutes,
            advertiseExitNode: current.advertiseExitNode,
          }
          : { ...current, ...status }
      ));
      if (!quiet) setError('');
    } catch (loadError) {
      if (!quiet) setError(loadError.message);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 5_000);
    return () => clearInterval(timer);
  }, []);

  const update = (patch) => {
    editingRef.current = true;
    setForm((current) => ({ ...current, ...patch }));
    setNotice('');
    setError('');
  };

  const payload = () => ({
    enabled: form.enabled,
    hostname: form.hostname,
    advertiseRoutes: Array.isArray(form.advertiseRoutes)
      ? form.advertiseRoutes
      : String(form.advertiseRoutes || '').split(/[,\s]+/).filter(Boolean),
    advertiseExitNode: form.advertiseExitNode === true,
  });

  async function save() {
    setBusy('save');
    setNotice('');
    setError('');
    try {
      const saved = await api.put('/api/router/vpn/tailscale', payload());
      editingRef.current = false;
      setForm((current) => ({ ...current, ...saved }));
      setNotice(t('vpnTailscaleSaved'));
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy('');
    }
  }

  async function start() {
    setBusy('start');
    setNotice('');
    setError('');
    try {
      const started = await api.post('/api/router/vpn/tailscale/start', {
        ...payload(),
        enabled: true,
      });
      editingRef.current = false;
      setForm((current) => ({ ...current, ...started, enabled: true }));
      setNotice(started.connected ? t('vpnTailscaleConnected') : t('vpnTailscaleLoginRequired'));
    } catch (startError) {
      setError(startError.message);
    } finally {
      setBusy('');
    }
  }

  async function stop() {
    setBusy('stop');
    setNotice('');
    setError('');
    try {
      const stopped = await api.post('/api/router/vpn/tailscale/stop');
      setForm((current) => ({ ...current, ...stopped, enabled: false }));
      setNotice(t('vpnTailscaleStopped'));
    } catch (stopError) {
      setError(stopError.message);
    } finally {
      setBusy('');
    }
  }

  const routeText = Array.isArray(form.advertiseRoutes)
    ? form.advertiseRoutes.join(', ')
    : String(form.advertiseRoutes || '');
  const statusClass = form.connected ? 'ok' : form.enabled ? 'warn' : '';

  return (
    <VpnDisclosure
      className="vpn-tailscale-panel"
      title={t('vpnTailscaleTitle')}
      copy={t('vpnTailscaleCopy')}
      eyebrow={t('vpnTailscaleRecommended')}
      icon={Network}
    >
      <div className="vpn-tailscale-status-grid">
        <span className={statusClass}>
          <Activity size={18} />
          <b>{form.connected ? t('connected') : form.enabled ? t('checking') : t('disabled')}</b>
          <small>{form.backendState || 'Unknown'}</small>
        </span>
        <span>
          <Server size={18} />
          <b>{form.deviceName || form.hostname}</b>
          <small>{form.dnsName || form.tailnet || t('unknown')}</small>
        </span>
        <span>
          <Network size={18} />
          <b>{form.tailscaleIps?.join(', ') || '—'}</b>
          <small>{t('vpnTailscaleAddress')}</small>
        </span>
      </div>
      <div className="form-grid two vpn-tailscale-fields">
        <Field label={t('vpnTailscaleDeviceName')}>
          <TextInput value={form.hostname} onChange={(event) => update({ hostname: event.target.value })} />
        </Field>
        <Field label={t('vpnTailscaleRoutes')} hint={t('vpnTailscaleRoutesHint')}>
          <TextInput
            value={routeText}
            onChange={(event) => update({ advertiseRoutes: event.target.value })}
          />
        </Field>
      </div>
      <div className="switch-row vpn-tailscale-exit-node">
        <Toggle
          checked={form.advertiseExitNode}
          onChange={(advertiseExitNode) => update({ advertiseExitNode })}
          label={form.advertiseExitNode ? t('enabled') : t('disabled')}
        />
        <span>
          <b>{t('vpnTailscaleExitNode')}</b>
          <small>{t('vpnTailscaleExitNodeHint')}</small>
        </span>
      </div>
      <div className="info compact">
        <ShieldCheck size={17} />
        <span>{t('vpnTailscaleFlow')}</span>
      </div>
      <ol className="vpn-tailscale-steps">
        <li>{t('vpnTailscaleStep1')}</li>
        <li>{t('vpnTailscaleStep2').replace('{routes}', routeText || '—')}</li>
        <li>{t('vpnTailscaleStep3').replace('{device}', form.deviceName || form.hostname || '—')}</li>
      </ol>
      {form.lastError ? <div className="notice error">{form.lastError}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
      {notice ? <div className="notice success">{notice}</div> : null}
      <div className="button-row">
        <ActionButton icon={Save} busy={busy === 'save'} variant="secondary" onClick={save}>
          {t('vpnTailscaleSave')}
        </ActionButton>
        {!form.enabled || !form.connected ? (
          <ActionButton icon={Power} busy={busy === 'start'} onClick={start}>
            {t('vpnTailscaleStart')}
          </ActionButton>
        ) : null}
        {form.authUrl ? (
          <a className="action" href={form.authUrl} target="_blank" rel="noreferrer">
            <KeyRound size={15} />{t('vpnTailscaleLogin')}
          </a>
        ) : null}
        {form.enabled ? (
          <a className="action secondary" href="https://login.tailscale.com/admin/machines" target="_blank" rel="noreferrer">
            <ShieldCheck size={15} />{t('vpnTailscaleApproveRoute')}
          </a>
        ) : null}
        <a className="action secondary" href="https://tailscale.com/download" target="_blank" rel="noreferrer">
          <Download size={15} />{t('vpnTailscaleDownloadApp')}
        </a>
        {form.enabled ? (
          <ActionButton icon={Power} busy={busy === 'stop'} variant="danger" onClick={stop}>
            {t('vpnTailscaleStop')}
          </ActionButton>
        ) : null}
      </div>
    </VpnDisclosure>
  );
}

function CloudflareDdnsPanel({
  t,
  wan0Label,
  wan1Label,
  server1PreferredWan,
  server2PreferredWan,
  onRoutingSynchronized,
}) {
  const [form, setForm] = useState({
    enabled: false,
    zone: 'example.com',
    hostname: 'vpn.example.com',
    serverUnit: 2,
    preferredWan: 'auto',
    zoneId: '',
    token: '',
    tokenConfigured: false,
    lastIp: '',
    lastWan: '',
    lastUpdatedAt: '',
    lastError: '',
  });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const saved = await api.get('/api/router/vpn/cloudflare-ddns');
      setForm((current) => ({ ...current, ...saved, token: '' }));
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedServerWan = form.serverUnit === 1
    ? server1PreferredWan
    : server2PreferredWan;

  useEffect(() => {
    if (!['wan0', 'wan1'].includes(selectedServerWan)) return;
    setForm((current) => (
      current.preferredWan === selectedServerWan
        ? current
        : { ...current, preferredWan: selectedServerWan }
    ));
  }, [selectedServerWan]);

  const update = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setNotice('');
    setError('');
  };

  async function save() {
    setBusy('save');
    setNotice('');
    setError('');
    try {
      const saved = await api.put('/api/router/vpn/cloudflare-ddns', {
        enabled: form.enabled,
        zone: form.zone,
        hostname: form.hostname,
        serverUnit: form.serverUnit,
        preferredWan: form.preferredWan,
        zoneId: form.zoneId,
        token: form.token,
      });
      setForm((current) => ({ ...current, ...saved, token: '' }));
      setNotice(t('vpnDdnsSaved'));
      await onRoutingSynchronized?.();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy('');
    }
  }

  async function sync() {
    setBusy('sync');
    setNotice('');
    setError('');
    try {
      const saved = await api.post('/api/router/vpn/cloudflare-ddns/sync');
      setForm((current) => ({ ...current, ...saved, token: '' }));
      setNotice(
        t('vpnDdnsSynced')
          .replace('{ip}', saved.lastIp || 'n/a')
          .replace('{wan}', saved.lastWan === 'wan1' ? wan1Label : wan0Label),
      );
    } catch (syncError) {
      setError(syncError.message);
      await load();
    } finally {
      setBusy('');
    }
  }

  async function removeToken() {
    setBusy('remove');
    setNotice('');
    setError('');
    try {
      const saved = await api.put('/api/router/vpn/cloudflare-ddns', {
        ...form,
        enabled: false,
        removeToken: true,
        token: '',
      });
      setForm((current) => ({ ...current, ...saved, token: '' }));
      setNotice(t('vpnDdnsSaved'));
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusy('');
    }
  }

  async function exportDdnsProfile() {
    setBusy('export');
    setNotice('');
    setError('');
    try {
      let profile;
      try {
        profile = await api.get(`/api/router/vpn/client-profile/ready?server=${form.serverUnit}`);
      } catch {
        profile = await api.get(`/api/router/vpn/client-profile?server=${form.serverUnit}`);
      }
      const content = String(profile?.content || '');
      if (!content) throw new Error(t('ovpnRouterProfileUnavailable'));
      const remote = /^\s*remote\s+\S+(?:\s+\d+)?\s*$/im;
      const port = content.match(remote)?.[0]?.trim().split(/\s+/)?.[2]
        || (form.serverUnit === 1 ? '1194' : '1195');
      const generatedContent = remote.test(content)
        ? content.replace(remote, `remote ${form.hostname} ${port}`)
        : `remote ${form.hostname} ${port}\n${content}`;
      const blob = new Blob([generatedContent], { type: 'application/x-openvpn-profile;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `openvpn-server${form.serverUnit}-cloudflare-ddns.ovpn`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(t('vpnDdnsProfileExported'));
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <VpnDisclosure
      className="vpn-ddns-panel"
      title={t('vpnDdnsTitle')}
      copy={t('vpnDdnsCopy')}
      icon={Globe2}
    >
      <div className="switch-row">
        <Toggle
          checked={form.enabled}
          onChange={(enabled) => update({ enabled })}
          label={form.enabled ? t('enabled') : t('disabled')}
        />
        <span>{t('vpnDdnsEnabled')}</span>
      </div>
      <div className="form-grid two vpn-ddns-fields">
        <Field label={t('vpnDdnsServer')}>
          <select value={form.serverUnit} onChange={(event) => update({ serverUnit: Number(event.target.value) })}>
            <option value={1}>{t('vpnServerNumber').replace('{number}', 1)}</option>
            <option value={2}>{t('vpnServerNumber').replace('{number}', 2)}</option>
          </select>
        </Field>
        <Field label={t('vpnDdnsZone')}>
          <TextInput value={form.zone} onChange={(event) => update({ zone: event.target.value })} />
        </Field>
        <Field label={t('vpnDdnsHostname')}>
          <TextInput value={form.hostname} onChange={(event) => update({ hostname: event.target.value })} />
        </Field>
        <Field label={t('vpnDdnsWan')}>
          <select value={form.preferredWan} onChange={(event) => update({ preferredWan: event.target.value })}>
            <option value="auto">{t('vpnDdnsAutoWan')}</option>
            <option value="wan0">WAN0 · {wan0Label}</option>
            <option value="wan1">WAN1 · {wan1Label}</option>
          </select>
        </Field>
        <Field label={t('vpnDdnsZoneId')} hint={t('vpnDdnsZoneIdHint')}>
          <TextInput value={form.zoneId} onChange={(event) => update({ zoneId: event.target.value })} />
        </Field>
        <Field
          label={t('vpnDdnsToken')}
          hint={form.tokenConfigured ? t('vpnDdnsTokenSaved') : ''}
        >
          <TextInput
            type="password"
            value={form.token}
            autoComplete="new-password"
            onChange={(event) => update({ token: event.target.value })}
          />
        </Field>
        <div className="vpn-ddns-runtime">
          <span><b>{t('vpnDdnsLastIp')}:</b> {form.lastIp || '—'}</span>
          <span>
            <b>{t('vpnDdnsLastUpdate')}:</b>{' '}
            {form.lastUpdatedAt ? new Date(form.lastUpdatedAt).toLocaleString() : '—'}
          </span>
        </div>
      </div>
      <div className="info compact"><ShieldCheck size={17} /><span>{t('vpnDdnsSecurity')}</span></div>
      <div className="warning compact"><AlertTriangle size={17} /><span>{t('vpnDdnsPublicIpRequired')}</span></div>
      <div className="info compact"><Network size={17} /><span>{t('vpnDdnsNoPublicIpAlternative')}</span></div>
      {form.lastError ? <div className="notice error">{form.lastError}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
      {notice ? <div className="notice success">{notice}</div> : null}
      <div className="button-row">
        <ActionButton icon={Save} busy={busy === 'save'} onClick={save}>{t('vpnDdnsSave')}</ActionButton>
        <ActionButton icon={RefreshCw} busy={busy === 'sync'} variant="secondary" onClick={sync}>{t('vpnDdnsSync')}</ActionButton>
        <ActionButton icon={Download} busy={busy === 'export'} variant="secondary" onClick={exportDdnsProfile}>{t('vpnDdnsExportProfile')}</ActionButton>
        {form.tokenConfigured ? (
          <ActionButton icon={Trash2} busy={busy === 'remove'} variant="danger" onClick={removeToken}>{t('vpnDdnsRemoveToken')}</ActionButton>
        ) : null}
      </div>
    </VpnDisclosure>
  );
}

function OpenVpnProfileEditor({ t, serverUnit = 1, routerHost = '', children = null }) {
  const legacyStorageKey = 'smartwan-openvpn-profile-editor';
  const [source, setSource] = useState(defaultOpenVpnTemplate);
  const [fileName, setFileName] = useState(`asus-openvpn-server${serverUnit}-client.ovpn`);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    server: routerHost || '',
    port: serverUnit === 1 ? '1194' : '1195',
    protocol: 'udp',
    dnsPreset: 'cloudflare',
    customDns: '',
    username: '',
    password: '',
    authenticationMode: 'prompt',
    embedCredentials: false,
  });

  const dnsServers = form.dnsPreset === 'custom'
    ? form.customDns.split(/[\s,;]+/).filter(Boolean)
    : openVpnDnsPresets[form.dnsPreset] || openVpnDnsPresets.cloudflare;

  const generated = useMemo(() => {
    try {
      const value = buildOpenVpnProfile({
        source,
        server: form.server,
        port: form.port,
        protocol: form.protocol,
        dnsServers,
        username: form.username,
        password: form.password,
        authenticationMode: form.authenticationMode,
        embedCredentials: form.embedCredentials,
      });
      return { value, error: '' };
    } catch (buildError) {
      return { value: source, error: buildError.message };
    }
  }, [source, form, dnsServers.join('|')]);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/router/vpn/client-profile/ready?server=${serverUnit}`)
      .then(async (profile) => {
        if (cancelled) return;
        let content = String(profile.content || '');
        if (!content) return;
        let defaults = readOpenVpnProfileDefaults(content);

        if (serverUnit === 1 && defaults.authenticationMode === 'prompt') {
          try {
            const legacy = JSON.parse(localStorage.getItem(legacyStorageKey) || 'null');
            if (legacy?.rememberCredentials && legacy.username && legacy.password) {
              const dnsPreset = legacy.dnsPreset || defaults.dnsPreset || 'cloudflare';
              const migratedDnsServers = dnsPreset === 'custom'
                ? String(legacy.customDns || '').split(/[\s,;]+/).filter(Boolean)
                : openVpnDnsPresets[dnsPreset] || openVpnDnsPresets.cloudflare;
              const migratedContent = buildOpenVpnProfile({
                source: content,
                server: legacy.server || defaults.server,
                port: legacy.port || defaults.port,
                protocol: legacy.protocol || defaults.protocol,
                dnsServers: migratedDnsServers,
                username: legacy.username,
                password: legacy.password,
                authenticationMode: 'embedded',
                embedCredentials: true,
              });
              await api.post('/api/router/vpn/client-profile/ready', {
                server: serverUnit,
                filename: profile.filename || fileName,
                content: migratedContent,
              });
              localStorage.removeItem(legacyStorageKey);
              content = migratedContent;
              defaults = readOpenVpnProfileDefaults(content);
              setNotice(t('ovpnLegacyMigrated'));
            }
          } catch {
            // A malformed legacy browser entry must not block the shared panel profile.
          }
        }

        if (cancelled) return;
        setSource(content);
        if (profile.filename) setFileName(profile.filename);
        setForm((current) => ({
          ...current,
          ...defaults,
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setError('');
    setNotice('');
  };

  async function loadProfile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    const defaults = readOpenVpnProfileDefaults(content);
    setSource(content);
    setFileName(file.name.replace(/\.ovpn$/i, '') + '-ready.ovpn');
    update(defaults);
    event.target.value = '';
  }

  async function saveProfile() {
    if (generated.error) {
      setError(generated.error);
      return null;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
    const saved = await api.post('/api/router/vpn/client-profile/ready', {
        server: serverUnit,
        filename: fileName,
        content: generated.value,
      });
      localStorage.removeItem(legacyStorageKey);
      setNotice(t('ovpnSavedInPanel').replace('{filename}', saved.filename || fileName));
      return saved;
    } catch (saveError) {
      setError(saveError.message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndDownloadProfile() {
    const saved = await saveProfile();
    if (!saved) return;
    const blob = new Blob([generated.value], { type: 'application/x-openvpn-profile;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName.endsWith('.ovpn') ? fileName : `${fileName}.ovpn`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadRouterProfile() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const profile = await api.get(`/api/router/vpn/client-profile?server=${serverUnit}`);
      const content = String(profile?.content || '');
      if (!content) throw new Error(t('ovpnRouterProfileUnavailable'));
      const name = profile.filename || `asus-openvpn-server${serverUnit}-client.ovpn`;
      const blob = new Blob([content], { type: 'application/x-openvpn-profile;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(t('ovpnRouterProfileDownloaded'));
    } catch (downloadError) {
      setError(downloadError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <VpnDisclosure
      className="ovpn-editor"
      title={`${t('ovpnEditorTitle')} · ${t('vpnServerNumber').replace('{number}', serverUnit)}`}
      copy={t(serverUnit === 1 ? 'ovpnEditorServer1Copy' : 'ovpnEditorServer2Copy')}
      icon={FileText}
    >
      {children ? <div className="ovpn-server-routing-settings">{children}</div> : null}
      <div className="info compact"><ShieldCheck size={17} /><span>{t('ovpnPublishHint')}</span></div>
      <div className="ovpn-editor-toolbar">
        <ActionButton icon={Download} busy={saving} variant="secondary" onClick={downloadRouterProfile}>
          {t('ovpnDownloadRouterOriginal')}
        </ActionButton>
        <label className="action secondary ovpn-file-button">
          <Upload size={16} />
          {t('ovpnImportProfile')}
          <input type="file" accept=".ovpn,.conf,text/plain" onChange={loadProfile} />
        </label>
        <span>{fileName}</span>
      </div>

      <div className="form-grid two ovpn-editor-fields">
        <Field label={t('ovpnServerAddress')} hint={t('ovpnServerHint')}>
          <TextInput value={form.server} placeholder="vpn.example.com lub 192.168.1.1" onChange={(event) => update({ server: event.target.value })} />
        </Field>
        <div className="form-grid two">
          <Field label={t('ovpnPort')}>
            <TextInput inputMode="numeric" value={form.port} onChange={(event) => update({ port: event.target.value })} />
          </Field>
          <Field label={t('ovpnProtocol')}>
            <select value={form.protocol} onChange={(event) => update({ protocol: event.target.value })}>
              <option value="udp">UDP</option>
              <option value="tcp">TCP</option>
            </select>
          </Field>
        </div>
        <Field label={t('ovpnDnsPreset')} hint={t('ovpnDnsHint')}>
          <select value={form.dnsPreset} onChange={(event) => update({ dnsPreset: event.target.value })}>
            <option value="cloudflare">Cloudflare · 1.1.1.1 / 1.0.0.1</option>
            <option value="google">Google · 8.8.8.8 / 8.8.4.4</option>
            <option value="custom">{t('ovpnDnsCustom')}</option>
          </select>
        </Field>
        {form.dnsPreset === 'custom' ? (
          <Field label={t('ovpnDnsCustom')} hint={t('ovpnDnsCustomHint')}>
            <TextInput value={form.customDns} placeholder="9.9.9.9, 149.112.112.112" onChange={(event) => update({ customDns: event.target.value })} />
          </Field>
        ) : <div />}
        <Field label={t('ovpnAuthenticationMode')} hint={t(`ovpnAuth_${form.authenticationMode}_hint`)}>
          <select
            value={form.authenticationMode}
            onChange={(event) => {
              const authenticationMode = event.target.value;
              update({
                authenticationMode,
                embedCredentials: authenticationMode === 'embedded',
              });
            }}
          >
            <option value="none">{t('ovpnAuth_none')}</option>
            <option value="prompt">{t('ovpnAuth_prompt')}</option>
            <option value="embedded">{t('ovpnAuth_embedded')}</option>
          </select>
        </Field>
        {form.authenticationMode === 'embedded' ? (
          <>
            <Field label={t('ovpnUsername')}>
              <TextInput value={form.username} autoComplete="username" onChange={(event) => update({ username: event.target.value })} />
            </Field>
            <Field label={t('ovpnPassword')}>
              <div className="password-field">
                <TextInput type={showPassword ? 'text' : 'password'} value={form.password} autoComplete="new-password" onChange={(event) => update({ password: event.target.value })} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={t('ovpnShowPassword')}><Eye size={16} /></button>
              </div>
            </Field>
          </>
        ) : null}
      </div>

      {form.authenticationMode === 'embedded' ? (
        <div className="warning compact"><AlertTriangle size={17} /><span>{t('ovpnCredentialsWarning')}</span></div>
      ) : null}

      <div className="ovpn-editor-source">
        <Field label={t('ovpnSourceProfile')} hint={t('ovpnSourceHint')}>
          <TextArea
            value={source}
            spellCheck={false}
            onChange={(event) => {
              setSource(event.target.value);
              setNotice('');
            }}
          />
        </Field>
        <Field label={t('ovpnGeneratedProfile')} hint={t('ovpnGeneratedHint')}>
          <TextArea value={generated.value} spellCheck={false} readOnly />
        </Field>
      </div>

      {error || generated.error ? <div className="notice error">{error || generated.error}</div> : null}
      {notice ? <div className="notice success">{notice}</div> : null}
      <div className="button-row">
        <Field label={t('ovpnFileName')}>
          <TextInput value={fileName} onChange={(event) => setFileName(event.target.value)} />
        </Field>
        <ActionButton icon={Save} busy={saving} onClick={saveProfile}>{t('ovpnSaveReady')}</ActionButton>
        <ActionButton icon={Download} busy={saving} variant="secondary" onClick={saveAndDownloadProfile}>{t('ovpnDownloadReady')}</ActionButton>
      </div>
    </VpnDisclosure>
  );
}

function PublicVpnAccess({ t, vpn }) {
  const [downloadError, setDownloadError] = useState('');
  if (!vpn) return null;
  const preferredWanLabel =
    vpn.preferredWanLabel
    || String(vpn.preferredWan || 'wan0').toUpperCase();
  const failoverWanLabel =
    vpn.failoverWanLabel
    || String(vpn.failoverWan || 'wan1').toUpperCase();
  const readyProfiles = Array.isArray(vpn.profiles) && vpn.profiles.length
    ? vpn.profiles
    : vpn.profile ? [{ ...vpn.profile, serverUnit: 1 }] : [];
  const server2ReadyProfile = readyProfiles.find((profile) => profile.serverUnit === 2);
  const stableProfile = server2ReadyProfile || readyProfiles[0] || {};
  const stablePreferredWanLabel = stableProfile.preferredWanLabel || preferredWanLabel;
  const stableFailoverWanLabel = stableProfile.failoverWanLabel || failoverWanLabel;

  async function downloadReadyProfile(profile) {
    setDownloadError('');
    try {
      const query = new URLSearchParams({ server: String(profile.serverUnit || 1) });
      const response = await fetch(`/api/public/vpn-profile?${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(t('publicVpnProfileUnavailable'));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = profile.filename || `asus-openvpn-server${profile.serverUnit || 1}-client.ovpn`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(error.message);
    }
  }

  return (
    <details className="panel login-vpn-access">
      <summary>
        <div className="public-status-heading"><ShieldCheck size={19} /><h2>{t('publicVpnTitle')}</h2></div>
        <ChevronDown size={18} />
      </summary>
      <div className="login-vpn-access-body">
      <p>{t('publicVpnDynamicSummary')}</p>
      <div className="public-vpn-links">
        <a className="action secondary" href="https://openvpn.net/client/" target="_blank" rel="noreferrer">
          <Download size={15} />{t('downloadOpenVpnApp')}
        </a>
      </div>
      {downloadError ? <span className="public-vpn-unavailable">{downloadError}</span> : null}
      <div className="public-vpn-profile-list">
        {readyProfiles.map((profile) => {
          const authenticationMode = profile.authenticationMode
            || (profile.credentialsEmbedded ? 'embedded' : 'prompt');
          const serverAddress = profile.remoteAddress || t('unknown');
          const connectionHelpKey = {
            local: 'publicVpnConnectionLocal',
            public: 'publicVpnConnectionPublic',
            hostname: 'publicVpnConnectionHostname',
          }[profile.accessScope] || 'publicVpnConnectionUnknown';
          const connectionHelp = t(connectionHelpKey).replace('{server}', serverAddress);
          return (
            <div className="public-vpn-profile-card" key={profile.serverUnit || profile.filename}>
              <strong>{t('vpnServerNumber').replace('{number}', profile.serverUnit || 1)}</strong>
              <span>{connectionHelp}</span>
              <small>
                {t('publicVpnProfileWan')
                  .replace('{wan}', profile.preferredWanLabel || preferredWanLabel)
                  .replace('{failover}', profile.failoverWanLabel || failoverWanLabel)}
              </small>
              {profile.available ? (
                <button type="button" className="action" onClick={() => void downloadReadyProfile(profile)}>
                  <FileText size={15} />{profile.filename}
                </button>
              ) : (
                <span className="public-vpn-unavailable">{t('publicVpnProfileUnavailable')}</span>
              )}
              {profile.available ? (
                <>
                  <small className={authenticationMode === 'embedded' ? 'vpn-credentials-ready' : ''}>
                    {t(authenticationMode === 'embedded'
                      ? 'publicVpnCredentialsIncluded'
                      : authenticationMode === 'none'
                        ? 'publicVpnCredentialsNotRequired'
                        : 'publicVpnCredentialsPrompt')}
                  </small>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="vpn-stable-ip-note">
        <ShieldCheck size={16} />
        <div>
          <span>
            {t('publicVpnStableIpHelp')
              .replace('{primary}', stablePreferredWanLabel)
              .replace('{failover}', stableFailoverWanLabel)}
          </span>
        </div>
      </div>
      </div>
    </details>
  );
}

function formatEventDuration(seconds, t) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '';
  const value = Number(seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value % 60;
  return [
    hours ? `${hours} ${t('hoursShort')}` : '',
    minutes ? `${minutes} ${t('minutesShort')}` : '',
    `${remaining} ${t('secondsShort')}`,
  ].filter(Boolean).join(' ');
}

function viewerRoutingDescription(viewer, t) {
  if (!viewer) return t('publicRoutingUnknown');
  let text;
  if (viewer.routingMode === 'offline') {
    text = t('publicRoutingOffline');
  } else if (viewer.routingMode === 'failover') {
    text = t('publicRoutingFailover').replace('{wan}', viewer.assignedWanLabel || t('unknown'));
  } else if (viewer.routingMode === 'pinned') {
    text = (viewer.failoverConfigured ? t('publicRoutingPinnedFailover') : t('publicRoutingPinned'))
      .replace('{wan}', viewer.assignedWanLabel || t('unknown'));
  } else if (viewer.routingMode === 'balanced') {
    text = t('publicRoutingBalanced');
  } else {
    text = t('publicRoutingDefault').replace('{profile}', viewer.profile || t('unknown'));
  }
  if (viewer.serviceRuleCount || viewer.domainRuleCount) text += ` ${t('publicRoutingServiceRules')}`;
  return text;
}

function normalizeWanId(value) {
  const match = String(value || '').trim().toLowerCase().match(/\bwan([01])\b/);
  return match ? `wan${match[1]}` : '';
}

function wanDisplayName(value, wanStatus = [], fallbackLabel = '') {
  const id = normalizeWanId(value);
  if (!id) return fallbackLabel || String(value || '') || '';
  const live = wanStatus.find((item) => normalizeWanId(item.id) === id);
  const label = String(live?.label || fallbackLabel || '').trim();
  const wanId = id.toUpperCase();
  if (!label || label.toUpperCase() === wanId) return wanId;
  if (label.toUpperCase().includes(`(${wanId})`)) return label;
  return `${label} (${wanId})`;
}

function replaceWanTokens(value, wanStatus = []) {
  return String(value || '').replace(/\bWAN([01])\b/gi, (match, unit, offset, text) => (
    text[offset - 1] === '('
      ? match.toUpperCase()
      : wanDisplayName(`wan${unit}`, wanStatus)
  ));
}

function formatGoogleLocationEventSummary(change = {}, t, wanStatus = []) {
  const entries = Object.entries(change.countries || {})
    .filter(([, location]) => location?.ok && location.countryCode);
  if (!entries.length) return t('googleLocationEventSummary');
  const expected = change.preferredCountryName
    || change.preferredCountryCode
    || t('unknown');
  const mismatched = entries.filter(([, location]) => (
    location.countryCode !== change.preferredCountryCode
  ));
  if (mismatched.length) {
    return mismatched.map(([wanId, location]) => (
      t('googleLocationEventCountryMismatch')
        .replace('{wan}', wanDisplayName(wanId, wanStatus, location.label) || wanId.toUpperCase())
        .replace('{detected}', location.countryName || location.countryCode)
        .replace('{expected}', expected)
    )).join(' · ');
  }
  const labels = entries.map(([wanId, location]) => (
    wanDisplayName(wanId, wanStatus, location.label) || wanId.toUpperCase()
  )).join(', ');
  return t('googleLocationEventCountryMatch')
    .replace('{wans}', labels)
    .replace('{expected}', expected);
}

function formatDualWanEventChange(change = {}, t, wanStatus = []) {
  const wanName = (value) => wanDisplayName(value, wanStatus) || t('unknown');
  if (change.kind === 'wholeTrafficWan') {
    return t('manualDualWanWholeTraffic')
      .replace('{source}', change.source || t('unknown'))
      .replace('{from}', wanName(change.from))
      .replace('{to}', wanName(change.to));
  }
  if (change.kind === 'ruleWan') {
    return t('manualDualWanRuleWan')
      .replace('{source}', change.source || t('unknown'))
      .replace('{destination}', change.destination || t('unknown'))
      .replace('{from}', wanName(change.from))
      .replace('{to}', wanName(change.to));
  }
  if (change.kind === 'destination') {
    return t('manualDualWanDestination')
      .replace('{source}', change.source || t('unknown'))
      .replace('{from}', change.from || t('unknown'))
      .replace('{to}', change.to || t('unknown'));
  }
  if (change.kind === 'mode') {
    const modeName = (value) => value === 'lb' ? t('dualWanLoadBalance') : value === 'fo' ? t('dualWanFailover') : value;
    return t('manualDualWanMode')
      .replace('{from}', modeName(change.from))
      .replace('{to}', modeName(change.to));
  }
  if (change.kind === 'ruleCount') {
    return t('manualDualWanRuleCount')
      .replace('{source}', change.source || t('unknown'))
      .replace('{added}', String(change.added || 0))
      .replace('{removed}', String(change.removed || 0));
  }
  if (change.kind === 'ratio') {
    return t('manualDualWanRatio')
      .replace('{from}', change.from || t('unknown'))
      .replace('{to}', change.to || t('unknown'));
  }
  if (change.kind === 'googleLocationRouting') {
    if (change.outcome === 'routing_restored') {
      return t('googleLocationEventRestored');
    }
    if (change.outcome === 'routing_changed') {
      return t('googleLocationEventMoved')
        .replace('{to}', wanName(change.to));
    }
    if (change.outcome === 'daily_switch_limit') {
      return t('googleLocationEventRateLimited')
        .replace('{from}', wanName(change.from))
        .replace('{to}', wanName(change.to))
        .replace(
          '{until}',
          change.rateLimitUntil ? new Date(change.rateLimitUntil).toLocaleString() : t('unknown'),
        );
    }
    if (change.outcome === 'no_matching_wan') {
      return t('googleLocationEventNoMatch')
        .replace(
          '{country}',
          change.preferredCountryName || change.preferredCountryCode || t('unknown'),
        );
    }
    if (change.temporaryRoutingActive) {
      return t('googleLocationEventRouteRemains')
        .replace('{wan}', wanName(change.routingWan || change.to));
    }
    if (change.outcome === 'location_ok') return t('googleLocationEventRouteNotNeeded');
    return t(`googleLocationOutcome_${change.outcome || 'location_ok'}`);
  }
  return t('manualDualWanGenericAction');
}

function outageReasonText(reason, t) {
  const knownReasons = new Set([
    'physical_link_down',
    'internet_unreachable',
    'all_wans_unreachable',
    'dns_resolution_failed',
    'tcp_connect_failed',
    'https_timeout',
    'tls_handshake_failed',
    'http_service_error',
    'unexpected_http_response',
    'service_quorum_failed',
    'service_transport_failed',
    'wan_route_unavailable',
    'service_targets_missing',
  ]);
  if (knownReasons.has(reason)) return t(`failureReason_${reason}`);
  return String(reason || t('unknown')).replaceAll('_', ' ');
}

function outageKindText(kind, t) {
  if (kind === 'partial') return t('outageKindPartial');
  if (kind === 'complete') return t('outageKindComplete');
  return t('outageKindUnknown');
}

function outageDiagnosticText(event = {}, t) {
  const reason = outageReasonText(event.failureReason, t);
  return t('routerOutageDiagnostic')
    .replace('{reason}', reason)
    .replace('{detail}', event.failureDetail || '');
}

function presentEventCopy(event, t, wanStatus = []) {
  const isPreFixWatchdog = ['router-watchdog-pre-fix', 'router-log-recovery'].includes(event.source);
  const isInferredRecovery = event.source === 'router-watchdog-inferred';
  const isWanTransition = Boolean(event.wanId) && ['outage', 'recovery'].includes(event.type);
  const isManualDualWan = event.type === 'dualwan-config'
    || (event.source === 'manual' && (
      String(event.action || '').includes('Dual WAN configuration changed')
      || String(event.summary || '').includes('Dual WAN routing configuration')
    ));
  const isGoogleLocation = event.type === 'google-location-routing'
    || event.change?.kind === 'googleLocationRouting';
  const isSmartWanConfig = event.type === 'smartwan-config'
    || (
      event.source === 'manual'
      && String(event.action || '').includes('SmartWAN configuration and routing rules applied')
    );
  const isSmartWanRollback = event.type === 'smartwan-rollback'
    || (
      event.source === 'manual'
      && String(event.action || '').includes('Previous SmartWAN configuration restored')
    );
  const wan = wanDisplayName(event.wanId, wanStatus, event.wanLabel)
    || event.wanLabel
    || t('smartWan');
  const activeWan = wanDisplayName(event.activeWan, wanStatus, event.activeWanLabel)
    || event.activeWanLabel
    || t('availableWan');
  const checks = event.failures || 2;
  const summary = isPreFixWatchdog
    ? event.type === 'recovery'
      ? t('preFixRecoverySummary').replace('{wan}', wan)
      : t('preFixOutageSummary').replace('{wan}', wan)
    : isWanTransition
      ? event.type === 'recovery'
        ? t('routerRecoverySummary').replace('{wan}', wan)
        : t(event.outageKind === 'partial'
          ? 'routerPartialOutageSummary'
          : event.outageKind === 'complete'
            ? 'routerCompleteOutageSummary'
            : Number(checks) === 1
              ? 'routerOutageSummaryOne'
              : 'routerOutageSummary')
          .replace('{wan}', wan)
          .replace('{checks}', checks)
      : isManualDualWan
        ? t('manualDualWanSummary')
        : isSmartWanConfig
          ? t('manualSmartWanSummary')
          : isSmartWanRollback
            ? t('manualSmartWanRollbackSummary')
        : isGoogleLocation
          ? formatGoogleLocationEventSummary(event.change, t, wanStatus)
          : replaceWanTokens(event.summary, wanStatus);
  const action = isPreFixWatchdog
    ? event.type === 'recovery'
      ? t('preFixRecoveryAction')
      : t('preFixOutageAction')
    : isInferredRecovery
      ? t('inferredRecoveryAction').replace('{wan}', wan)
      : isWanTransition
        ? event.type === 'recovery'
          ? t('routerRecoveryAction')
          : `${event.activeWan
            ? t('routerOutageAction').replace('{wan}', activeWan)
            : t('routerOutageDetectedAction')} ${outageDiagnosticText(event, t)}`.trim()
        : isManualDualWan || isGoogleLocation
          ? formatDualWanEventChange(event.change, t, wanStatus)
          : isSmartWanConfig
            ? t('manualSmartWanAction')
            : isSmartWanRollback
              ? t('manualSmartWanRollbackAction')
          : replaceWanTokens(event.action, wanStatus);
  return { wan, summary, action };
}

function PublicEventList({ t, events = [], wanStatus = [], expanded = false, onToggle }) {
  const operationalEvents = events.filter((event) => event.testMode !== true);
  const testEvents = events.filter((event) => event.testMode === true);
  const visible = expanded ? operationalEvents : operationalEvents.slice(0, 5);
  const renderEvent = (event) => {
    const { wan, summary, action } = presentEventCopy(event, t, wanStatus);
    return (
      <article className={`public-event ${event.severity || ''}`} key={event.id}>
        <div>
          <strong>{new Date(event.endedAt || event.startedAt).toLocaleString()}</strong>
          <span>{wan || event.profile || t('smartWan')}</span>
        </div>
        <p>{summary}</p>
        {action ? <small>{action}</small> : null}
        {event.durationSeconds !== null && event.durationSeconds !== undefined
          ? <em>{t('outageDuration')}: {formatEventDuration(event.durationSeconds, t)}</em>
          : null}
      </article>
    );
  };
  return (
    <>
      <div className="public-event-list">
        {visible.length ? visible.map(renderEvent) : <p className="empty">{t('publicNoEvents')}</p>}
        {operationalEvents.length > 5 && onToggle ? (
          <button type="button" className="public-history-toggle" onClick={onToggle}>
            <Eye size={15} />{expanded ? t('showRecentEvents') : t('showFullHistory')}
          </button>
        ) : null}
      </div>
      {testEvents.length ? (
        <details className="test-event-drawer">
          <summary>
            <span>
              <strong>{t('testMessages')}</strong>
              <small>{t('testMessagesCopy')}</small>
            </span>
            <b>{testEvents.length}</b>
          </summary>
          <div className="public-event-list test-event-list">
            {testEvents.map(renderEvent)}
          </div>
        </details>
      ) : null}
    </>
  );
}

function PublicNetworkStatus({ t, data, compact = false }) {
  const [expanded, setExpanded] = useState(false);
  if (!data) return null;
  const viewer = data.viewer || {};
  const routing = data.routing || {};
  const googleLocation = data.googleLocation || {};
  const wanStatus = routing.wanStatus || [];
  const lastRecoveredOutage = (data.events || []).find(
    (event) => event.type === 'recovery' && event.startedAt && event.endedAt,
  );
  return (
    <section className={`public-status-board ${compact ? 'compact' : ''}`}>
      {data.stale ? (
        <div className="public-stale-warning">
          <AlertTriangle size={16} />
          <span>
            {t('publicStatusStale')}
            {data.lastSuccessfulAt
              ? ` ${t('lastSuccessfulRead')}: ${new Date(data.lastSuccessfulAt).toLocaleString()}.`
              : ''}
          </span>
        </div>
      ) : null}
      <div className="panel public-status-card connection">
        <div className="public-status-heading"><Globe2 size={19} /><h2>{t('yourConnection')}</h2></div>
        <strong>{viewer.name ? `${viewer.name} — ${viewer.ip}` : viewer.ip || t('unknown')}</strong>
        <p>{viewerRoutingDescription(viewer, t)}</p>
        <div className="public-status-meta">
          <span>{t('activeProfile')}: <b>{viewer.profile || routing.profile || t('unknown')}</b></span>
          {viewer.routingMode === 'pinned' && viewer.assignedWanLabel ? (
            <span>{t('deviceTraffic')}: <b>{viewer.assignedWanLabel}</b></span>
          ) : null}
          {googleLocation.visible ? (
            <span>
              {t('googleWanLocation')}: <b>
                {googleLocation.countryName && googleLocation.wanLabel
                  ? t('googleWanLocationValue')
                    .replace('{country}', googleLocation.countryName)
                    .replace('{wan}', googleLocation.wanLabel)
                  : t('googleWanLocationUnknown')}
                {googleLocation.alternativeRoutingActive
                  ? ` · ${t('googleWanLocationAlternative')}`
                  : ''}
              </b>
            </span>
          ) : null}
          {viewer.connectionType ? <span>{t('connectionType')}: <b>{viewer.connectionType}</b></span> : null}
        </div>
      </div>

      <div className={`panel public-status-card routing ${routing.failoverActive ? 'warn' : ''}`}>
        <div className="public-status-heading"><Route size={19} /><h2>{t('currentRouting')}</h2></div>
        <div className="public-wan-lines">
          {wanStatus.map((wan) => (
            <span key={wan.id} className={wan.online ? 'ok' : 'down'}>
              <i /> <b>{wan.label}</b> — {wan.online ? t('working') : t('noInternet')}
            </span>
          ))}
        </div>
        <div className="public-status-meta">
          <span>{t('activeProfile')}: <b>{routing.profile || t('unknown')}</b></span>
          <span>{t('deviceTraffic')}: <b>{viewer.routeCount || routing.routeCount || 0} {t('policyRoutes')}</b></span>
          <span>{t('failover')}: <b>{routing.failoverActive ? t('active') : t('standby')}</b></span>
          {routing.failoverActive && routing.failoverSince ? (
            <span>{t('failureSince')}: <b>{new Date(routing.failoverSince).toLocaleString()}</b></span>
          ) : lastRecoveredOutage ? (
            <span>
              {t('lastOutage')}: <b>
                {new Date(lastRecoveredOutage.startedAt).toLocaleString()}
                {' — '}
                {new Date(lastRecoveredOutage.endedAt).toLocaleString()}
              </b>
            </span>
          ) : null}
        </div>
      </div>

      <details className="panel public-status-card events public-report-disclosure">
        <summary>
          <div className="public-status-heading"><Clock3 size={19} /><h2>{t('wanEventReports')}</h2></div>
          <ChevronDown size={18} />
        </summary>
        <div className="public-report-disclosure-body">
          {data.eventStorage?.persistent ? (
            <p className="event-storage-note"><ShieldCheck size={14} />{t('persistentEventArchive')}</p>
          ) : null}
          <PublicEventList t={t} events={data.events || []} wanStatus={wanStatus} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
        </div>
      </details>
    </section>
  );
}

function LoginCatMascot({
  t,
  browserId,
  language,
  wanStatus = [],
  statusStale = false,
  failedWan = '',
  recoveryPending = false,
  outageKind = '',
  failureReason = '',
  activeWanLabel = '',
  soundEnabled: aurelkaSoundEnabled,
  animationEnabled: aurelkaAnimationEnabled,
  setSoundEnabled: setAurelkaSoundEnabled,
  setAnimationEnabled: setAurelkaAnimationEnabled,
}) {
  const copy = language === 'pl'
    ? {
      catLabel: 'Aurelka, czarna kotka. Kliknij, aby zostawić wiadomość.',
      catTitle: 'Aurelka — kliknij, aby zostawić wiadomość · przeciągnij, aby ją przenieść',
      meow: 'miau!',
      callToAction: 'Kliknij na mnie, żeby zostawić wiadomość',
      messageLeft: 'Wiadomość zostawiona',
      recentMessages: '5 ostatnich wiadomości',
      internetHappy: 'Internet śmiga! Wszystkie WAN-y mruczą 😸',
      statusChecking: 'Aurelka sprawdza łącza…',
      oneWanDown: (name) => `${name} nie działa!!!`,
      manyWansDown: (names) => `${names} nie działają!!!`,
      closeMessage: 'Zamknij wiadomość',
      formTitle: 'Zostaw wiadomość u Aurelki',
      nickname: 'Twój nick',
      message: 'Wiadomość',
      signedWithIp: 'wiadomość zostanie podpisana adresem IP',
      cancel: 'Anuluj',
      sending: 'Wysyłanie…',
      leaveNote: 'Zostaw notatkę',
      saveError: 'Nie udało się zapisać wiadomości.',
      openComposer: 'Kliknij, aby zostawić wiadomość',
      hideComposer: 'Ukryj formularz',
      hideBubbles: 'Schowaj dymki Aurelki',
      showBubbles: 'Pokaż dymki Aurelki',
      notificationBulb: 'Powiadomienia Aurelki',
    }
    : {
      catLabel: 'Aurelka, a black cat. Click to leave a message.',
      catTitle: 'Aurelka — click to leave a message · drag to move her',
      meow: 'meow!',
      callToAction: 'Click me to leave a message',
      messageLeft: 'Message left',
      recentMessages: '5 latest messages',
      internetHappy: 'Internet is purring! All WANs are up 😸',
      statusChecking: 'Aurelka is checking the links…',
      oneWanDown: (name) => `${name} is down!!!`,
      manyWansDown: (names) => `${names} are down!!!`,
      closeMessage: 'Close message',
      formTitle: 'Leave Aurelka a message',
      nickname: 'Your nickname',
      message: 'Message',
      signedWithIp: 'the message will be signed with your IP address',
      cancel: 'Cancel',
      sending: 'Sending…',
      leaveNote: 'Leave note',
      saveError: 'The message could not be saved.',
      openComposer: 'Click to leave a message',
      hideComposer: 'Hide form',
      hideBubbles: 'Hide Aurelka bubbles',
      showBubbles: 'Show Aurelka bubbles',
      notificationBulb: 'Aurelka notifications',
    };
  const failedWans = wanStatus.filter((wan) => !wan.online);
  const failedWanCount = failedWans.length;
  const networkMood = statusStale || !wanStatus.length
    ? 'checking'
    : failedWans.length
      ? 'outage'
      : 'happy';
  const failedWanNames = failedWans.map(
    (wan) => wan.operator || String(wan.label || wan.id || 'WAN').split('/')[0].trim(),
  );
  const classifiedOutageText = failedWanNames.length > 1
    ? t('aurelkaAllWansOutageNotice')
      .replace('{reason}', outageReasonText(failureReason || 'all_wans_unreachable', t))
    : failedWanNames.length === 1 && outageKind
      ? t('aurelkaFailoverNotice')
      .replace('{kind}', outageKindText(outageKind, t))
      .replace('{wan}', failedWanNames[0])
      .replace('{reason}', outageReasonText(failureReason, t))
      .replace('{active}', activeWanLabel || copy.statusChecking)
      : '';
  const networkStatusText = networkMood === 'happy'
    ? copy.internetHappy
    : networkMood === 'outage'
      ? classifiedOutageText || (failedWanNames.length === 1
        ? copy.oneWanDown(failedWanNames[0])
        : copy.manyWansDown(failedWanNames.join(' + ')))
      : copy.statusChecking;
  const eyeTone = (wanId) => {
    if (statusStale || !wanStatus.length) return 'checking';
    const wan = wanStatus.find((entry) => entry.id === wanId);
    if (!wan) return 'checking';
    if (!wan.online) return 'down';
    if (recoveryPending && failedWan === wanId) return 'recovering';
    return 'healthy';
  };
  const wan0EyeTone = eyeTone('wan0');
  const wan1EyeTone = eyeTone('wan1');
  const bulbTone = networkMood === 'outage'
    ? 'danger'
    : networkMood === 'checking' || recoveryPending
      ? 'warning'
      : 'healthy';
  const [dragState, setDragState] = useState({
    dragging: false,
    placed: false,
    x: 0,
    y: 0,
  });
  const dragRef = useRef({ pointerId: null, moved: false, startX: 0, startY: 0 });
  const aurelkaWorldRef = useRef(null);
  const meowAudioRef = useRef(new Map());
  const knockAudioContextRef = useRef(null);
  const audioUnlockedRef = useRef(false);
  const notificationStateRef = useRef({
    primed: false,
    messageId: '',
    networkSignature: '',
  });
  const [notes, setNotes] = useState([]);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [bubblesVisible, setBubblesVisible] = useState(
    () => localStorage.getItem('aurelka-bubbles-visible') !== '0',
  );
  const [bulbAlert, setBulbAlert] = useState(false);
  const [messageForm, setMessageForm] = useState(() => ({
    nickname: localStorage.getItem('aurelka-nickname') || '',
    message: '',
  }));
  const [messageStatus, setMessageStatus] = useState('');
  const [messageBusy, setMessageBusy] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.get('/api/public/aurelka-messages')
      .then((result) => {
        if (cancelled) return;
        setNotes((result.messages || []).slice(0, 5));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setMessagesLoaded(true);
      });
    return () => {
      cancelled = true;
      meowAudioRef.current.forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
      });
      meowAudioRef.current.clear();
      if (knockAudioContextRef.current) {
        void knockAudioContextRef.current.close().catch(() => undefined);
        knockAudioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const events = new EventSource('/api/public/aurelka-message-events');
    const receiveMessage = (event) => {
      try {
        const incoming = JSON.parse(event.data);
        if (!incoming?.id) return;
        setNotes((current) => {
          const existing = current.find((entry) => entry.id === incoming.id);
          return [
            { ...incoming, own: existing?.own || false },
            ...current.filter((entry) => entry.id !== incoming.id),
          ].slice(0, 5);
        });
        setBubblesVisible(true);
        setComposerOpen(false);
        setDragState({
          dragging: false,
          placed: true,
          x: Math.max(12, window.innerWidth - 118),
          y: Math.max(92, window.innerHeight - 110),
        });
      } catch {
        // Ignore a malformed event; EventSource reconnects automatically.
      }
    };
    events.addEventListener('message', receiveMessage);
    return () => {
      events.removeEventListener('message', receiveMessage);
      events.close();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('aurelka-sound-enabled', aurelkaSoundEnabled ? '1' : '0');
  }, [aurelkaSoundEnabled]);

  useEffect(() => {
    localStorage.setItem('aurelka-animation-enabled', aurelkaAnimationEnabled ? '1' : '0');
  }, [aurelkaAnimationEnabled]);

  useEffect(() => {
    localStorage.setItem('aurelka-bubbles-visible', bubblesVisible ? '1' : '0');
  }, [bubblesVisible]);

  useEffect(() => {
    let cancelled = false;
    const hasLocalSound = localStorage.getItem('aurelka-sound-enabled') !== null;
    const hasLocalAnimation = localStorage.getItem('aurelka-animation-enabled') !== null;
    const hasLocalNickname = Boolean(localStorage.getItem('aurelka-nickname'));
    void api.get(`/api/public/aurelka-preferences?browserId=${encodeURIComponent(browserId)}`)
      .then((saved) => {
        if (cancelled || !saved.found) return;
        if (!hasLocalSound) setAurelkaSoundEnabled(saved.soundEnabled !== false);
        if (!hasLocalAnimation) setAurelkaAnimationEnabled(saved.animationEnabled !== false);
        if (!hasLocalNickname && saved.nickname) {
          localStorage.setItem('aurelka-nickname', saved.nickname);
          setMessageForm((current) => ({ ...current, nickname: saved.nickname }));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setPreferencesReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [browserId, setAurelkaAnimationEnabled, setAurelkaSoundEnabled]);

  useEffect(() => {
    if (!preferencesReady) return;
    void api.post('/api/public/aurelka-preferences', {
      browserId,
      soundEnabled: aurelkaSoundEnabled,
      animationEnabled: aurelkaAnimationEnabled,
      nickname: localStorage.getItem('aurelka-nickname') || '',
    }).catch(() => undefined);
  }, [aurelkaAnimationEnabled, aurelkaSoundEnabled, preferencesReady]);

  const meow = async () => {
    if (!aurelkaSoundEnabled) return;
    const fileName = selectAurelkaMeowFile(failedWanCount);
    const audioPath = `${import.meta.env.BASE_URL}audio/${fileName}`;
    const audio = meowAudioRef.current.get(fileName) || new Audio(audioPath);
    meowAudioRef.current.set(fileName, audio);
    meowAudioRef.current.forEach((otherAudio) => {
      if (otherAudio === audio) return;
      otherAudio.pause();
      otherAudio.currentTime = 0;
    });
    audio.preload = 'auto';
    audio.volume = networkMood === 'outage' ? 0.82 : 0.62;
    audio.currentTime = 0;
    try {
      await audio.play();
      audioUnlockedRef.current = true;
    } catch {
      // Browsers may block sound until the first deliberate interaction.
    }
  };

  const playBulbKnock = async () => {
    if (!aurelkaSoundEnabled) return false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    const context = knockAudioContextRef.current || new AudioContextClass();
    knockAudioContextRef.current = context;
    try {
      await context.resume();
      if (context.state !== 'running') return false;
      const now = context.currentTime;
      const baseFrequency = networkMood === 'outage' ? 420 : networkMood === 'checking' ? 570 : 720;
      [0, 0.16].forEach((delay, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(baseFrequency - (index * 70), now + delay);
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(180, baseFrequency * 0.72),
          now + delay + 0.09,
        );
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.12, now + delay + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.1);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now + delay);
        oscillator.stop(now + delay + 0.11);
      });
      audioUnlockedRef.current = true;
      return true;
    } catch {
      return false;
    }
  };

  const networkSignature = [
    statusStale ? 'stale' : 'fresh',
    recoveryPending ? 'recovering' : 'steady',
    failedWan || '-',
    ...wanStatus.map((wan) => `${wan.id}:${wan.online ? 'up' : 'down'}`),
  ].join('|');

  useEffect(() => {
    if (!messagesLoaded || (!wanStatus.length && !statusStale)) return undefined;
    const currentMessageId = notes[0]?.id || '';
    const previous = notificationStateRef.current;
    if (!previous.primed) {
      notificationStateRef.current = {
        primed: true,
        messageId: currentMessageId,
        networkSignature,
      };
      return undefined;
    }
    const messageChanged = Boolean(
      currentMessageId
      && previous.messageId
      && currentMessageId !== previous.messageId,
    );
    const networkChanged = Boolean(
      previous.networkSignature
      && previous.networkSignature !== networkSignature,
    );
    notificationStateRef.current = {
      primed: true,
      messageId: currentMessageId,
      networkSignature,
    };
    if (!messageChanged && !networkChanged) return undefined;

    setBulbAlert(true);
    let waitingForInteraction = true;
    const knockAfterInteraction = () => {
      if (!waitingForInteraction) return;
      waitingForInteraction = false;
      void playBulbKnock();
    };
    void playBulbKnock().then((played) => {
      if (played) {
        waitingForInteraction = false;
        window.removeEventListener('pointerdown', knockAfterInteraction);
        window.removeEventListener('keydown', knockAfterInteraction);
      }
    });
    window.addEventListener('pointerdown', knockAfterInteraction, { once: true });
    window.addEventListener('keydown', knockAfterInteraction, { once: true });
    return () => {
      waitingForInteraction = false;
      window.removeEventListener('pointerdown', knockAfterInteraction);
      window.removeEventListener('keydown', knockAfterInteraction);
    };
  }, [
    aurelkaSoundEnabled,
    messagesLoaded,
    networkSignature,
    notes[0]?.id,
  ]);

  useEffect(() => {
    if (!notes[0] || !aurelkaSoundEnabled || networkMood === 'outage') return undefined;
    const announceMessage = () => {
      void meow();
    };
    if (audioUnlockedRef.current) {
      announceMessage();
      return undefined;
    }
    window.addEventListener('pointerdown', announceMessage, { once: true });
    window.addEventListener('keydown', announceMessage, { once: true });
    return () => {
      window.removeEventListener('pointerdown', announceMessage);
      window.removeEventListener('keydown', announceMessage);
    };
  }, [notes[0]?.id, aurelkaSoundEnabled, networkMood]);

  useEffect(() => {
    if (networkMood !== 'outage' || !aurelkaSoundEnabled) return undefined;
    let started = false;
    let reminderTimer = 0;
    const startOutageMeows = () => {
      if (started) return;
      started = true;
      void meow();
      reminderTimer = window.setInterval(() => void meow(), 30_000);
    };
    if (audioUnlockedRef.current) {
      startOutageMeows();
    } else {
      window.addEventListener('pointerdown', startOutageMeows, { once: true });
      window.addEventListener('keydown', startOutageMeows, { once: true });
    }
    return () => {
      window.removeEventListener('pointerdown', startOutageMeows);
      window.removeEventListener('keydown', startOutageMeows);
      window.clearInterval(reminderTimer);
    };
  }, [aurelkaSoundEnabled, failedWanCount, networkMood]);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    };
    setDragState({
      dragging: true,
      placed: true,
      x: Math.max(4, Math.min(window.innerWidth - 96, event.clientX - 45)),
      y: Math.max(4, Math.min(window.innerHeight - 86, event.clientY - 14)),
    });
    void meow();
  };

  const onPointerMove = (event) => {
    if (!dragState.dragging || dragRef.current.pointerId !== event.pointerId) return;
    const travelled = Math.hypot(
      event.clientX - dragRef.current.startX,
      event.clientY - dragRef.current.startY,
    );
    if (travelled > 4) dragRef.current.moved = true;
    setDragState((current) => ({
      ...current,
      x: Math.max(4, Math.min(window.innerWidth - 96, event.clientX - 45)),
      y: Math.max(4, Math.min(window.innerHeight - 86, event.clientY - 14)),
    }));
  };

  const releaseAurelka = (event) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current.pointerId = null;
    setDragState((current) => ({ ...current, dragging: false }));
  };

  const resetAurelka = () => {
    setDragState({ dragging: false, placed: false, x: 0, y: 0 });
    setComposerOpen(false);
    void meow();
  };

  const resumeAurelka = () => {
    setComposerOpen(false);
    setDragState({ dragging: false, placed: false, x: 0, y: 0 });
  };

  useEffect(() => {
    if (!composerOpen && !dragState.placed) return undefined;
    let inactivityTimer = 0;
    const scheduleResume = () => {
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(resumeAurelka, 9000);
    };
    const handlePointerActivity = (event) => {
      if (!aurelkaWorldRef.current?.contains(event.target)) {
        resumeAurelka();
        return;
      }
      scheduleResume();
    };
    window.addEventListener('pointerdown', handlePointerActivity, true);
    window.addEventListener('keydown', scheduleResume, true);
    window.addEventListener('input', scheduleResume, true);
    scheduleResume();
    return () => {
      window.removeEventListener('pointerdown', handlePointerActivity, true);
      window.removeEventListener('keydown', scheduleResume, true);
      window.removeEventListener('input', scheduleResume, true);
      window.clearTimeout(inactivityTimer);
    };
  }, [composerOpen, dragState.placed]);

  const formatMessageDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(language === 'pl' ? 'pl-PL' : 'en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  };

  const submitMessage = async (event) => {
    event.preventDefault();
    setMessageBusy(true);
    setMessageStatus('');
    try {
      const result = await api.post('/api/public/aurelka-messages', messageForm);
      localStorage.setItem('aurelka-nickname', messageForm.nickname.trim());
      void api.post('/api/public/aurelka-preferences', {
      browserId,
        soundEnabled: aurelkaSoundEnabled,
        animationEnabled: aurelkaAnimationEnabled,
        nickname: messageForm.nickname.trim(),
      }).catch(() => undefined);
      setNotes((current) => [
        { ...result.message, own: true },
        ...current.filter((entry) => entry.id !== result.message.id),
      ].slice(0, 5));
      setMessageForm((current) => ({ ...current, message: '' }));
      setComposerOpen(false);
      setMessageStatus('');
      void meow();
    } catch (error) {
      setMessageStatus(language === 'pl' ? error.message : copy.saveError);
    } finally {
      setMessageBusy(false);
    }
  };

  return (
    <div
      ref={aurelkaWorldRef}
      className={`aurelka-world${aurelkaAnimationEnabled ? '' : ' motion-off'}${composerOpen ? ' composer-open' : ''}`}
    >
      <div
        className={`aurelka-mascot mood-${networkMood}${dragState.dragging ? ' is-dragging' : ''}${dragState.placed ? ' is-placed' : ''}`}
        style={{
          '--aurelka-x': `${dragState.x}px`,
          '--aurelka-y': `${dragState.y}px`,
        }}
        role="button"
        tabIndex="0"
        aria-label={copy.catLabel}
        title={copy.catTitle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={releaseAurelka}
        onPointerCancel={releaseAurelka}
        onClick={() => {
          if (!dragRef.current.moved) {
            setBubblesVisible(true);
            setBulbAlert(false);
            setComposerOpen(true);
          }
        }}
        onDoubleClick={resetAurelka}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void meow();
          }
        }}
      >
        {!bubblesVisible ? (
          <span className="aurelka-bulb-route">
            <button
              type="button"
              className={`aurelka-notification-bulb tone-${bulbTone}${bulbAlert ? ' has-alert' : ''}`}
              aria-label={`${copy.notificationBulb}. ${copy.showBubbles}`}
              title={copy.showBubbles}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setBubblesVisible(true);
                setBulbAlert(false);
                void playBulbKnock();
              }}
            >
              <span aria-hidden="true">💡</span>
            </button>
          </span>
        ) : null}
        <span className="aurelka-name-tag">Aurelka</span>
        <span className="aurelka-shadow" />
        <svg className="aurelka-cat-art" viewBox="0 0 106 88" role="presentation">
          <defs>
            <linearGradient id="aurelka-fur" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#263039" />
              <stop offset="0.38" stopColor="#080b10" />
              <stop offset="1" stopColor="#020306" />
            </linearGradient>
            <radialGradient id="aurelka-eye-healthy" cx="38%" cy="30%" r="70%">
              <stop offset="0" stopColor="#eaffb2" />
              <stop offset="0.45" stopColor="#70ef79" />
              <stop offset="1" stopColor="#20a84c" />
            </radialGradient>
            <radialGradient id="aurelka-eye-checking" cx="38%" cy="30%" r="70%">
              <stop offset="0" stopColor="#fff7bf" />
              <stop offset="0.45" stopColor="#ffc84e" />
              <stop offset="1" stopColor="#e57b16" />
            </radialGradient>
            <radialGradient id="aurelka-eye-down" cx="38%" cy="30%" r="70%">
              <stop offset="0" stopColor="#ffd0c9" />
              <stop offset="0.45" stopColor="#ff5f58" />
              <stop offset="1" stopColor="#b80f22" />
            </radialGradient>
          </defs>
          <g className="aurelka-facing-layer">
          <g className="aurelka-tail">
            <path d="M75 58 C101 61 103 27 86 25 C76 24 75 35 85 38" />
          </g>
          <ellipse className="aurelka-body" cx="54" cy="57" rx="30" ry="19" />
          <path className="aurelka-fur-shine" d="M42 43 Q58 38 69 48 Q57 44 43 49 Z" />
          <path className="aurelka-bristles" d="M29 48 L33 39 L39 44 L45 36 L51 43 L58 36 L64 45 L70 40 L74 49" />
          <path className="aurelka-back-leg" d="M37 65 L31 80 Q31 85 39 83 L44 66" />
          <path className="aurelka-front-leg" d="M65 66 L67 81 Q68 86 75 82 L72 63" />
          <path className="aurelka-paw" d="M30 80 Q35 77 40 82 Q38 87 32 85 Z" />
          <path className="aurelka-paw" d="M66 80 Q72 77 76 82 Q74 87 68 85 Z" />
          <path className="aurelka-ear" d="M24 29 L25 6 Q38 12 43 23 Z" />
          <path className="aurelka-ear" d="M55 23 Q64 12 75 7 L73 34 Z" />
          <circle className="aurelka-head" cx="49" cy="36" r="26" />
          <path className="aurelka-head-tuft" d="M39 12 Q44 2 49 13 Q54 3 58 15" />
          <path className="aurelka-ear-inner" d="M29 22 L29 12 L38 22 Z" />
          <path className="aurelka-ear-inner" d="M62 22 L71 12 L69 26 Z" />
          <ellipse className={`aurelka-eye wan0 tone-${wan0EyeTone}`} cx="39" cy="34" rx="6.2" ry="8.2" />
          <ellipse className={`aurelka-eye wan1 tone-${wan1EyeTone}`} cx="59" cy="34" rx="6.2" ry="8.2" />
          <ellipse className="aurelka-pupil" cx="39" cy="35" rx="1.5" ry="5" />
          <ellipse className="aurelka-pupil" cx="59" cy="35" rx="1.5" ry="5" />
          <circle className="aurelka-eye-spark" cx="36.8" cy="31" r="1.8" />
          <circle className="aurelka-eye-spark" cx="56.8" cy="31" r="1.8" />
          <path className="aurelka-angry-brow" d="M32 26 L43 30 M66 26 L55 30" />
          <ellipse className="aurelka-cheek" cx="29" cy="44" rx="6" ry="2.5" />
          <ellipse className="aurelka-cheek" cx="69" cy="44" rx="6" ry="2.5" />
          <path className="aurelka-nose" d="M45.5 43 L52.5 43 L49 47 Z" />
          <path className="aurelka-mouth" d="M49 47 Q45 52 41 48 M49 47 Q53 52 57 48" />
          <path className="aurelka-whiskers" d="M35 45 L9 40 M35 49 L8 52 M63 45 L89 40 M63 49 L90 52" />
          <path className="aurelka-collar" d="M28 53 Q49 61 70 52" />
          <path className="aurelka-scruff" d="M65 43 Q72 48 70 56" />
          <circle className="aurelka-bell" cx="50" cy="58" r="4.5" />
          <path className="aurelka-bell-shine" d="M48 56 Q50 54 52 56" />
          </g>
        </svg>
      </div>
      <div
        className={`aurelka-message-route mood-${networkMood}${bubblesVisible ? '' : ' bubbles-hidden'}${dragState.dragging ? ' is-dragging' : ''}${dragState.placed ? ' is-placed' : ''}${dragState.x > window.innerWidth / 2 ? ' bubble-left' : ''}`}
        style={{
          '--aurelka-x': `${dragState.x}px`,
          '--aurelka-y': `${dragState.y}px`,
        }}
      >
        <div className="aurelka-bubble-column">
          <button
            type="button"
            className="aurelka-bubble-close"
            aria-label={copy.hideBubbles}
            title={copy.hideBubbles}
            onClick={() => {
              setBubblesVisible(false);
              setComposerOpen(false);
            }}
          >
            ×
          </button>
          <div className={`aurelka-network-cloud ${networkMood}`} role="status" aria-live="polite">
            <span aria-hidden="true">{networkMood === 'outage' ? '!!!' : networkMood === 'happy' ? '♥' : '…'}</span>
            <strong>{networkStatusText}</strong>
          </div>
          {notes.length ? (
            <section className="aurelka-message-bubble">
              <h3>{copy.recentMessages}</h3>
              <ol className="aurelka-message-list">
                {notes.map((entry) => (
                  <li key={entry.id}>
                    <div className="aurelka-message-meta">
                      <strong>{entry.nickname} · {entry.authorIp}</strong>
                      {entry.createdAt ? <time dateTime={entry.createdAt}>{formatMessageDate(entry.createdAt)}</time> : null}
                    </div>
                    <span>{entry.message}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <span className="aurelka-speech aurelka-cta">{copy.callToAction}</span>
          )}
          <button
            type="button"
            className={`aurelka-compose-toggle${composerOpen ? ' open' : ''}`}
            onClick={() => {
              if (composerOpen) resumeAurelka();
              else setComposerOpen(true);
            }}
          >
            <Plus size={14} />
            {composerOpen ? copy.hideComposer : copy.openComposer}
          </button>
          {composerOpen ? (
            <form className="aurelka-note-composer" onSubmit={submitMessage}>
              <strong>{copy.formTitle}</strong>
              <label>
                {copy.nickname}
                <input
                  value={messageForm.nickname}
                  maxLength="24"
                  autoComplete="nickname"
                  onChange={(event) => setMessageForm((current) => ({ ...current, nickname: event.target.value }))}
                  required
                />
              </label>
              <label>
                {copy.message}
                <textarea
                  value={messageForm.message}
                  maxLength="180"
                  rows="3"
                  onChange={(event) => setMessageForm((current) => ({ ...current, message: event.target.value }))}
                  required
                  autoFocus
                />
              </label>
              <small>{messageForm.message.length}/180 · {copy.signedWithIp}</small>
              {messageStatus ? <span className="aurelka-note-error">{messageStatus}</span> : null}
              <div>
                <button type="button" onClick={resumeAurelka}>{copy.cancel}</button>
                <button type="submit" disabled={messageBusy}>
                  {messageBusy ? copy.sending : copy.leaveNote}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LoginPanel({
  t,
  auth,
  notice,
  busy,
  loginForm,
  setLoginForm,
  onLogin,
  language,
  setLanguage,
  publicMapOpen,
  publicMapState,
  publicMapBusy,
  publicMapError,
  onTogglePublicMap,
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const browserIdRef = useRef('');
  if (!browserIdRef.current) {
    const rememberedId = localStorage.getItem('aurelka-browser-id');
    browserIdRef.current = rememberedId
      || window.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('aurelka-browser-id', browserIdRef.current);
  }
  const [aurelkaSoundEnabled, setAurelkaSoundEnabled] = useState(
    () => localStorage.getItem('aurelka-sound-enabled') !== '0',
  );
  const [aurelkaAnimationEnabled, setAurelkaAnimationEnabled] = useState(
    () => localStorage.getItem('aurelka-animation-enabled') === '1',
  );
  const publicWans = publicMapState?.routing?.wanStatus || [];
  const onlineWanCount = publicWans.filter((wan) => wan.online).length;
  const connectionTone = publicMapError && !publicMapState
    ? 'offline'
    : publicMapState?.stale
      ? 'stale'
      : onlineWanCount > 0
        ? 'online'
        : 'loading';
  const connectionLabel = connectionTone === 'online'
    ? t('publicConnectionOnline')
    : connectionTone === 'stale'
      ? t('publicConnectionStale')
      : connectionTone === 'offline'
        ? t('publicConnectionOffline')
        : t('publicConnectionReading');
  const connectionSummary = publicMapState
    ? `${onlineWanCount}/${publicWans.length || 0} WAN · VPN ${publicMapState.vpn?.interfaceUp ? t('connected') : t('disconnected')}`
    : t('loadingPublicStatus');
  const routingStatus = publicMapState?.routing || {};
  const failedPublicWan = publicWans.find((wan) => wan.id === routingStatus.failedWan);
  const loginFailoverNotice = routingStatus.allWansDown
    ? t('allWansOutageNotice')
      .replace('{reason}', outageReasonText(routingStatus.failureReason || 'all_wans_unreachable', t))
    : routingStatus.failoverActive && failedPublicWan
      ? t('loginFailoverNotice')
      .replace(
        '{kind}',
        outageKindText(routingStatus.outageKind, t),
      )
      .replace('{wan}', failedPublicWan.operator || failedPublicWan.label || failedPublicWan.id.toUpperCase())
      .replace('{reason}', outageReasonText(routingStatus.failureReason, t))
      .replace('{active}', routingStatus.activeWanLabel || routingStatus.activeWan?.toUpperCase() || t('availableWan'))
      : '';

  return (
    <div className={`login-shell ${publicMapOpen ? 'public-map-open' : ''}`}>
      <LoginCatMascot
        t={t}
        browserId={browserIdRef.current}
        language={language}
        wanStatus={publicWans}
        statusStale={Boolean(publicMapState?.stale)}
        failedWan={publicMapState?.routing?.failedWan || ''}
        recoveryPending={Boolean(publicMapState?.routing?.recoveryPending)}
        outageKind={publicMapState?.routing?.outageKind || ''}
        failureReason={publicMapState?.routing?.failureReason || ''}
        activeWanLabel={publicMapState?.routing?.activeWanLabel || ''}
        soundEnabled={aurelkaSoundEnabled}
        animationEnabled={aurelkaAnimationEnabled}
        setSoundEnabled={setAurelkaSoundEnabled}
        setAnimationEnabled={setAurelkaAnimationEnabled}
      />
      <section className="panel login-panel">
        <div className="brand login-brand">
          <Network size={30} />
          <div>
            <strong>{t('appTitle')}</strong>
            <span>{t('panelLoginSubtitle')}</span>
          </div>
        </div>
        {notice ? <div className={`notice ${notice.includes(t('failed')) ? 'error' : ''}`}>{notice}</div> : null}
        {!auth.configured ? (
          <div className="warning">
            <strong>{t('panelLoginNotConfigured')}</strong>
            <CodeBlock compact>{auth.resetCommand || "docker exec smartwan-manager node server/setPanelPassword.js admin 'new-strong-password'"}</CodeBlock>
          </div>
        ) : null}
        <Field label={t('panelUsername')}>
          <TextInput
            value={loginForm.username}
            onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })}
            autoComplete="username"
            disabled={!auth.configured}
          />
        </Field>
        <Field label={t('panelPassword')}>
          <TextInput
            type="password"
            value={loginForm.password}
            onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
            autoComplete="current-password"
            disabled={!auth.configured}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && auth.configured) {
                void onLogin();
              }
            }}
          />
        </Field>
        <ActionButton icon={KeyRound} busy={busy === 'login'} onClick={onLogin} disabled={!auth.configured || !loginForm.username || !loginForm.password}>
          {t('login')}
        </ActionButton>
        <div className="login-public-tools">
          <ActionButton icon={publicMapOpen ? X : Workflow} variant="secondary" busy={publicMapBusy} onClick={onTogglePublicMap}>
            {publicMapOpen ? t('closePublicMap') : t('publicNetworkMap')}
          </ActionButton>
          <div className="login-language-tools">
            <div className="language-select">
              <Languages size={16} />
              <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label={t('language')}>
                {languages.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}
              </select>
            </div>
            <div className="aurelka-controls" aria-label="Ustawienia Aurelki">
              <button
                type="button"
                className={aurelkaSoundEnabled ? 'active' : ''}
                aria-label={language === 'pl'
                  ? (aurelkaSoundEnabled ? 'Wycisz dźwięki Aurelki' : 'Włącz dźwięki Aurelki')
                  : (aurelkaSoundEnabled ? 'Mute Aurelka sounds' : 'Enable Aurelka sounds')}
                title={language === 'pl'
                  ? (aurelkaSoundEnabled ? 'Wycisz dźwięki Aurelki' : 'Włącz dźwięki Aurelki')
                  : (aurelkaSoundEnabled ? 'Mute Aurelka sounds' : 'Enable Aurelka sounds')}
                onClick={() => setAurelkaSoundEnabled((current) => !current)}
              >
                {aurelkaSoundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
              <button
                type="button"
                className={aurelkaAnimationEnabled ? 'active' : ''}
                aria-label={language === 'pl'
                  ? (aurelkaAnimationEnabled ? 'Zatrzymaj animacje Aurelki' : 'Włącz animacje Aurelki')
                  : (aurelkaAnimationEnabled ? 'Pause Aurelka animations' : 'Enable Aurelka animations')}
                title={language === 'pl'
                  ? (aurelkaAnimationEnabled ? 'Zatrzymaj animacje Aurelki' : 'Włącz animacje Aurelki')
                  : (aurelkaAnimationEnabled ? 'Pause Aurelka animations' : 'Enable Aurelka animations')}
                onClick={() => setAurelkaAnimationEnabled((current) => !current)}
              >
                {aurelkaAnimationEnabled ? <Pause size={15} /> : <Play size={15} />}
              </button>
            </div>
          </div>
        </div>
        {loginFailoverNotice ? (
          <div className={`login-failover-notice ${routingStatus.outageKind || 'complete'}`} role="alert">
            <AlertTriangle size={18} />
            <strong>{loginFailoverNotice}</strong>
          </div>
        ) : null}
        <div className={`login-status-disclosure ${connectionTone} ${statusOpen ? 'open' : 'attention'}`}>
          <button
            type="button"
            className="login-status-trigger"
            aria-expanded={statusOpen}
            onClick={() => setStatusOpen((value) => !value)}
          >
            <span className="login-status-indicator">
              {connectionTone === 'loading'
                ? <Loader2 className="spin" size={18} />
                : <i aria-hidden="true" />}
            </span>
            <span className="login-status-copy">
              <strong>{t('publicConnectionStatus')}: {connectionLabel}</strong>
              <small>{connectionSummary}</small>
            </span>
            <span className="login-status-action">
              {statusOpen ? t('collapseConnectionDetails') : t('expandConnectionDetails')}
              <ChevronDown size={18} />
            </span>
          </button>
          {statusOpen ? (
            <div className="login-status-content">
              {publicMapBusy && !publicMapState ? (
                <div className="public-status-loading"><Loader2 className="spin" size={17} />{t('loadingPublicStatus')}</div>
              ) : null}
              {publicMapError && !publicMapState ? <div className="notice error">{publicMapError}</div> : null}
              {publicMapState ? <PublicNetworkStatus t={t} data={publicMapState} compact /> : null}
              {publicMapState?.vpn ? <PublicVpnAccess t={t} vpn={publicMapState.vpn} /> : null}
            </div>
          ) : null}
        </div>
        <details className="password-reset-disclosure">
          <summary>
            <span><KeyRound size={16} />{t('panelPasswordReset')}</span>
            <ChevronDown size={18} />
          </summary>
          <div className="password-reset-content">
            <ol>
              <li>{t('panelPasswordResetSshInstruction')}</li>
              <li>{t('panelPasswordResetCommandInstruction')}</li>
            </ol>
            <CodeBlock compact>{auth.resetCommand || "docker exec smartwan-manager node server/setPanelPassword.js admin 'new-strong-password'"}</CodeBlock>
          </div>
        </details>
      </section>
      {publicMapOpen ? (
        <div className="public-map-preview">
          {publicMapError ? <div className="notice error">{publicMapError}</div> : null}
          {publicMapBusy && !publicMapState ? (
            <div className="panel public-map-loading"><Loader2 className="spin" /><strong>{t('loading')}</strong></div>
          ) : publicMapState ? (
            <>
              <PublicNetworkStatus t={t} data={publicMapState} />
              <NetworkMapPanel
                t={t}
                routerState={publicMapState}
                configForm={defaultConfigForm}
                uiMode="safe"
                soundEnabled={false}
                readOnly
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SetupPanel({ t, router, auth, updateRouterSettings, onSave, onTest, busy }) {
  return (
    <section className="panel-grid two">
      <div className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>{t('onboardingTitle')}</h2>
            <p>{t('onboardingCopy')}</p>
          </div>
          <Cable />
        </div>
        <div className="form-grid">
          <Field label={t('routerHost')}>
            <TextInput value={router.host || ''} onChange={(event) => updateRouterSettings({ host: event.target.value })} />
          </Field>
          <Field label={t('sshPort')}>
            <TextInput
              type="number"
              min="1"
              max="65535"
              value={router.port || ''}
              onChange={(event) => updateRouterSettings({ port: Number(event.target.value) })}
            />
          </Field>
          <Field label={t('sshUsername')}>
            <TextInput
              value={router.username || ''}
              onChange={(event) => updateRouterSettings({ username: event.target.value })}
              autoComplete="username"
            />
          </Field>
          <Field label={t('authMethod')}>
            <select value={router.authMethod || 'key'} onChange={(event) => updateRouterSettings({ authMethod: event.target.value })}>
              <option value="key">{t('keyAuth')}</option>
              <option value="password">{t('passwordAuth')}</option>
              <option value="agent">{t('agentAuth')}</option>
            </select>
          </Field>
          <Field label={t('privateKeyPath')}>
            <TextInput
              value={router.privateKeyPath || ''}
              onChange={(event) => updateRouterSettings({ privateKeyPath: event.target.value })}
              placeholder="/data/keys/smartwan_panel_ed25519"
            />
          </Field>
          <Field label={t('passphrase')}>
            <TextInput
              type="password"
              value={router.passphrase || ''}
              onChange={(event) => updateRouterSettings({ passphrase: event.target.value })}
              autoComplete="new-password"
            />
          </Field>
          <Field label={t('password')}>
            <TextInput
              type="password"
              value={router.password || ''}
              onChange={(event) => updateRouterSettings({ password: event.target.value })}
              autoComplete="current-password"
            />
          </Field>
          <Field label={t('smartwanDir')}>
            <TextInput
              value={router.smartwanDir || ''}
              onChange={(event) => updateRouterSettings({ smartwanDir: event.target.value })}
              placeholder="/jffs/addons/smartwan.d"
            />
          </Field>
        </div>
        <Field label={t('privateKey')} hint={t('privateKeyHint')}>
          <TextArea
            rows={6}
            value={router.privateKey || ''}
            onChange={(event) => updateRouterSettings({ privateKey: event.target.value })}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </Field>
        <div className="button-row">
          <ActionButton icon={Save} busy={busy === 'save-settings'} onClick={onSave}>
            {t('saveSettings')}
          </ActionButton>
          <ActionButton icon={Cable} busy={busy === 'test-ssh'} onClick={onTest} variant="secondary">
            {t('testSsh')}
          </ActionButton>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading compact">
          <h2>{t('routerChecklist')}</h2>
          <ListChecks />
        </div>
        <ul className="checklist">
          <li>{t('checklistSsh')}</li>
          <li>{t('checklistJffs')}</li>
          <li>{t('checklistKeys')}</li>
        </ul>
        <div className="info-block">{t('firmwareNote')}</div>
        <div className="info-block warn">{t('asusConflictNote')}</div>
        <div className="info-block muted">{t('localStorageNote')}</div>
        <div className="storage-note">
          <strong>{t('docsStoredLocal')}</strong>
        </div>
        <div className="info-block">
          <strong>{t('panelPasswordReset')}</strong>
          <CodeBlock compact>{auth.resetCommand || "docker exec smartwan-manager node server/setPanelPassword.js admin 'new-strong-password'"}</CodeBlock>
        </div>
      </div>
    </section>
  );
}

function DashboardPanel({
  t,
  routerState,
  files,
  status,
  identity,
  connectionState,
  configForm,
  firmwareCompatibilityExpanded,
  onFirmwareCompatibilityExpandedChange,
  onSetup,
}) {
  const memory = routerState?.memory;
  const storage = routerState?.filesystems?.find((item) => item.mount === '/jffs') || routerState?.filesystems?.[0];
  const storagePercent = parsePercent(storage?.percent);
  const system = routerState?.system || {};
  const rawSmartwanEnabled = status.enabled === '1' || configForm.enabled;
  const jffsScriptsKnown = routerState?.jffs?.jffs2_scripts !== undefined;
  const jffsScriptsEnabled = routerState?.jffs?.jffs2_scripts === '1';
  const enabled = rawSmartwanEnabled && (!jffsScriptsKnown || jffsScriptsEnabled);
  const activePreset = status.active_preset || routerState?.config?.values?.active_preset || configForm.activePreset || 'DEFAULT';
  const detectedWan0 = routerState?.wanStatus?.find((wan) => wan.id === 'wan0');
  const detectedWan1 = routerState?.wanStatus?.find((wan) => wan.id === 'wan1');
  const wan0 = detectedWan0?.label || status.wan0_label || configForm.wan0Label || 'WAN0';
  const wan1 = detectedWan1?.label || status.wan1_label || configForm.wan1Label || 'WAN1';
  const logLines = routerState?.logs || t('noSmartwanLog');
  const routeLines = routerState?.routes || t('noRouteState');
  const security = routerState?.security || {};
  const keyAuthConnected = security.key_auth_selected === '1' && connectionState === 'connected';
  const panelKeyOk = security.panel_key_authorized === '1' || keyAuthConnected;
  const sshOk = connectionState === 'connected';
  const jffsOk = routerState?.jffs?.jffs2_scripts === '1';
  const smartwanScriptsOk = files.smartwanctl === '1';
  const smartwanConfigOk = files.smartwan_conf === '1';
  const merlinHooksOk = status.hooks_installed === '1';
  const securityOk = sshOk && jffsOk && panelKeyOk && smartwanScriptsOk && smartwanConfigOk && merlinHooksOk;
  const dualWanStatus = routerState?.dualWan || {};
  const failedWanId = status.watchdog_state_failed_wan || '';
  const failedWanName = failedWanId === 'wan0' ? wan0 : failedWanId === 'wan1' ? wan1 : failedWanId;
  const activeWanName = status.active_default_wan === 'wan0'
    ? wan0
    : status.active_default_wan === 'wan1'
      ? wan1
      : status.active_default_wan;
  const dashboardWans = routerState?.wanStatus || [];
  const dashboardAllWansDown = dashboardWans.length > 0
    && dashboardWans.every((wan) => !['ok', 'reachable'].includes(String(wan.internetStatus || '').toLowerCase()));
  const dashboardFailoverNotice = dashboardAllWansDown
    ? t('allWansOutageNotice')
      .replace('{reason}', outageReasonText(status.watchdog_state_failure_reason || 'all_wans_unreachable', t))
    : status.failover_override_active === '1' && failedWanName
      ? t('loginFailoverNotice')
      .replace(
        '{kind}',
        outageKindText(status.watchdog_state_failure_kind, t),
      )
      .replace('{wan}', `${failedWanName} (${failedWanId.toUpperCase()})`)
      .replace('{reason}', outageReasonText(status.watchdog_state_failure_reason, t))
      .replace('{active}', `${activeWanName} (${String(status.active_default_wan || '').toUpperCase()})`)
      : '';

  return (
    <section className="dashboard dashboard-reference">
      <CompatibilityBanner
        t={t}
        expanded={firmwareCompatibilityExpanded}
        onExpandedChange={onFirmwareCompatibilityExpandedChange}
      />

      <h1 className="page-title">{t('dashboard')}</h1>

      {dashboardFailoverNotice ? (
        <div className={`dashboard-failover-notice ${status.watchdog_state_failure_kind || 'complete'}`} role="alert">
          <AlertTriangle size={21} />
          <div>
            <strong>{dashboardFailoverNotice}</strong>
            {status.watchdog_state_failure_detail ? <small>{status.watchdog_state_failure_detail}</small> : null}
          </div>
        </div>
      ) : null}

      <div className="status-card-grid">
        <StatusCard
          icon={ShieldCheck}
          label={t('smartwanStatus')}
          value={enabled ? t('enabled') : t('disabled')}
          detail={rawSmartwanEnabled && jffsScriptsKnown && !jffsScriptsEnabled
            ? t('asusScriptsDisabled')
            : `${t('smartWanMode')}: ${t(status.effective_mode || (configForm.orchestrationEnabled ? 'dualwan_balanced_managed' : 'observe_only'))} / ${t('activePreset')}: ${activePreset}`}
          tone={enabled ? 'ok' : 'warn'}
        />
        <StatusCard
          icon={CheckCircle2}
          label={t('lastApply')}
          value={routerState ? t('success') : t('unknown')}
          detail={routerState ? t('routerStateLoaded') : t('waitingForRefresh')}
          tone={routerState ? 'ok' : 'muted'}
        />
        <StatusCard
          icon={Network}
          label={t('activeWanLabels')}
          value={`${wan0} / ${wan1}`}
          detail={`wan0: ${wan0}   wan1: ${wan1}`}
          tone="info"
        />
        <StatusCard
          icon={Terminal}
          label={t('sshConnection')}
          value={connectionState === 'connected' ? t('connected') : connectionState === 'offline' ? t('offline') : t('unknown')}
          detail={connectionState === 'connected' ? t('lastCheckNow') : t('useTestOrRefresh')}
          tone={connectionState === 'connected' ? 'ok' : 'muted'}
        />
        <StatusCard
          icon={Activity}
          label={t('smartwanDaemon')}
          value={status.watchdog_running === '1' ? t('running') : files.smartwanctl === '1' ? t('installed') : t('unknown')}
          detail={status.watchdog_running === '1' ? `PID: ${status.watchdog_pid || 'n/a'}` : files.smartwanctl === '1' ? t('watchdogStopped') : t('installScriptsFirst')}
          tone={status.watchdog_running === '1' ? 'ok' : 'muted'}
        />
      </div>

      <div className="dashboard-main-grid">
        <div className="panel memory-panel">
          <div className="panel-heading compact">
            <h2>{t('routerMemory')}</h2>
            <Gauge />
          </div>
          <div className="ring-grid">
            <RingMetric
              label="RAM usage"
              percent={memory?.usedPercent || 0}
              value={`${formatKb(memory?.usedKb)} / ${formatKb(memory?.totalKb)}`}
              tone="green"
            />
            <div className="memory-stats">
              <p><span>Total:</span> {formatKb(memory?.totalKb)}</p>
              <p><span>Used:</span> {formatKb(memory?.usedKb)}</p>
              <p><span>Free:</span> {formatKb(memory?.availableKb)}</p>
              <p><span>Firmware:</span> {identity.firmware || 'unknown'}</p>
            </div>
            <RingMetric
              label="Storage (JFFS)"
              percent={storagePercent}
              value={storage ? `${storage.used} / ${storage.size}` : 'n/a'}
              tone="blue"
            />
            <div className="memory-stats">
              <p><span>Total:</span> {storage?.size || 'n/a'}</p>
              <p><span>Used:</span> {storage?.used || 'n/a'}</p>
              <p><span>Free:</span> {storage?.available || 'n/a'}</p>
              <div className="mini-meter"><span style={{ width: `${storagePercent || 0}%` }} /></div>
            </div>
          </div>
          <div className="system-strip">
            <span>Load average <strong>{system.loadAverage || identity.uptime?.match(/load average: (.*)$/)?.[1] || 'n/a'}</strong></span>
            <span>CPU usage <strong>{system.cpuUsagePercent === null || system.cpuUsagePercent === undefined ? 'n/a' : `${system.cpuUsagePercent}%`}</strong></span>
            <span>Processes <strong>{system.processCount ?? 'n/a'}</strong></span>
            <span>Temperature <strong>{system.temperatureC === null || system.temperatureC === undefined ? 'n/a' : `${system.temperatureC} C`}</strong></span>
          </div>
        </div>

        <div className="panel security-panel">
          <div className="panel-heading compact">
            <h2>{t('setupSecurity')}</h2>
            {securityOk ? <span className="badge-ok">{t('configured')}</span> : <span className="badge-warn">{t('actionRequired')}</span>}
          </div>
          {!securityOk ? (
            <div className="alert-row">
              <ShieldCheck size={18} />
              <span>{t('setupSecurityCopy')}</span>
              <button type="button" onClick={onSetup}>{t('viewInstructions')}</button>
            </div>
          ) : null}
          <div className="security-checks">
            <CheckItem label={t('sshEnabledRouter')} ok={sshOk} />
            <CheckItem label={t('jffsScriptsConfigs')} ok={jffsOk} />
            <CheckItem
              label={t('panelKeyAdded')}
              ok={panelKeyOk}
              warnText={security.panel_key_expected === '1' ? t('pending') : t('keyAuthNotVerified')}
            />
            <CheckItem label={t('smartwanScriptsInstalled')} ok={smartwanScriptsOk} warnText={t('notFound')} />
            <CheckItem label={t('smartwanConfigDetected')} ok={smartwanConfigOk} warnText={t('notFound')} />
            <CheckItem label={t('merlinHooksInstalled')} ok={merlinHooksOk} warnText={t('notFound')} />
          </div>
          <ActionButton icon={ArrowRight} variant="secondary" onClick={onSetup}>
            {t('goToSetup')}
          </ActionButton>
        </div>
      </div>

      <WanOverviewPanel t={t} wanStatus={routerState?.wanStatus || []} status={status} />

      <div className="dashboard-lower-grid">
        <DashboardLogPanel t={t} logs={logLines} />
        <DashboardRoutesPanel t={t} routes={routeLines} smartwanActive={enabled} dualWanStatus={dualWanStatus} />
      </div>
    </section>
  );
}

function splitNonEmptyLines(value = '') {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanInlineStatus(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function logTone(line = '') {
  if (/error|failed|cannot|not available|missing/i.test(line)) return 'warn';
  if (/\[info\]|complete|installed|started/i.test(line)) return 'ok';
  return 'info';
}

function DashboardLogPanel({ t, logs }) {
  const [expanded, setExpanded] = useState(false);
  const lines = splitNonEmptyLines(logs);
  const visibleLogs = lines.slice(-50).join('\n') || logs;
  const lastLine = cleanInlineStatus(lines[lines.length - 1] || t('noData'));
  const warnings = lines.filter((line) => logTone(line) === 'warn').length;
  const applies = lines.filter((line) => /apply complete|main default route|watchdog/i.test(line)).length;

  return (
    <div className={`panel dashboard-code-panel log-health-panel ${expanded ? 'is-expanded' : ''}`}>
      <div className="panel-heading compact">
        <div>
          <h2>{t('smartwanLog')} <span>{t('last50Lines')}</span></h2>
          <p>{t('logPanelCopy')}</p>
        </div>
        <Terminal />
      </div>
      <div className="insight-strip">
        <div className={`insight-card ${logTone(lastLine)}`}>
          <Activity size={17} />
          <span>{t('lastEvent')}</span>
          <strong title={lastLine}>{lastLine}</strong>
        </div>
        <div className="insight-card">
          <CheckCircle2 size={17} />
          <span>{t('routingEvents')}</span>
          <strong>{applies}</strong>
        </div>
        <div className={`insight-card ${warnings ? 'warn' : 'ok'}`}>
          <ShieldCheck size={17} />
          <span>{t('warnings')}</span>
          <strong>{warnings}</strong>
        </div>
      </div>
      <CodeBlock compact>{visibleLogs}</CodeBlock>
      <button className="panel-expand-bar" type="button" onClick={() => setExpanded((value) => !value)}>
        {expanded ? t('collapsePanel') : t('expandPanel')}
      </button>
    </div>
  );
}

function summarizeRoutes(routes = '') {
  const lines = splitNonEmptyLines(routes);
  const smartwanTables = lines.filter((line) => /^--- route-smartwan-\d+ ---/.test(line)).map((line) => line.replace(/^--- route-smartwan-/, '').replace(/ ---$/, ''));
  return {
    fwmark: lines.filter((line) => line.startsWith('150:')).length,
    destinations: lines.filter((line) => /^16\d:/.test(line) || /^17\d:/.test(line)).length,
    destinationRules: lines.filter((line) => /:\s+from .* to /.test(line)).length,
    sources: lines.filter((line) => /^20\d:/.test(line)).length,
    asusRules: lines.filter((line) => /^100:|^150:|^200:|^400:/.test(line)).length,
    defaultLine: lines.find((line) => line.startsWith('default ')) || lines.find((line) => line.includes('default via')) || '',
    smartwanTables,
  };
}

function routeHasDualWanDefault(routes = '') {
  const mainRoute = String(routes || '').split('--- route-main ---')[1]?.split('--- route-smartwan-100 ---')[0] || '';
  return mainRoute.split(/\r?\n/).filter((line) => line.trim().startsWith('nexthop ')).length > 1;
}

function nativeDualWanEnabled(dualWanStatus, routes) {
  if (dualWanStatus?.enabled === true) {
    return true;
  }
  if (dualWanStatus?.enabled === '1' || dualWanStatus?.enabled === 'true') {
    return true;
  }
  return routeHasDualWanDefault(routes);
}

function dualWanStatusLabel(t, dualWanStatus, routes) {
  if (!nativeDualWanEnabled(dualWanStatus, routes)) {
    return t('disabled');
  }
  const ratio = dualWanStatus?.ratio ? ` ${dualWanStatus.ratio}` : '';
  if (dualWanStatus?.mode === 'fo') {
    return `${t('enabled')} / ${t('dualWanFailover')}${ratio}`;
  }
  if (dualWanStatus?.mode === 'lb') {
    return `${t('enabled')} / ${t('dualWanLoadBalance')}${ratio}`;
  }
  return t('enabled');
}

function DashboardRoutesPanel({ t, routes, smartwanActive, dualWanStatus }) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeRoutes(routes);
  return (
    <div className={`panel dashboard-code-panel route-health-panel ${expanded ? 'is-expanded' : ''}`}>
      <div className="panel-heading compact">
        <div>
          <h2>{t('importantRoutes')}</h2>
          <p>{smartwanActive ? t('routePanelCopy') : t('asusRoutePanelCopy')}</p>
        </div>
        <Route />
      </div>
      <RoutePriorityVisualizer routes={routes} t={t} smartwanActive={smartwanActive} />
      <div className="route-story">
        <div className="route-node">
          <Activity size={18} />
          <span>{t('smartWanMode')}</span>
          <strong>{smartwanActive ? t('enabled') : t('disabled')}</strong>
        </div>
        <div className="route-node wan">
          <Cable size={18} />
          <span>{t('dualWanModeStatus')}</span>
          <strong>{dualWanStatusLabel(t, dualWanStatus, routes)}</strong>
        </div>
        <div className="route-node">
          <Route size={18} />
          <span>{smartwanActive ? t('googleDestinations') : t('asusRules')}</span>
          <strong>{smartwanActive ? summary.destinations : summary.destinationRules}</strong>
        </div>
        <div className="route-node">
          <Activity size={18} />
          <span>{smartwanActive ? t('wanTables') : t('mainRoutingTable')}</span>
          <strong>{smartwanActive ? summary.smartwanTables.join(' / ') || 'n/a' : t('routerManaged')}</strong>
        </div>
      </div>
      <CodeBlock compact>{routes}</CodeBlock>
      <button className="panel-expand-bar" type="button" onClick={() => setExpanded((value) => !value)}>
        {expanded ? t('collapsePanel') : t('expandPanel')}
      </button>
    </div>
  );
}

function publicIpLabel(wan, t) {
  if (wan.publicIp) return wan.publicIp;
  if (wan.publicIpStatus === 'no_supported_tool') return t('publicIpNoTool');
  if (wan.publicIpStatus === 'probe_failed') return t('publicIpProbeFailed');
  if (wan.publicIpStatus) return t('notDetected');
  return 'n/a';
}

function publicIpSourceLabel(source, t) {
  if (source === 'panel:last-confirmed') return t('publicIpLastConfirmed');
  if (source === 'panel:default-route') return t('publicIpPanelDefault');
  if (source === 'panel:google-policy') return t('publicIpPanelGoogle');
  if (source?.startsWith('nvram:')) return t('publicIpRouterNvram');
  if (source?.startsWith('curl:') || source?.startsWith('curl-source:') || source?.startsWith('wget-') || source?.startsWith('nslookup:')) return t('publicIpRouterProbe');
  return source || '';
}

function wanLinkOk(wan) {
  return wan.carrier === '1' || wan.operstate === 'up' || Boolean(wan.ipaddr);
}

function wanIpOk(wan) {
  return Boolean(wan.ipaddr);
}

function wanInternetOk(wan) {
  return wan.internetStatus === 'ok';
}

function wanInternetLabel(wan, t) {
  if (wan.internetStatus === 'ok') return t('internetOk');
  if (wan.internetStatus === 'failed') return t('internetFailed');
  if (wan.internetStatus === 'no_ip') return t('internetNoIp');
  if (wan.internetStatus === 'no_interface') return t('internetNoInterface');
  if (wan.internetStatus === 'overridden') return t('internetOverridden');
  return t('internetNotChecked');
}

function wanHealthTone(wan) {
  if (!wanLinkOk(wan)) return 'offline';
  if (!wanIpOk(wan)) return 'warn';
  if (wanInternetOk(wan)) return 'online';
  if (wan.internetStatus === 'failed') return 'warn';
  return 'muted';
}

function WanOverviewPanel({ t, wanStatus, status }) {
  const active = status.active_default_wan || '';
  const roleLabel = (wan) => {
    if (wan.role === 'primary') return t('dualWanPrimary');
    if (wan.role === 'secondary') return t('dualWanSecondary');
    return wan.role || '';
  };
  return (
    <div className="panel wan-overview-panel">
      <div className="panel-heading compact">
        <h2>{t('wanOverview')}</h2>
        <Network />
      </div>
      <div className="wan-overview-grid">
        {wanStatus.map((wan) => {
          const linkOk = wanLinkOk(wan);
          const ipOk = wanIpOk(wan);
          const internetOk = wanInternetOk(wan);
          const healthTone = wanHealthTone(wan);
          return (
            <div className={`wan-card ${active === wan.id ? 'active' : ''} ${healthTone}`} key={wan.id}>
              <div className="wan-card-head">
                <span className={`status-dot ${internetOk ? 'online' : healthTone === 'offline' ? 'offline' : ''}`} />
                <div>
                  <strong>{wan.label || wan.id}</strong>
                  <p>
                    {wan.id} / {wan.ifname || 'n/a'} / {t('table')} {wan.table || 'n/a'}
                    {wan.asusPort ? ` / ${roleLabel(wan)}: ${wan.asusPort}` : ''}
                  </p>
                </div>
                {active === wan.id ? <em>{t('activeDefault')}</em> : null}
              </div>
              <div className="wan-health-row">
                <span className={linkOk ? 'ok' : 'bad'}>
                  <Cable size={14} />
                  {t('wanCableOrLink')}: <strong>{linkOk ? t('up') : t('down')}</strong>
                </span>
                <span className={ipOk ? 'ok' : 'bad'}>
                  <Network size={14} />
                  {t('wanDhcpOrIp')}: <strong>{ipOk ? t('detected') : t('notDetected')}</strong>
                </span>
                <span className={internetOk ? 'ok' : wan.internetStatus === 'failed' ? 'bad' : 'warn'}>
                  <Activity size={14} />
                  {t('wanInternet')}: <strong>{wanInternetLabel(wan, t)}</strong>
                </span>
              </div>
              <div className="wan-metrics">
                <span>{t('wanIp')} <strong>{wan.ipaddr || 'n/a'}</strong></span>
                <span>
                  {t('publicIp')}
                  <strong>{publicIpLabel(wan, t)}</strong>
                  {wan.publicIpSource ? (
                    <small>
                      {publicIpSourceLabel(wan.publicIpSource, t)}
                      {wan.publicIpStale && wan.publicIpConfirmedAt
                        ? ` · ${new Date(wan.publicIpConfirmedAt).toLocaleString()}`
                        : ''}
                    </small>
                  ) : null}
                </span>
                <span>{t('gateway')} <strong>{wan.gateway || 'n/a'}</strong></span>
                <span>
                  {t('state')}
                  <strong>{wan.operstate || (linkOk ? 'up' : 'n/a')}</strong>
                  {wan.internetTarget ? <small>{t('internetProbe')}: {wan.internetTarget}</small> : null}
                </span>
                <span>RX <strong>{formatBytes(wan.rxBytes)}</strong></span>
                <span>TX <strong>{formatBytes(wan.txBytes)}</strong></span>
              </div>
              <CodeBlock compact>{wan.defaultRoute || t('noWanDefaultRoute')}</CodeBlock>
            </div>
          );
        })}
      </div>
      <div className="wan-hints">
        <span>{t('watchdog')}: {status.watchdog_running === '1' ? `${t('running')} (PID ${status.watchdog_pid || 'n/a'})` : t('stopped')}</span>
        <span>{t('merlinHooks')}: {status.hooks_installed === '1' ? t('installed') : t('notInstalled')}</span>
        <span>{t('activeDefault')}: {active || 'n/a'}</span>
      </div>
    </div>
  );
}

function RoutePriorityVisualizer({ routes, t, smartwanActive }) {
  const lines = String(routes || '').split(/\r?\n/);
  const count = (predicate) => lines.filter(predicate).length;
  const groups = [
    {
      icon: Activity,
      label: smartwanActive ? t('priorityDomains') : t('asusPolicyRules'),
      detail: smartwanActive ? 'fwmark 150' : 'ASUS rules',
      count: count((line) => line.startsWith('150:')),
      tone: 'cyan',
    },
    {
      icon: Route,
      label: smartwanActive ? t('priorityDestinations') : t('googleDestinations'),
      detail: smartwanActive ? 'to / CIDR 160+' : 'to / service CIDR',
      count: smartwanActive
        ? count((line) => /^16\d:/.test(line) || /^17\d:/.test(line))
        : count((line) => /:\s+from .* to /.test(line)),
      tone: 'blue',
    },
    {
      icon: Network,
      label: t('prioritySources'),
      detail: smartwanActive ? 'from / LAN 200+' : 'from / ASUS',
      count: count((line) => /^20\d:/.test(line)),
      tone: 'green',
    },
    {
      icon: ArrowRight,
      label: t('priorityDefault'),
      detail: lines.find((line) => line.startsWith('default ')) || (smartwanActive ? 'main table' : 'ASUS main'),
      count: 1,
      tone: 'muted',
    },
  ];

  return (
    <div className="route-visualizer">
      {groups.map(({ icon: Icon, label, detail, count: total, tone }) => (
        <div className={`route-stage ${tone}`} key={label}>
          <Icon size={18} />
          <div>
            <strong>{label}</strong>
            <span>{detail}</span>
          </div>
          <em>{total}</em>
        </div>
      ))}
    </div>
  );
}

function CompatibilityBanner({ t, expanded, onExpandedChange }) {
  return (
    <section className={`compatibility-banner ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <button
        type="button"
        className="compatibility-toggle"
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span>{t('firmwareCompatibility')}</span>
        <span className="compatibility-toggle-hint">
          {expanded ? t('collapsePanel') : t('expandPanel')}
          <ChevronDown size={18} aria-hidden="true" />
        </span>
      </button>
      <div className="compatibility-content" hidden={!expanded}>
        <div>
          <p>{t('firmwareCompatibilityCopy')}</p>
          <p className="panel-purpose-note">{t('panelPurposeCopy')}</p>
          <p className="panel-purpose-note">{t('panelDependentCopy')}</p>
        </div>
        <div className="compatibility-links">
          <a href="https://gzenux.github.io/asuswrt-rtn18u/" target="_blank" rel="noreferrer">
            {t('firmwareProjectSite')}
          </a>
          <a href="https://github.com/gzenux/asuswrt-rtn18u" target="_blank" rel="noreferrer">
            {t('firmwareRepository')}
          </a>
          <a href="https://hattimon.github.io/SmartWAN-Manager/" target="_blank" rel="noreferrer">
            {t('smartwanManagerSite')}
          </a>
          <a href="https://github.com/hattimon/SmartWAN-Manager" target="_blank" rel="noreferrer">
            {t('smartwanManagerRepository')}
          </a>
        </div>
      </div>
    </section>
  );
}

function StatusCard({ icon: Icon, label, value, detail, tone }) {
  return (
    <div className={`status-card ${tone}`}>
      <Icon size={42} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function RingMetric({ label, percent, value, tone }) {
  return (
    <div className="ring-metric">
      <span>{label}</span>
      <div className={`ring ${tone}`} style={{ '--percent': `${Math.min(Math.max(percent || 0, 0), 100)}%` }}>
        <strong>{percent || 0}%</strong>
        <small>{value}</small>
      </div>
    </div>
  );
}

function CheckItem({ label, ok, warnText = 'Pending' }) {
  return (
    <div>
      <span className={ok ? 'check-ok' : 'check-warn'}>{ok ? '✓' : '⚠'}</span>
      <p>{label}</p>
      <strong className={ok ? 'ok' : 'warn'}>{ok ? 'OK' : warnText}</strong>
    </div>
  );
}

const dualWanTemplates = [
  {
    id: 'google',
    label: 'Google / YouTube / Gemini',
    unit: '1',
    destinations: googleYoutubeGeminiCidrs,
  },
  {
    id: 'google-dns',
    label: 'Google DNS only',
    unit: '1',
    destinations: ['8.8.8.0/24', '8.8.4.0/24'],
  },
  {
    id: 'cloudflare-dns',
    label: 'Cloudflare DNS',
    unit: '0',
    destinations: ['1.1.1.1/32', '1.0.0.1/32'],
  },
];

function normalizeDualWanRule(rule) {
  return {
    source: String(rule.source || '').trim(),
    destination: String(rule.destination || '').trim(),
    unit: String(rule.unit || '0') === '1' ? '1' : '0',
  };
}

function mergeDualWanRules(existing, additions) {
  const merged = [...(existing || []).map(normalizeDualWanRule).filter((rule) => rule.source && rule.destination)];
  for (const addition of additions.map(normalizeDualWanRule)) {
    if (!addition.source || !addition.destination) continue;
    const key = `${addition.source}|${addition.destination}|${addition.unit}`;
    if (!merged.some((rule) => `${rule.source}|${rule.destination}|${rule.unit}` === key)) {
      merged.push(addition);
    }
  }
  return merged.slice(0, 64);
}

function DmzPanel({
  t,
  policy,
  setPolicy,
  routerState,
  busy,
  onLoad,
  onApply,
}) {
  const form = { ...defaultDmzPolicy, ...(policy || {}) };
  const clients = (routerState?.clients || [])
    .filter((client, index, all) => (
      client.ip && all.findIndex((candidate) => candidate.ip === client.ip) === index
    ))
    .sort((left, right) => Number(right.active) - Number(left.active) || left.ip.localeCompare(right.ip));
  const wanStatus = routerState?.wanStatus || [];
  const wanLabel = (wanId) => {
    const wan = wanStatus.find((item) => item.id === wanId);
    return `${wan?.label || wanId.toUpperCase()} (${wanId.toUpperCase()})`;
  };
  const runtimeStatusKey = {
    active: 'dmzStatusActive',
    blocked_by_preferred_only: 'dmzStatusBlocked',
    inactive: 'dmzStatusInactive',
    native_asus: 'dmzStatusNative',
    invalid_target: 'dmzStatusInvalid',
    wan_unresolved: 'dmzStatusUnresolved',
    test_mode: 'dmzStatusTest',
  }[form.runtime?.status] || 'dmzStatusInactive';
  const runtimeWan = form.runtime?.wan && form.runtime.wan !== 'blocked'
    ? wanLabel(form.runtime.wan)
    : t('none');
  const update = (patch) => setPolicy((current) => ({ ...current, ...patch }));

  return (
    <section className="dmz-page">
      <div className="panel dmz-hero">
        <div>
          <div className="title-with-help">
            <h2>{t('dmzTitle')}</h2>
            <ContextHelp title={t('dmzHelpTitle')} t={t}>{t('dmzHelpCopy')}</ContextHelp>
          </div>
          <p>{t('dmzCopy')}</p>
        </div>
        <ShieldCheck size={34} />
      </div>

      <div className="panel-grid two dmz-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{t('dmzPolicyTitle')}</h2>
              <p>{t('dmzPolicyCopy')}</p>
            </div>
            <Globe2 />
          </div>

          <div className="switch-row">
            <Toggle
              checked={form.enabled}
              onChange={(enabled) => update({ enabled })}
              label={form.enabled ? t('enabled') : t('disabled')}
            />
          </div>

          <div className="form-grid">
            <Field label={t('dmzDetectedHost')}>
              <select
                value={clients.some((client) => client.ip === form.targetIp) ? form.targetIp : ''}
                onChange={(event) => {
                  if (event.target.value) update({ targetIp: event.target.value });
                }}
              >
                <option value="">{t('dmzSelectHost')}</option>
                {clients.map((client) => (
                  <option value={client.ip} key={client.ip}>
                    {client.name ? `${client.name} — ` : ''}{client.ip}{client.active ? ` · ${t('online')}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('dmzTargetIp')} helpText={t('dmzTargetIpHelp')} t={t}>
              <TextInput
                value={form.targetIp}
                onChange={(event) => update({ targetIp: event.target.value })}
                placeholder="192.168.1.50"
              />
            </Field>
            <Field label={t('dmzPreferredWan')} helpText={t('dmzPreferredWanHelp')} t={t}>
              <select value={form.preferredWan} onChange={(event) => update({ preferredWan: event.target.value })}>
                <option value="wan0">{wanLabel('wan0')}</option>
                <option value="wan1">{wanLabel('wan1')}</option>
              </select>
            </Field>
            <Field label={t('dmzFailoverMode')} helpText={t('dmzFailoverModeHelp')} t={t}>
              <select value={form.failoverMode} onChange={(event) => update({ failoverMode: event.target.value })}>
                <option value="follow_failover">{t('dmzFollowFailover')}</option>
                <option value="preferred_only">{t('dmzPreferredOnly')}</option>
              </select>
            </Field>
          </div>

          <div className={`dmz-mode-explainer ${form.failoverMode === 'preferred_only' ? 'warn' : 'ok'}`}>
            {form.failoverMode === 'preferred_only' ? <LockKeyhole size={20} /> : <RefreshCw size={20} />}
            <div>
              <strong>{form.failoverMode === 'preferred_only' ? t('dmzPreferredOnly') : t('dmzFollowFailover')}</strong>
              <p>{form.failoverMode === 'preferred_only' ? t('dmzPreferredOnlyCopy') : t('dmzFollowFailoverCopy')}</p>
            </div>
          </div>

          {form.native?.enabled ? (
            <div className="conflict-notice">
              <AlertTriangle size={18} />
              <span>{t('dmzNativeConflict').replace('{ip}', form.native.targetIp || t('notDetected'))}</span>
            </div>
          ) : null}
          {routerState?.config?.form?.enabled !== true ? (
            <div className="warning">{t('dmzSmartWanRequired')}</div>
          ) : null}
          <div className="warning dmz-security-warning">
            <AlertTriangle size={18} />
            <span>{t('dmzExposureWarning')}</span>
          </div>

          <div className="button-row">
            <ActionButton
              icon={RefreshCw}
              variant="secondary"
              busy={busy === 'dmz-load'}
              onClick={() => onLoad(true)}
            >
              {t('dmzRefresh')}
            </ActionButton>
            <ActionButton
              icon={Save}
              busy={busy === 'dmz-apply'}
              disabled={form.enabled && !form.targetIp}
              onClick={onApply}
            >
              {t('dmzApply')}
            </ActionButton>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{t('dmzRuntimeTitle')}</h2>
              <p>{t('dmzRuntimeCopy')}</p>
            </div>
            <Activity />
          </div>
          <div className="dmz-status-grid">
            <div>
              <span>{t('dmzRuntimeStatus')}</span>
              <strong>{t(runtimeStatusKey)}</strong>
            </div>
            <div>
              <span>{t('dmzRuntimeWan')}</span>
              <strong>{runtimeWan}</strong>
            </div>
            <div>
              <span>{t('dmzRuntimeTarget')}</span>
              <strong>{form.targetIp || t('notDetected')}</strong>
            </div>
            <div>
              <span>{t('dmzReturnRouting')}</span>
              <strong>{form.runtime?.returnRuleActive ? t('active') : t('inactive')}</strong>
            </div>
          </div>
          <div className="authority-unlock ok">
            <ShieldCheck size={20} />
            <div>
              <strong>{t('dmzPriorityTitle')}</strong>
              <p>{t('dmzPriorityCopy').replace('{priority}', form.runtime?.priority || '95')}</p>
            </div>
          </div>
          <CodeBlock compact>
            {[
              `target=${form.targetIp || 'n/a'}`,
              `preferred_wan=${form.preferredWan}`,
              `failover_mode=${form.failoverMode}`,
              `runtime_wan=${form.runtime?.wan || 'n/a'}`,
              `runtime_ifname=${form.runtime?.ifname || 'n/a'}`,
              `nat_chain=${form.runtime?.natChainActive ? 'active' : 'inactive'}`,
              `forward_chain=${form.runtime?.forwardChainActive ? 'active' : 'inactive'}`,
            ].join('\n')}
          </CodeBlock>
        </section>
      </div>
    </section>
  );
}

function DualWanPanel({
  t,
  language,
  dualWanState,
  groupsRefreshToken,
  dualWanForm,
  setDualWanForm,
  presets,
  presetName,
  setPresetName,
  onLoad,
  onApply,
  onLoadPresets,
  onSavePreset,
  onLoadPresetToEditor,
  onActivatePreset,
  onDeletePreset,
  busy,
  uiMode,
  smartWanStatus,
  localClients,
  wanStatus,
  onConflict,
}) {
  const level = uiModeLevels[uiMode];
  const [draft, setDraft] = useState({ source: '192.168.1.0/24', destination: '', unit: '1' });
  const form = { ...defaultDualWanForm, ...(dualWanForm || {}) };
  const rules = form.rules || [];
  const update = (patch) => {
    const resolved = resolveDualWanPatch(form, patch);
    setDualWanForm({ ...defaultDualWanForm, ...resolved.config });
    onConflict(resolved.messages);
  };
  const updateRule = (index, patch) => {
    update({
      rules: rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)),
    });
  };
  const unitLabel = (unit) => (String(unit) === '1' ? t('dualWanSecondary') : t('dualWanPrimary'));
  const primaryUnitLabel = smartWanStatus?.wan0_label
    ? `${smartWanStatus.wan0_label} (WAN0)`
    : `${t('dualWanPrimary')} (WAN0)`;
  const secondaryUnitLabel = smartWanStatus?.wan1_label
    ? `${smartWanStatus.wan1_label} (WAN1)`
    : `${t('dualWanSecondary')} (WAN1)`;
  const portBaseLabel = {
    wan: 'WAN',
    lan: 'Ethernet LAN',
    usb: 'USB',
    none: 'None',
  };
  const portOptionLabel = (port) => {
    if (port === 'none') return portBaseLabel.none;
    const assignedLabels = [];
    if (form.primary === port) {
      assignedLabels.push(smartWanStatus?.wan0_label || 'WAN0');
    }
    if (form.secondary === port) {
      assignedLabels.push(smartWanStatus?.wan1_label || 'WAN1');
    }
    const uniqueLabels = [...new Set(assignedLabels.filter(Boolean))];
    return uniqueLabels.length
      ? `${portBaseLabel[port] || port} (${uniqueLabels.join(' / ')})`
      : (portBaseLabel[port] || port);
  };

  function addRule(rule = draft) {
    const next = normalizeDualWanRule(rule);
    if (!next.source || !next.destination) return;
    update({ rules: mergeDualWanRules(rules, [next]) });
    setDraft((current) => ({ ...current, destination: '' }));
  }

  function removeRule(index) {
    update({ rules: rules.filter((_rule, ruleIndex) => ruleIndex !== index) });
  }

  function applyTemplate(template) {
    const source = draft.source.trim() || '192.168.1.0/24';
    const additions = template.id === 'google'
      ? buildGoogleYoutubeGeminiDualWanRules(source, template.unit)
      : template.destinations.map((destination) => ({
          source,
          destination,
          unit: template.unit,
        }));
    update({ routingEnabled: true, rules: mergeDualWanRules(rules, additions) });
  }

  function addSplitDefault(unit) {
    const source = draft.source.trim();
    if (!source) return;
    update({
      routingEnabled: true,
      rules: mergeDualWanRules(rules, [
        { source, destination: '1.0.0.0/1', unit },
        { source, destination: '128.0.0.0/1', unit },
      ]),
    });
  }

  return (
    <section className="dualwan-page">
      <div className="panel dualwan-hero">
        <div>
          <div className="title-with-help">
            <h2>{t('dualWan')}</h2>
            <ContextHelp title={t('helpDualWanTitle')} t={t}>{t('helpDualWanCopy')}</ContextHelp>
          </div>
          <p>{t('dualWanCopy')}</p>
        </div>
        <div className="dualwan-summary">
          <span><strong>{form.enabled ? t('enabled') : t('disabled')}</strong>{t('dualWanAvailable')}</span>
          <span><strong>{form.mode === 'fo' ? t('dualWanFailover') : t('dualWanLoadBalance')}</strong>{t('dualWanMode')}</span>
          <span><strong>{form.ratioPrimary}:{form.ratioSecondary}</strong>{t('dualWanRatio')}</span>
          <span><strong>{rules.length}/64</strong>{t('dualWanRoutes')}</span>
        </div>
      </div>

      <section className="panel-grid two">
        <div className="panel wide">
          <div className="panel-heading">
            <div>
              <h2>{t('dualWanAsusSettings')}</h2>
              <p>{t('dualWanAsusSettingsCopy')}</p>
            </div>
            <Cable />
          </div>
          <div className="switch-row">
            <Toggle checked={form.enabled} onChange={(value) => update({ enabled: value })} label={form.enabled ? t('enabled') : t('disabled')} />
            <Toggle checked={form.routingEnabled} disabled={!form.enabled} onChange={(value) => update({ routingEnabled: value })} label={t('dualWanRoutingRules')} />
          </div>
          <ConflictNotice
            messages={[
              ...(smartWanStatus?.failover_override_active === '1' ? ['conflictFailoverApplyBlocked'] : []),
              ...(form.mode === 'fo' && form.routingEnabled ? ['conflictDualWanFailoverRules'] : []),
            ]}
            t={t}
          />
          <div className="authority-unlock ok">
            <ShieldCheck size={20} />
            <div>
              <strong>{t('routingArchitectureTitle')}</strong>
              <p>{t('routingArchitectureCopy')}</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label={t('dualWanPrimary')}>
              <select value={form.primary} onChange={(event) => update({ primary: event.target.value })}>
                <option value="wan">{portOptionLabel('wan')}</option>
                <option value="lan">{portOptionLabel('lan')}</option>
                <option value="usb">{portOptionLabel('usb')}</option>
                <option value="none">{portOptionLabel('none')}</option>
              </select>
            </Field>
            <Field label={t('dualWanSecondary')}>
              <select value={form.secondary} onChange={(event) => update({ secondary: event.target.value })}>
                <option value="lan">{portOptionLabel('lan')}</option>
                <option value="wan">{portOptionLabel('wan')}</option>
                <option value="usb">{portOptionLabel('usb')}</option>
                <option value="none">{portOptionLabel('none')}</option>
              </select>
            </Field>
            <Field label={t('dualWanMode')} helpText={t('helpDualWanModeCopy')} t={t}>
              <select value={form.mode} onChange={(event) => update({ mode: event.target.value })}>
                <option value="lb">{t('dualWanLoadBalance')}</option>
                <option value="fo">{t('dualWanFailover')}</option>
              </select>
            </Field>
            <Field label={t('dualWanLanPort')}>
              <TextInput value={form.lanPort || ''} onChange={(event) => update({ lanPort: event.target.value })} placeholder="1" />
            </Field>
            <Field label={t('dualWanPrimaryWeight')} helpText={t('helpDualWanRatioCopy')} t={t}>
              <TextInput type="number" min="1" value={form.ratioPrimary} onChange={(event) => update({ ratioPrimary: event.target.value })} />
            </Field>
            <Field label={t('dualWanSecondaryWeight')}>
              <TextInput type="number" min="1" value={form.ratioSecondary} onChange={(event) => update({ ratioSecondary: event.target.value })} />
            </Field>
          </div>

          <DualWanServiceRouting
            t={t}
            language={language}
            rules={rules}
            routerRules={dualWanState?.form?.rules || []}
            refreshToken={groupsRefreshToken}
            onRulesChange={(nextRules) => update({ routingEnabled: true, rules: nextRules })}
            onApply={onApply}
            busy={busy}
            primaryLabel={primaryUnitLabel}
            secondaryLabel={secondaryUnitLabel}
            lanSubnet={smartWanStatus?.vpn_lan_subnet || '192.168.1.0/24'}
            vpnSubnet={smartWanStatus?.vpn_subnet || '10.8.0.0/24'}
            vpnInterface={smartWanStatus?.vpn_interface || 'tun21'}
            vpnAdditionalProfiles={smartWanStatus?.vpn_additional_profiles || ''}
            localClients={localClients}
            wanStatus={wanStatus}
          />

          <details className="manual-routing-editor">
            <summary>
              <div>
                <strong>{t('routingManualEditor')}</strong>
                <span>{t('routingManualEditorCopy')}</span>
              </div>
              <ChevronDown size={18} />
            </summary>
          <div className="routing-builder dualwan-builder">
            <div className="builder-head">
              <div>
                <h3>{t('dualWanRouteBuilder')}</h3>
                <p>{t('dualWanRouteBuilderCopy')}</p>
              </div>
              <span className="status-pill">{t('dualWanSource')}: {form.rulesSource || 'n/a'}</span>
            </div>
            <div className="builder-controls dualwan-controls">
              <TextInput value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })} placeholder="192.168.1.0/24" />
              <TextInput value={draft.destination} onChange={(event) => setDraft({ ...draft, destination: event.target.value })} placeholder="8.8.8.0/24" />
              <select value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })}>
                <option value="0">{t('dualWanPrimary')}</option>
                <option value="1">{t('dualWanSecondary')}</option>
              </select>
              <ActionButton icon={Plus} onClick={() => addRule()} disabled={!draft.source.trim() || !draft.destination.trim()}>
                {t('addBlock')}
              </ActionButton>
            </div>
            <div className="template-strip">
              <span>{t('popularTemplates')}</span>
              {dualWanTemplates.map((template) => (
                <button type="button" key={template.id} onClick={() => applyTemplate(template)}>
                  <Plus size={14} />
                  {template.label}
                </button>
              ))}
              <button type="button" onClick={() => addSplitDefault('0')}>
                <Plus size={14} />
                {t('dualWanForceDevicePrimary')}
              </button>
              <button type="button" onClick={() => addSplitDefault('1')}>
                <Plus size={14} />
                {t('dualWanForceDeviceSecondary')}
              </button>
            </div>

            <div className="dualwan-rule-table">
              <div className="dualwan-rule-head">
                <span>{t('dualWanSourceIp')}</span>
                <span>{t('dualWanDestinationIp')}</span>
                <span>{t('dualWanWanUnit')}</span>
                <span>{t('delete')}</span>
              </div>
              {rules.length ? rules.map((rule, index) => (
                <div className="dualwan-rule-row" key={`${rule.source}-${rule.destination}-${rule.unit}-${index}`}>
                  <TextInput value={rule.source} onChange={(event) => updateRule(index, { source: event.target.value })} />
                  <TextInput value={rule.destination} onChange={(event) => updateRule(index, { destination: event.target.value })} />
                  <select value={String(rule.unit)} onChange={(event) => updateRule(index, { unit: event.target.value })}>
                    <option value="0">{unitLabel('0')}</option>
                    <option value="1">{unitLabel('1')}</option>
                  </select>
                  <button type="button" onClick={() => removeRule(index)} aria-label={t('delete')}>
                    <Trash2 size={15} />
                  </button>
                </div>
              )) : <p className="empty">{t('dualWanNoRules')}</p>}
            </div>
          </div>
          </details>

          <div className="warning">{t('dualWanApplyWarning')}</div>
          <div className="button-row">
            <ActionButton icon={RefreshCw} variant="secondary" busy={busy === 'dualwan-load'} onClick={() => onLoad(true)}>
              {t('dualWanReadAsus')}
            </ActionButton>
            <ActionButton icon={Save} busy={busy === 'dualwan-apply'} disabled={smartWanStatus?.failover_override_active === '1'} onClick={onApply}>
              {t('dualWanApplyAsus')}
            </ActionButton>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading compact">
            <h2>{t('dualWanPresets')}</h2>
            <FileText />
          </div>
          <p className="body-copy">{t('dualWanPresetsCopy')}</p>
          <div className={`active-preset-banner ${presets.activePreset ? 'active' : ''}`}>
            <CheckCircle2 size={18} />
            <div>
              <span>{t('routerActivePreset')}</span>
              <strong>{presets.activePreset || t('notDetected')}</strong>
              {presets.activePresetMatchType === 'base' ? (
                <small>
                  {t('basePresetActive')} · {presets.additionalRuleCount} {t('additionalRouterRules')}
                </small>
              ) : null}
            </div>
          </div>
          <div className="form-grid single">
            <Field label={t('presetName')}>
              <TextInput value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="dualwan-policy" />
            </Field>
          </div>
          <div className="button-row">
            <ActionButton icon={Save} busy={busy === 'dualwan-save-preset'} onClick={onSavePreset} disabled={!presetName}>
              {t('saveCurrentAsPreset')}
            </ActionButton>
            <ActionButton icon={RefreshCw} variant="secondary" busy={busy === 'dualwan-presets'} onClick={() => onLoadPresets(true)}>
              {t('refreshRouterState')}
            </ActionButton>
          </div>
          <div className="preset-list dualwan-preset-list">
            {presets.presets?.length ? presets.presets.map((preset) => (
              <div className={`preset-row ${preset.active ? 'active' : ''}`} key={preset.name}>
                <div>
                  <strong>{preset.name}</strong>
                  <span>
                    {preset.active
                      ? (preset.matchType === 'base'
                          ? `${t('basePresetActive')} · +${preset.additionalRuleCount} ${t('additionalRouterRules')}`
                          : t('activePreset'))
                      : `${preset.ruleCount} ${t('dualWanRoutes')}`}
                  </span>
                </div>
                <div className="button-row tight">
                  <ActionButton icon={FileText} variant="secondary" onClick={() => onLoadPresetToEditor(preset.name)}>
                    {t('dualWanLoadEditor')}
                  </ActionButton>
                  <ActionButton icon={CheckCircle2} variant="secondary" busy={busy === 'dualwan-activate-preset'} disabled={smartWanStatus?.failover_override_active === '1'} onClick={() => onActivatePreset(preset.name)}>
                    {t('activate')}
                  </ActionButton>
                  <ActionButton icon={Trash2} variant="danger" busy={busy === 'dualwan-delete-preset'} onClick={() => onDeletePreset(preset.name)}>
                    {t('delete')}
                  </ActionButton>
                </div>
              </div>
            )) : <p className="empty">{t('noData')}</p>}
          </div>
          {level >= 3 ? (
            <>
              <h3>{t('dualWanRawAsus')}</h3>
              <CodeBlock compact>{dualWanState?.form?.rawRuleList || t('noData')}</CodeBlock>
            </>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function SmartWanPanel({
  t,
  configForm,
  setConfigForm,
  onRead,
  onApply,
  routerState,
  presets,
  presetName,
  setPresetName,
  onLoadPresets,
  onCreatePreset,
  onLoadPresetToEditor,
  onActivatePreset,
  onDeletePreset,
  busy,
  uiMode,
  dualWanForm,
  onConflict,
}) {
  const level = uiModeLevels[uiMode];
  const update = (patch) => {
    const resolved = resolveSmartWanPatch(configForm, patch);
    setConfigForm(resolved.config);
    onConflict(resolved.messages);
  };
  const status = routerState?.status || {};
  const domainRulesStored = Boolean(String(configForm.domainRules || '').trim());
  const failoverOverrideActive = status.failover_override_active === '1';
  const effectiveMode = status.effective_mode || (configForm.orchestrationEnabled ? 'dualwan_balanced_managed' : 'observe_only');
  const detectedWan0 = routerState?.wanStatus?.find((wan) => wan.id === 'wan0');
  const detectedWan1 = routerState?.wanStatus?.find((wan) => wan.id === 'wan1');
  const wan0Label = detectedWan0?.label || status.wan0_label || configForm.wan0Label || 'WAN0';
  const wan1Label = detectedWan1?.label || status.wan1_label || configForm.wan1Label || 'WAN1';
  const watchdogHint = t('watchdogTargetsHint')
    .replace('{wan0}', wan0Label)
    .replace('{wan1}', wan1Label);
  const wanLabel = (wan) => {
    if (wan === 'wan0') return wan0Label;
    if (wan === 'wan1') return wan1Label;
    return String(wan || t('notDetected')).toUpperCase();
  };
  const probeResultLabel = (result) => {
    const labels = {
      ok: t('probeResultOk'),
      internet_failed: t('probeResultInternetFailed'),
      partial_failure: t('probeResultPartialFailure'),
      complete_failure: t('probeResultCompleteFailure'),
      ok_icmp_unavailable: t('probeResultIcmpUnavailable'),
      link_down: t('probeResultLinkDown'),
      test_forced_down: t('probeResultTestForcedDown'),
      not_checked: t('probeResultNotChecked'),
    };
    return labels[result] || result || t('probeResultNotChecked');
  };
  const decisionLabel = (reason) => {
    if (!reason) return t('decisionNotRecorded');
    if (reason === 'all_wans_healthy') return t('decisionAllWansHealthy');
    if (reason === 'all_wans_recovering') return t('decisionAllWansRecovering');
    if (reason === 'all_wans_failed_or_unreachable') return t('decisionAllWansFailed');
    const match = reason.match(/^(wan[01])_failed_(wan[01])_ok$/);
    if (match) {
      return t('decisionWanFailed')
        .replace('{failed}', wanLabel(match[1]))
        .replace('{healthy}', wanLabel(match[2]));
    }
    const probeMatch = reason.match(/^(wan[01])_probe_failed$/);
    if (probeMatch) {
      return t('decisionProbeFailed').replace('{wan}', wanLabel(probeMatch[1]));
    }
    return reason;
  };
  const probeCard = (wan, label, detected) => {
    const prefix = `${wan}_health_`;
    const result = status[`${prefix}result`] || 'not_checked';
    const attempts = Number(status[`${prefix}attempts`] || 0);
    const successes = Number(status[`${prefix}successes`] || 0);
    const required = Number(status[`${prefix}required`] || 0);
    const tone = result === 'ok' ? 'ok' : (result === 'not_checked' ? 'muted' : 'warn');
    return {
      wan,
      label,
      interfaceName: status[`${wan}_ifname`] || detected?.ifname || t('notDetected'),
      result,
      resultLabel: probeResultLabel(result),
      attempts,
      successes,
      required,
      lastChecked: status[`${prefix}last_checked`] || t('notDetected'),
      lastSuccess: status[`${prefix}last_success`] || t('notDetected'),
      outageKind: status[`${prefix}outage_kind`] || 'none',
      failureReason: status[`${prefix}failure_reason`] || 'none',
      failureDetail: status[`${prefix}failure_detail`] || '',
      serviceResult: status[`${prefix}service_result`] || 'not_checked',
      serviceDetail: status[`${prefix}service_detail`] || '',
      tone,
    };
  };
  const wanProbeCards = [
    probeCard('wan0', wan0Label, detectedWan0),
    probeCard('wan1', wan1Label, detectedWan1),
  ];
  const watchdogRunning = status.watchdog_running === '1';
  const applyLockActive = status.apply_lock_active === '1';
  const runtimeDir = status.runtime_dir || configForm.runtimeDir || '/tmp';
  const flashSafe = runtimeDir === '/tmp' || runtimeDir.startsWith('/tmp/');
  const lastDecision = decisionLabel(status.watchdog_state_last_switch_reason);
  const activeWanLabel = wanLabel(status.active_default_wan);
  const failedWanLabel = status.watchdog_state_failed_wan
    ? wanLabel(status.watchdog_state_failed_wan)
    : t('none');
  const conflicts = smartWanConflictMessages(configForm, dualWanForm);
  return (
    <section className="panel-grid two smartwan-layout">
      <div className="panel wide">
        <div className="panel-heading">
          <div>
            <div className="title-with-help">
              <h2>{t('smartWan')}</h2>
              <ContextHelp title={t('helpSmartWanTitle')} t={t}>{t('helpSmartWanCopy')}</ContextHelp>
            </div>
            <p>{t('destructiveWarning')}</p>
          </div>
          <Network />
        </div>
        <div className="switch-row">
          <Toggle checked={configForm.enabled} onChange={(value) => update({ enabled: value })} label={configForm.enabled ? t('enabled') : t('disabled')} />
          <Toggle checked={configForm.testMode} onChange={(value) => update({ testMode: value })} label={t('testMode')} />
        </div>
        <div className={`orchestration-status ${failoverOverrideActive ? 'warn' : (configForm.orchestrationEnabled ? 'ok' : 'muted')}`}>
          <Activity size={20} />
          <div>
            <strong>{t('smartWanOrchestration')}</strong>
            <p>{failoverOverrideActive ? t('smartWanFailoverActiveCopy') : t('smartWanNormalCopy')}</p>
          </div>
          <span>{t('smartWanMode')}: {t(effectiveMode)}</span>
        </div>
        <SectionTitle
          t={t}
          helpTitle={t('helpOrchestrationTitle')}
          helpText={t('helpOrchestrationCopy')}
        >
          {t('smartWanOrchestration')}
        </SectionTitle>
        <div className="switch-row">
          <Toggle
            checked={configForm.orchestrationEnabled}
            onChange={(value) => update({ orchestrationEnabled: value })}
            label={configForm.orchestrationEnabled ? t('enabled') : t('disabled')}
          />
          {level >= 2 ? (
            <Toggle
              checked={configForm.autoDiscoverWans}
              onChange={(value) => update({ autoDiscoverWans: value })}
              label={t('autoDiscoverWans')}
            />
          ) : null}
        </div>
        <ConflictNotice messages={conflicts} t={t} />
        {configForm.orchestrationEnabled ? <>
        {level >= 2 ? <div className="form-grid">
          <Field label={t('healthProbePolicy')} helpText={t('helpHealthPolicyCopy')} t={t}>
            <select value={configForm.healthProbePolicy} onChange={(event) => update({ healthProbePolicy: event.target.value })}>
              <option value="majority">{t('healthMajority')}</option>
              <option value="all">{t('healthAll')}</option>
              <option value="any">{t('healthAny')}</option>
            </select>
          </Field>
          <Field label={t('rememberedDualWanPreset')} hint={t('rememberedDualWanPresetHint')}>
            <TextInput value={configForm.rememberedDualWanPreset} onChange={(event) => update({ rememberedDualWanPreset: event.target.value })} />
          </Field>
          <Field label={t('conntrackOnSwitch')}>
            <select value={configForm.conntrackOnSwitch} onChange={(event) => update({ conntrackOnSwitch: event.target.value })}>
              <option value="none">{t('conntrackNone')}</option>
              <option value="failed_wan">{t('conntrackFailedWan')}</option>
              <option value="all">{t('conntrackAll')}</option>
            </select>
          </Field>
        </div> : null}
        <div className="info-block">
          <div className="title-with-help">
            <strong>{t('monitoredWanPair')}</strong>
            <ContextHelp title={t('helpMonitoredWanPairTitle')} t={t}>
              {t('helpMonitoredWanPairCopy')}
            </ContextHelp>
          </div>
          <p>{wan0Label} (WAN0) · {wan1Label} (WAN1)</p>
        </div>
        {level >= 2 && configForm.orchestrationEnabled ? (
          <div className="owner-guide-card">
            <ShieldCheck size={20} />
            <div>
              <strong>{t('asusOwnsNormalRules')}</strong>
              <p>{t('asusOwnsNormalRulesCopy')}</p>
            </div>
          </div>
        ) : null}
        {level >= 2 ? <>
        <h3>{t('wanLabels')}</h3>
        <div className="form-grid">
          <Field label={t('wan0Label')}>
            <TextInput value={configForm.wan0Label} onChange={(event) => update({ wan0Label: event.target.value })} />
          </Field>
          <Field label={t('wan1Label')}>
            <TextInput value={configForm.wan1Label} onChange={(event) => update({ wan1Label: event.target.value })} />
          </Field>
        </div>
        </> : null}
        {level >= 3 ? <>
        <h3>{t('routingDetails')}</h3>
        <div className="form-grid">
          <Field label={t('wan0Ifname')}>
            <TextInput value={configForm.wan0Ifname} onChange={(event) => update({ wan0Ifname: event.target.value })} />
          </Field>
          <Field label={t('wan1Ifname')}>
            <TextInput value={configForm.wan1Ifname} onChange={(event) => update({ wan1Ifname: event.target.value })} />
          </Field>
          <Field label={t('wan0Gateway')}>
            <TextInput value={configForm.wan0Gateway} onChange={(event) => update({ wan0Gateway: event.target.value })} />
          </Field>
          <Field label={t('wan1Gateway')}>
            <TextInput value={configForm.wan1Gateway} onChange={(event) => update({ wan1Gateway: event.target.value })} />
          </Field>
          <Field label={`WAN0 ${t('table')}`}>
            <TextInput value={configForm.wan0Table} onChange={(event) => update({ wan0Table: event.target.value })} />
          </Field>
          <Field label={`WAN1 ${t('table')}`}>
            <TextInput value={configForm.wan1Table} onChange={(event) => update({ wan1Table: event.target.value })} />
          </Field>
        </div>
        {domainRulesStored ? (
          <div className="info-block muted">
            <strong>{t('domainRulesStoredButOff')}</strong>
            <CodeBlock compact>{configForm.domainRules}</CodeBlock>
            <ActionButton icon={Trash2} variant="secondary" onClick={() => update({ domainRules: '', domainRulesEnabled: false })}>
              {t('clearDomainRules')}
            </ActionButton>
          </div>
        ) : null}
        </> : null}
        <SectionTitle t={t} helpText={t('helpWatchdogCopy')}>{t('watchdogSettings')}</SectionTitle>
        {level >= 2 ? <>
        <Field label={t('watchdogTargets')} hint={watchdogHint}>
          <TextArea rows={3} value={configForm.watchdogTargets} onChange={(event) => update({ watchdogTargets: event.target.value })} />
        </Field>
        <div className="switch-row">
          <Toggle
            checked={configForm.watchdogServiceEnabled}
            onChange={(value) => update({ watchdogServiceEnabled: value })}
            label={t('watchdogHybridServiceChecks')}
          />
        </div>
        {configForm.watchdogServiceEnabled ? (
          <div className="switch-row">
            <Toggle
              checked={configForm.watchdogPartialFailoverEnabled}
              onChange={(value) => update({ watchdogPartialFailoverEnabled: value })}
              label={t('watchdogPartialFailover')}
            />
            <small>{t('watchdogPartialFailoverHint')}</small>
          </div>
        ) : null}
        {configForm.watchdogServiceEnabled ? (
          <Field label={t('watchdogServiceTargets')} hint={t('watchdogServiceTargetsHint')}>
            <TextArea rows={3} value={configForm.watchdogServiceTargets} onChange={(event) => update({ watchdogServiceTargets: event.target.value })} />
          </Field>
        ) : null}
        <div className="form-grid">
          <Field label={t('watchdogInterval')}>
            <TextInput value={configForm.watchdogInterval} onChange={(event) => update({ watchdogInterval: event.target.value })} />
          </Field>
          <Field label={t('watchdogFailCount')}>
            <TextInput value={configForm.watchdogFailCount} onChange={(event) => update({ watchdogFailCount: event.target.value })} />
          </Field>
          <Field label={t('watchdogRecoverCount')}>
            <TextInput value={configForm.watchdogRecoverCount} onChange={(event) => update({ watchdogRecoverCount: event.target.value })} />
          </Field>
          {configForm.watchdogServiceEnabled ? <Field label={t('watchdogServiceInterval')}>
            <TextInput value={configForm.watchdogServiceInterval} onChange={(event) => update({ watchdogServiceInterval: event.target.value })} />
          </Field> : null}
          {configForm.watchdogServiceEnabled ? <Field label={t('watchdogServiceTimeout')}>
            <TextInput value={configForm.watchdogServiceTimeout} onChange={(event) => update({ watchdogServiceTimeout: event.target.value })} />
          </Field> : null}
        </div>
        </> : null}
        {level >= 3 ? <>
        <h3>{t('flashProtection')}</h3>
        <div className="flash-policy-box">
          <ShieldCheck size={20} />
          <div>
            <strong>{t('flashSafeMode')}</strong>
            <p>{t('flashSafeModeCopy')}</p>
          </div>
        </div>
        </> : null}
        </> : (
          <div className="info-block muted">
            <strong>{t('smartWanOrchestration')}</strong>
            <p>{t('orchestratorDisabledCopy')}</p>
          </div>
        )}
        <div className="switch-row">
          <Toggle checked={configForm.logEnabled} onChange={(value) => update({ logEnabled: value })} label={configForm.logEnabled ? t('logsEnabledRam') : t('logsDisabled')} />
        </div>
        <div className="form-grid">
          <Field label={t('runtimeDir')} hint={t('runtimeDirHint')}>
            <TextInput value={configForm.runtimeDir} onChange={(event) => update({ runtimeDir: event.target.value })} />
          </Field>
          <Field label={t('logMaxLines')} hint={configForm.logEnabled ? t('logMaxLinesHint') : t('logsDisabledImpact')}>
            <TextInput value={configForm.logMaxLines} onChange={(event) => update({ logMaxLines: event.target.value })} />
          </Field>
        </div>
        <div className="button-row">
          <ActionButton icon={RefreshCw} busy={busy === 'read-config'} onClick={onRead} variant="secondary">
            {t('readRouterConfig')}
          </ActionButton>
          <ActionButton icon={Save} busy={busy === 'apply-config'} onClick={onApply}>
            {t('applyChanges')}
          </ActionButton>
        </div>
      </div>
      <div className="smartwan-side-stack">
        <SmartWanPresetManager
          t={t}
          presets={presets}
          presetName={presetName}
          setPresetName={setPresetName}
          onLoad={onLoadPresets}
          onCreate={onCreatePreset}
          onLoadPresetToEditor={onLoadPresetToEditor}
          onActivate={onActivatePreset}
          onDelete={onDeletePreset}
          busy={busy}
        />
        <div className="panel smartwan-routes-panel">
          <div className="panel-heading compact">
            <h2>{t('currentRoutes')}</h2>
            <Activity />
          </div>
          <CodeBlock>{routerState?.routes || t('noData')}</CodeBlock>
          {level >= 3 ? (
            <>
              <h3>{t('rawConfig')}</h3>
              <CodeBlock>{routerState?.config?.raw || t('noData')}</CodeBlock>
            </>
          ) : null}
        </div>
      </div>
      <div className="panel wide smartwan-diagnostics-panel">
        <div className="panel-heading">
          <div>
            <div className="title-with-help">
              <h2>{t('orchestratorDiagnostics')}</h2>
              <ContextHelp title={t('orchestratorDiagnosticsHelpTitle')} t={t}>
                {t('orchestratorDiagnosticsHelpCopy')}
              </ContextHelp>
            </div>
            <p>{t('orchestratorDiagnosticsCopy')}</p>
          </div>
          <Gauge />
        </div>

        <div className="smartwan-diagnostic-summary">
          <div className={watchdogRunning ? 'ok' : 'warn'}>
            <Activity size={18} />
            <div className="diagnostic-summary-label">
              <span>{t('watchdogProcess')}</span>
              <ContextHelp title={t('watchdogProcessHelpTitle')} t={t}>
                {t('watchdogProcessHelpCopy')}
              </ContextHelp>
            </div>
            <strong>{watchdogRunning ? t('running') : t('stopped')}</strong>
            <small>PID: {status.watchdog_pid || t('notDetected')}</small>
          </div>
          <div className={failoverOverrideActive ? 'warn' : 'ok'}>
            <Route size={18} />
            <div className="diagnostic-summary-label">
              <span>{t('emergencyOverride')}</span>
              <ContextHelp title={t('emergencyOverrideHelpTitle')} t={t}>
                {t('emergencyOverrideHelpCopy')}
              </ContextHelp>
            </div>
            <strong>{failoverOverrideActive ? t('active') : t('inactive')}</strong>
            <small>{t('routingPriority')}: {status.watchdog_failover_priority || '82'}</small>
          </div>
          <div className={applyLockActive ? 'warn' : 'ok'}>
            <LockKeyhole size={18} />
            <div className="diagnostic-summary-label">
              <span>{t('configurationLock')}</span>
              <ContextHelp title={t('configurationLockHelpTitle')} t={t}>
                {t('configurationLockHelpCopy')}
              </ContextHelp>
            </div>
            <strong>{applyLockActive ? t('busy') : t('free')}</strong>
            <small>{t('configurationLockCopy')}</small>
          </div>
          <div className={flashSafe ? 'ok' : 'warn'}>
            <ShieldCheck size={18} />
            <div className="diagnostic-summary-label">
              <span>{t('runtimeStorage')}</span>
              <ContextHelp title={t('runtimeStorageHelpTitle')} t={t}>
                {t('runtimeStorageHelpCopy')}
              </ContextHelp>
            </div>
            <strong>{flashSafe ? t('ramSafe') : t('flashRiskMode')}</strong>
            <small>{runtimeDir}</small>
          </div>
        </div>

        <div className="smartwan-diagnostic-grid">
          <div className="smartwan-diagnostic-card">
            <h3>{t('probePolicyStatus')}</h3>
            <dl>
              <div><dt>{t('healthProbePolicy')}</dt><dd>{t(status.health_probe_policy || configForm.healthProbePolicy || 'majority')}</dd></div>
              <div><dt>{t('watchdogInterval')}</dt><dd>{status.watchdog_interval || configForm.watchdogInterval || '—'} s</dd></div>
              <div><dt>{t('watchdogFailCount')}</dt><dd>{status.watchdog_fail_count || configForm.watchdogFailCount || '—'}</dd></div>
              <div><dt>{t('watchdogRecoverCount')}</dt><dd>{status.watchdog_recover_count || configForm.watchdogRecoverCount || '—'}</dd></div>
              <div><dt>{t('probeTimeout')}</dt><dd>{status.watchdog_probe_timeout || '1'} s</dd></div>
              <div><dt>{t('failoverTarget')}</dt><dd>≤ {status.failover_target_seconds || '5'} s</dd></div>
            </dl>
            <div className="diagnostic-targets">
              <span>{t('watchdogTargets')}</span>
              <code>{status.watchdog_targets || configForm.watchdogTargets || t('notDetected')}</code>
            </div>
          </div>

          <div className="smartwan-diagnostic-card">
            <h3>{t('lastOrchestratorDecision')}</h3>
            <div className="diagnostic-decision">
              <Workflow size={22} />
              <strong>{lastDecision}</strong>
            </div>
            <dl>
              <div><dt>{t('activeDefault')}</dt><dd>{activeWanLabel}</dd></div>
              <div><dt>{t('failedWan')}</dt><dd>{failedWanLabel}</dd></div>
              <div><dt>{t('failureCounter')}</dt><dd>{status.watchdog_state_failures || '0'}</dd></div>
              <div><dt>{t('recoveryCounter')}</dt><dd>{status.watchdog_state_recoveries || '0'}</dd></div>
              <div><dt>{t('lastFailover')}</dt><dd>{status.watchdog_state_last_failover_at || t('notDetected')}</dd></div>
              <div><dt>{t('lastRecovery')}</dt><dd>{status.watchdog_state_last_recovery_at || t('notDetected')}</dd></div>
            </dl>
          </div>
        </div>

        <div className="wan-probe-status-grid">
          {wanProbeCards.map((probe) => (
            <div className={`wan-probe-status-card ${probe.tone}`} key={probe.wan}>
              <div className="wan-probe-status-head">
                <div>
                  <span>{probe.wan.toUpperCase()} · {probe.interfaceName}</span>
                  <strong>{probe.label}</strong>
                </div>
                <span className="probe-result">{probe.resultLabel}</span>
              </div>
              <div className="probe-quorum">
                <span>{t('probeResponses')}</span>
                <strong>{probe.successes}/{probe.attempts}</strong>
                <small>{t('probeRequired')}: {probe.required}</small>
              </div>
              <dl>
                <div><dt>{t('lastProbe')}</dt><dd>{probe.lastChecked}</dd></div>
                <div><dt>{t('lastSuccessfulProbe')}</dt><dd>{probe.lastSuccess}</dd></div>
                {probe.outageKind !== 'none' ? <div><dt>{t('failureType')}</dt><dd>{outageKindText(probe.outageKind, t)}</dd></div> : null}
                {probe.failureReason !== 'none' ? <div><dt>{t('diagnosis')}</dt><dd>{outageReasonText(probe.failureReason, t)}</dd></div> : null}
                <div><dt>{t('serviceProbe')}</dt><dd>{probe.serviceResult}</dd></div>
              </dl>
              {probe.failureDetail || probe.serviceDetail ? <small>{probe.failureDetail || probe.serviceDetail}</small> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SmartWanPresetManager({
  t,
  presets,
  presetName,
  setPresetName,
  onLoad,
  onCreate,
  onLoadPresetToEditor,
  onActivate,
  onDelete,
  busy,
}) {
  return (
    <div className="panel smartwan-preset-panel">
      <div className="panel-heading">
        <div>
          <h2>{t('smartWanPresets')}</h2>
          <p>{t('smartWanPresetsCopy')}</p>
        </div>
        <FileText />
      </div>
      <div className="smartwan-preset-grid">
        <div>
          <h3>{t('createPreset')}</h3>
          <p className="body-copy">{t('smartWanPresetEditorCopy')}</p>
          <div className="form-grid single">
            <Field label={t('presetName')}>
              <TextInput value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="smartwan-failover" />
            </Field>
          </div>
          <div className="button-row">
            <ActionButton icon={Save} busy={busy === 'create-preset'} onClick={onCreate} disabled={!presetName}>
              {t('saveCurrentAsPreset')}
            </ActionButton>
            <ActionButton icon={RefreshCw} busy={busy === 'presets'} onClick={() => onLoad(true)} variant="secondary">
              {t('refreshRouterState')}
            </ActionButton>
          </div>
          <div className="info-block">{t('docsStoredRouter')}</div>
        </div>
        <div>
          <h3>{t('activePreset')}: {presets.activePreset || 'none'}</h3>
          <p className="body-copy">{t('smartWanPresetActivationCopy')}</p>
          <div className="preset-list">
            {presets.presets?.length ? (
              presets.presets.map((preset) => (
                <div className={`preset-row ${presets.activePreset === preset.name ? 'active' : ''}`} key={preset.name}>
                  <div>
                    <strong>{preset.name}</strong>
                    <span>{presets.activePreset === preset.name ? t('activePreset') : `${preset.size} bytes`}</span>
                  </div>
                  <div className="button-row tight">
                    <ActionButton icon={FileText} onClick={() => onLoadPresetToEditor(preset.name)} variant="secondary">
                      {t('dualWanLoadEditor')}
                    </ActionButton>
                    <ActionButton icon={CheckCircle2} onClick={() => onActivate(preset.name)} variant="secondary">
                      {t('activate')}
                    </ActionButton>
                    <ActionButton icon={Trash2} onClick={() => onDelete(preset.name)} variant="danger">
                      {t('delete')}
                    </ActionButton>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty">{t('noData')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SshKeyPanel({ t, panelKey, keyOptions, setKeyOptions, onGenerate, onReadHostKey, hostKeys, busy }) {
  return (
    <section className="panel-grid two">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>{t('generatePanelKey')}</h2>
            <p>{t('copyThisPublicKey')}</p>
          </div>
          <KeyRound />
        </div>
        <Field label={t('keyComment')}>
          <TextInput value={keyOptions.comment} onChange={(event) => setKeyOptions({ ...keyOptions, comment: event.target.value })} />
        </Field>
        <Field label={t('passphrase')}>
          <TextInput
            type="password"
            value={keyOptions.passphrase}
            onChange={(event) => setKeyOptions({ ...keyOptions, passphrase: event.target.value })}
          />
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={keyOptions.overwrite}
            onChange={(event) => setKeyOptions({ ...keyOptions, overwrite: event.target.checked })}
          />
          {t('overwriteKey')}
        </label>
        <ActionButton icon={KeyRound} busy={busy === 'generate-key'} onClick={onGenerate}>
          {t('generatePanelKey')}
        </ActionButton>
        <h3>{t('generatedPublicKey')}</h3>
        <CodeBlock>{panelKey?.publicKey || t('noData')}</CodeBlock>
        {panelKey?.fingerprint ? <div className="fingerprint">{panelKey.fingerprint}</div> : null}
      </div>
      <div className="panel">
        <div className="panel-heading compact">
          <h2>{t('hostFingerprint')}</h2>
          <ShieldCheck />
        </div>
        <p className="body-copy">
          Verify the router host key once, then keep using SSH keys for encrypted panel-to-router communication.
        </p>
        <ActionButton icon={ShieldCheck} busy={busy === 'host-key'} onClick={onReadHostKey} variant="secondary">
          {t('hostFingerprint')}
        </ActionButton>
        <div className="host-key-list">
          {hostKeys.length ? (
            hostKeys.map((key) => (
              <div className="host-key" key={key.line}>
                <strong>{key.fingerprint}</strong>
                <CodeBlock compact>{key.line}</CodeBlock>
              </div>
            ))
          ) : (
            <p className="empty">{t('noData')}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ScriptsPanel({
  t,
  files,
  preserveConfig,
  setPreserveConfig,
  onInstall,
  routerState,
  onRefresh,
  busy,
}) {
  return (
    <>
      <RouterSetupWizard t={t} routerState={routerState} onRefresh={onRefresh} />
      <section className="panel-grid two">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>{t('installScripts')}</h2>
              <p>{t('installScriptsCopy')}</p>
            </div>
            <UploadCloud />
          </div>
          <label className="check-row">
            <input type="checkbox" checked={preserveConfig} onChange={(event) => setPreserveConfig(event.target.checked)} />
            {t('preserveConfig')}
          </label>
          <div className="warning">{t('destructiveWarning')}</div>
          <ActionButton icon={UploadCloud} busy={busy === 'install-scripts'} onClick={onInstall}>
            {t('installScripts')}
          </ActionButton>
        </div>
        <div className="panel">
          <div className="panel-heading compact">
            <h2>{t('scriptState')}</h2>
            <Settings />
          </div>
          <div className="capability-list">
            {Object.entries(files).length ? (
              Object.entries(files).map(([key, value]) => (
                <div key={key}>
                  <span>{key}</span>
                  <strong className={value === '1' ? 'ok' : 'warn'}>{value}</strong>
                </div>
              ))
            ) : (
              <p className="empty">{t('noData')}</p>
            )}
          </div>
          <h3>{t('lastApply')}</h3>
          <CodeBlock>{routerState?.sections?.smartwan_status || t('noData')}</CodeBlock>
        </div>
      </section>
    </>
  );
}

function BackupPanel({
  t,
  routerState,
  backupFile,
  backupRestore,
  setBackupRestore,
  onCreateBackup,
  onUpload,
  onRestore,
  busy,
}) {
  const status = routerState?.status || {};
  const runtimeDir = status.runtime_dir || routerState?.config?.values?.runtime_dir || '/tmp';
  const logEnabled = (status.log_enabled || routerState?.config?.values?.log_enabled || '1') !== '0';
  const flashSafe = runtimeDir === '/tmp' || runtimeDir.startsWith('/tmp/');
  const update = (patch) => setBackupRestore((current) => ({ ...current, ...patch }));
  return (
    <section className="panel-grid two backup-page">
      <div className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>{t('backup')}</h2>
            <p>{t('backupCopy')}</p>
          </div>
          <Save />
        </div>
        <div className="backup-action-grid">
          <ActionButton icon={Save} busy={busy === 'backup-full'} onClick={() => onCreateBackup('full')}>
            {t('backupFull')}
          </ActionButton>
          <ActionButton icon={Server} variant="secondary" busy={busy === 'backup-router'} onClick={() => onCreateBackup('router')}>
            {t('backupRouterOnly')}
          </ActionButton>
          <ActionButton icon={UploadCloud} variant="secondary" busy={busy === 'backup-smartwan'} onClick={() => onCreateBackup('smartwan')}>
            {t('backupSmartWanOnly')}
          </ActionButton>
        </div>

        <h3>{t('restoreBackup')}</h3>
        <Field label={t('backupUpload')} hint={t('backupUploadHint')}>
          <input type="file" accept="application/json,.json" onChange={onUpload} />
        </Field>
        {backupFile ? (
          <div className="backup-file-summary">
            <FileText size={18} />
            <div>
              <strong>{backupFile.name}</strong>
              <span>{backupFile.backup?.kind || 'unknown'} / {backupFile.backup?.createdAt || 'n/a'}</span>
            </div>
          </div>
        ) : null}

        <div className="restore-grid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={backupRestore.restoreRouter}
              onChange={(event) => update({ restoreRouter: event.target.checked })}
            />
            <span>
              <strong>{t('restoreRouterSettings')}</strong>
              <small>{t('restoreRouterSettingsImpact')}</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={backupRestore.restoreSmartwan}
              onChange={(event) => update({ restoreSmartwan: event.target.checked })}
            />
            <span>
              <strong>{t('restoreSmartWanSettings')}</strong>
              <small>{t('restoreSmartWanSettingsImpact')}</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={backupRestore.restartWan}
              onChange={(event) => update({ restartWan: event.target.checked })}
            />
            <span>
              <strong>{t('restartWanAfterRestore')}</strong>
              <small>{t('restartWanAfterRestoreImpact')}</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={backupRestore.installHooks}
              onChange={(event) => update({ installHooks: event.target.checked })}
            />
            <span>
              <strong>{t('restoreHooks')}</strong>
              <small>{t('restoreHooksImpact')}</small>
            </span>
          </label>
        </div>
        <Field label={t('restoreConfirm')} hint={t('restoreConfirmHint')}>
          <TextInput value={backupRestore.confirm} onChange={(event) => update({ confirm: event.target.value })} placeholder="RESTORE" />
        </Field>
        <ActionButton
          icon={UploadCloud}
          variant="danger"
          busy={busy === 'backup-restore'}
          disabled={!backupFile || backupRestore.confirm !== 'RESTORE'}
          onClick={onRestore}
        >
          {t('restoreBackup')}
        </ActionButton>
      </div>

      <div className="panel backup-guide">
        <div className="panel-heading compact">
          <h2>{t('backupChecklist')}</h2>
          <ListChecks />
        </div>
        <ol className="backup-steps">
          <li>{t('backupStep1')}</li>
          <li>{t('backupStep2')}</li>
          <li>{t('backupStep3')}</li>
          <li>{t('backupStep4')}</li>
          <li>{t('backupStep5')}</li>
        </ol>
        <h3>{t('flashProtection')}</h3>
        <div className={`flash-status-card ${flashSafe ? 'ok' : 'warn'}`}>
          <ShieldCheck size={18} />
          <div>
            <strong>{flashSafe ? t('flashSafeMode') : t('flashRiskMode')}</strong>
            <p>{flashSafe ? t('flashSafeModeCopy') : t('flashRiskModeCopy')}</p>
          </div>
        </div>
        <div className="capability-list">
          <div>
            <span>{t('runtimeDir')}</span>
            <strong className={flashSafe ? 'ok' : 'warn'}>{runtimeDir}</strong>
          </div>
          <div>
            <span>{t('logs')}</span>
            <strong className={logEnabled ? 'ok' : 'warn'}>{logEnabled ? t('logsEnabledRam') : t('logsDisabled')}</strong>
          </div>
          <div>
            <span>JFFS</span>
            <strong>{t('jffsScriptsOnly')}</strong>
          </div>
        </div>
        <div className="warning">{t('backupRestoreWarning')}</div>
      </div>
    </section>
  );
}

function LogsPanel({ t, routerState }) {
  const lines = splitNonEmptyLines(routerState?.logs || '');
  const warnings = lines.filter((line) => logTone(line) === 'warn').length;
  const lastLine = cleanInlineStatus(lines[lines.length - 1] || t('noData'));
  const [eventData, setEventData] = useState({ events: [], viewer: null, routing: null, monitoring: null });
  const [eventError, setEventError] = useState('');
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    wan: '',
    operator: '',
    type: '',
    profile: '',
    device: '',
    source: '',
  });

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const data = await api.get('/api/events');
        if (!cancelled) {
          setEventData(data);
          setEventError('');
        }
      } catch (error) {
        if (!cancelled) setEventError(error.message);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const unique = (key) => [...new Set(eventData.events.map((event) => event[key]).filter(Boolean))];
  const filteredEvents = eventData.events.filter((event) => {
    const eventDate = new Date(event.endedAt || event.startedAt).getTime();
    if (filters.from && eventDate < new Date(`${filters.from}T00:00:00`).getTime()) return false;
    if (filters.to && eventDate > new Date(`${filters.to}T23:59:59`).getTime()) return false;
    if (filters.wan && event.wanId !== filters.wan) return false;
    if (filters.operator && event.operator !== filters.operator) return false;
    if (filters.type && event.type !== filters.type) return false;
    if (filters.profile && event.profile !== filters.profile) return false;
    if (filters.device && event.device !== filters.device) return false;
    if (filters.source && event.source !== filters.source) return false;
    return true;
  });
  const eventWanStatus = eventData.routing?.wanStatus || routerState?.wanStatus || [];
  const presentedEvents = filteredEvents.map((event) => {
    const copy = presentEventCopy(event, t, eventWanStatus);
    return {
      ...event,
      wanLabel: copy.wan,
      summary: copy.summary,
      action: copy.action,
    };
  });

  function downloadEvents(format) {
    let content;
    let type;
    if (format === 'json') {
      content = `${JSON.stringify(presentedEvents, null, 2)}\n`;
      type = 'application/json';
    } else {
      const columns = ['startedAt', 'endedAt', 'durationSeconds', 'wanId', 'wanLabel', 'operator', 'type', 'source', 'profile', 'device', 'summary', 'action'];
      const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
      content = [columns.join(','), ...presentedEvents.map((event) => columns.map((column) => escape(event[column])).join(','))].join('\n');
      type = 'text/csv';
    }
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `smartwan-events-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const viewer = eventData.viewer || {};
  const routing = eventData.routing || {};
  return (
    <section className="panel-grid single">
      <div className="panel event-log-panel">
        <div className="panel-heading">
          <div>
            <h2>{t('wanEventHistory')}</h2>
            <p>{t('wanEventHistoryCopy')}</p>
          </div>
          <Clock3 />
        </div>

        <div className="event-context-grid">
          <div><span>{t('currentDevice')}</span><strong>{viewer.name ? `${viewer.name} — ${viewer.ip}` : viewer.ip || t('unknown')}</strong></div>
          <div><span>{t('routingProfile')}</span><strong>{viewer.profile || routing.profile || t('unknown')}</strong></div>
          <div><span>{t('activeWan')}</span><strong>{viewer.assignedWanLabel || routing.activeWanLabel || t('unknown')}</strong></div>
          <div><span>{t('monitorThresholds')}</span><strong>{eventData.monitoring ? `${eventData.monitoring.failThreshold} / ${eventData.monitoring.recoveryThreshold} · ${eventData.monitoring.intervalSeconds}s` : t('unknown')}</strong></div>
        </div>
        {eventData.eventStorage?.persistent ? (
          <p className="event-storage-note"><ShieldCheck size={14} />{t('persistentEventArchive')}</p>
        ) : null}
        <p className="event-routing-description">{viewerRoutingDescription(viewer, t)}</p>

        <div className="event-filter-grid">
          <Field label={t('dateFrom')}><TextInput type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></Field>
          <Field label={t('dateTo')}><TextInput type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></Field>
          <Field label="WAN"><select value={filters.wan} onChange={(event) => setFilters({ ...filters, wan: event.target.value })}><option value="">{t('all')}</option>{unique('wanId').map((value) => <option value={value} key={value}>{wanDisplayName(value, eventWanStatus)}</option>)}</select></Field>
          <Field label={t('operator')}><select value={filters.operator} onChange={(event) => setFilters({ ...filters, operator: event.target.value })}><option value="">{t('all')}</option>{unique('operator').map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label={t('eventType')}><select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">{t('all')}</option>{unique('type').map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label={t('routingProfile')}><select value={filters.profile} onChange={(event) => setFilters({ ...filters, profile: event.target.value })}><option value="">{t('all')}</option>{unique('profile').map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label={t('device')}><select value={filters.device} onChange={(event) => setFilters({ ...filters, device: event.target.value })}><option value="">{t('all')}</option>{unique('device').map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label={t('actionSource')}><select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}><option value="">{t('all')}</option>{unique('source').map((value) => <option key={value}>{value}</option>)}</select></Field>
        </div>

        <div className="button-row tight">
          <ActionButton icon={Download} variant="secondary" onClick={() => downloadEvents('csv')}>{t('exportCsv')}</ActionButton>
          <ActionButton icon={Download} variant="secondary" onClick={() => downloadEvents('json')}>{t('exportJson')}</ActionButton>
          <span className="event-result-count">{filteredEvents.length} / {eventData.events.length}</span>
        </div>
        {eventError ? <div className="notice error">{eventError}</div> : null}
        <PublicEventList t={t} events={filteredEvents} wanStatus={eventWanStatus} expanded />
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>{t('recentLog')}</h2>
            <p>{t('logPanelCopy')}</p>
          </div>
          <Terminal />
        </div>
        <div className="log-summary-grid">
          <div className={`insight-card ${logTone(lastLine)}`}>
            <Activity size={17} />
            <span>{t('lastEvent')}</span>
            <strong title={lastLine}>{lastLine}</strong>
          </div>
          <div className={`insight-card ${warnings ? 'warn' : 'ok'}`}>
            <ShieldCheck size={17} />
            <span>{t('warnings')}</span>
            <strong>{warnings}</strong>
          </div>
        </div>
        <CodeBlock>{routerState?.logs || t('noData')}</CodeBlock>
      </div>
    </section>
  );
}

function countConfiguredRules(value = '') {
  return String(value || '')
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function inferGoogleWanFromRoutes(routes = '', wanStatus = []) {
  const googleDestination =
    /\b(?:8\.8\.[48]|34\.(?:102|117|120|160)|64\.(?:18|233)|66\.102|72\.14|74\.125|108\.17[07]|142\.250|172\.(?:217|253)|173\.194|192\.178|199\.36|208\.(?:65|117)|209\.85|216\.(?:58|239))\./;
  for (const line of String(routes || '').split(/\r?\n/)) {
    if (!googleDestination.test(line) || !/\bto\b/.test(line)) continue;
    const match = wanStatus.find((wan) => line.includes(`lookup ${wan.id}`) || (wan.table && line.includes(`lookup ${wan.table}`)));
    if (match) return match.id;
  }
  return '';
}

function activeDefaultFromWanStatus(wanStatus = []) {
  return wanStatus.find((wan) => wan.active || wan.defaultRoute)?.id || '';
}

function analyzeRoutingLogic(routerState) {
  const routes = routerState?.routes || '';
  const routeSummary = summarizeRoutes(routes);
  const status = routerState?.status || {};
  const configValues = routerState?.config?.values || {};
  const smartwanActive = status.enabled === '1' || routerState?.config?.form?.enabled === true;
  const orchestrationActive =
    status.orchestration_enabled === '1'
    || routerState?.config?.form?.orchestrationEnabled === true;
  const dualWanStatus = routerState?.dualWan || {};
  const dualWanEnabled = nativeDualWanEnabled(dualWanStatus, routes);
  const dualWanRoutingEnabled = dualWanStatus.routingEnabled === true || dualWanStatus.routingEnabled === '1';
  const wanStatus = routerState?.wanStatus || [];
  const smartwanRuleCount =
    countConfiguredRules(configValues.service_rules) +
    countConfiguredRules(configValues.host_rules);
  const asusPriorityRules = String(routes || '').split(/\r?\n/).filter((line) => /^100:/.test(line)).length;
  const asusRules = Number(dualWanStatus.ruleCount || 0) || asusPriorityRules || routeSummary.asusRules;
  const smartwanIpRules =
    routeSummary.fwmark +
    routeSummary.destinations +
    routeSummary.sources;
  const failoverOverrideRules = String(routes || '').split(/\r?\n/).filter((line) => /^82:/.test(line)).length;
  const smartwanHasRules = smartwanRuleCount > 0 || smartwanIpRules > 0;
  const smartwanPolicyRulesActive = !orchestrationActive && smartwanHasRules;
  const asusPolicyRulesActive = dualWanRoutingEnabled && asusRules > 0;
  const duplicateRisk = asusPolicyRulesActive && smartwanPolicyRulesActive;
  const owner = duplicateRisk
    ? 'mixed'
    : asusPolicyRulesActive || dualWanEnabled
      ? 'dualwan'
      : smartwanPolicyRulesActive
        ? 'smartwan'
        : 'router';

  return {
    routes,
    status,
    configValues,
    smartwanActive,
    orchestrationActive,
    dualWanStatus,
    dualWanEnabled,
    dualWanRoutingEnabled,
    routeSummary,
    smartwanRuleCount,
    smartwanIpRules,
    failoverOverrideRules,
    asusRules,
    asusPriorityRules,
    asusPolicyRulesActive,
    duplicateRisk,
    owner,
    activeDefault: status.active_default_wan || activeDefaultFromWanStatus(wanStatus) || '',
    googleWan: inferGoogleWanFromRoutes(routes, wanStatus),
    watchdogRunning: status.watchdog_running === '1',
    wanStatus,
  };
}

function LogicStatusPill({ active, children }) {
  return <span className={`logic-pill ${active ? 'active' : 'inactive'}`}>{children}</span>;
}

function RoutingFlowNode({ icon: Icon, title, status, detail, tone = 'neutral', action, onClick }) {
  return (
    <div className={`routing-flow-node ${tone}`}>
      <Icon size={22} />
      <div>
        <span>{title}</span>
        <strong>{status}</strong>
        <p>{detail}</p>
      </div>
      {action ? (
        <button type="button" onClick={onClick}>
          {action}
        </button>
      ) : null}
    </div>
  );
}

function RoutingLogicMap({ t, routerState, onNavigate }) {
  const logic = analyzeRoutingLogic(routerState);
  const stackLabel = logic.smartwanActive && logic.dualWanEnabled
    ? t('routingStackMixed')
    : logic.smartwanActive
      ? t('routingStackSmartWan')
      : logic.dualWanEnabled
        ? t('routingStackDualWan')
        : t('routingStackRouter');
  const ownerLabel = logic.owner === 'smartwan'
    ? t('routingOwnerSmartWan')
    : logic.owner === 'dualwan'
      ? t('routingOwnerDualWan')
      : logic.owner === 'mixed'
        ? t('routingOwnerMixed')
        : t('routingOwnerRouter');
  const googleLabel = logic.googleWan ? `${logic.googleWan}` : t('notDetected');

  return (
    <div className="panel routing-map-panel">
      <div className="panel-heading">
        <div>
          <h2>{t('routingMapTitle')}</h2>
          <p>{t('routingMapCopy')}</p>
        </div>
        <Route />
      </div>

      <div className="routing-stack-summary">
        <div>
          <span>{t('routingStack')}</span>
          <strong>{stackLabel}</strong>
        </div>
        <div>
          <span>{t('routingRuleOwner')}</span>
          <strong>{ownerLabel}</strong>
        </div>
        <LogicStatusPill active={!logic.duplicateRisk}>
          {logic.duplicateRisk ? t('routingMixedWarning') : t('routingClean')}
        </LogicStatusPill>
      </div>

      <div className="routing-water-map">
        <RoutingFlowNode
          icon={Network}
          title={t('routingLanClients')}
          status={t('routingTrafficSource')}
          detail={t('routingLanClientsCopy')}
          tone="cyan"
        />
        <RoutingFlowNode
          icon={Cable}
          title={t('dualWan')}
          status={logic.dualWanEnabled ? t('enabled') : t('disabled')}
          detail={`${t('asusRules')}: ${logic.asusRules} / ${t('dualWanMode')}: ${logic.dualWanStatus.mode || 'n/a'} ${logic.dualWanStatus.ratio || ''}`}
          tone={logic.dualWanEnabled ? 'green' : 'muted'}
          action={t('editDualWanRules')}
          onClick={() => onNavigate('dualwan')}
        />
        <RoutingFlowNode
          icon={Route}
          title={t('smartWan')}
          status={logic.smartwanActive ? t('enabled') : t('disabled')}
          detail={`${t('smartWanOrchestration')}: ${logic.orchestrationActive ? t('enabled') : t('disabled')} / ${t('watchdog')}: ${logic.watchdogRunning ? t('running') : t('stopped')}`}
          tone={logic.smartwanActive ? 'green' : 'muted'}
          action={t('configureSmartWanOrchestrator')}
          onClick={() => onNavigate('smartwan')}
        />
        <RoutingFlowNode
          icon={Activity}
          title={t('defaultRoutePolicy')}
          status={logic.activeDefault || t('notDetected')}
          detail={`${t('watchdog')}: ${logic.watchdogRunning ? t('running') : t('stopped')} / Google: ${googleLabel}`}
          tone={logic.watchdogRunning ? 'green' : 'blue'}
          action={t('openRoutes')}
          onClick={() => onNavigate('routes')}
        />
      </div>

      <div className="routing-lanes">
        <div className={`routing-lane ${logic.failoverOverrideRules > 0 ? 'active' : 'standby'}`}>
          <span>{t('routingPriority82')}</span>
          <strong>{logic.failoverOverrideRules}</strong>
          <p>{t('routingPriority82Copy')}</p>
        </div>
        <div className="routing-lane">
          <span>{t('routingPriority100')}</span>
          <strong>{logic.asusPriorityRules || logic.asusRules}</strong>
          <p>{t('routingPriority100Copy')}</p>
        </div>
      </div>

      <div className={`routing-guidance ${logic.duplicateRisk ? 'warn' : 'ok'}`}>
        <ShieldCheck size={18} />
        <div>
          <strong>{logic.duplicateRisk ? t('routingMixedWarning') : t('routingClean')}</strong>
          <p>{logic.duplicateRisk ? t('routingMixedWarningCopy') : t('routingCleanCopy')}</p>
        </div>
      </div>
    </div>
  );
}

function RoutesPanel({ t, routerState, onNavigate }) {
  return (
    <section className="panel-grid single">
      <RoutingLogicMap t={t} routerState={routerState} onNavigate={onNavigate} />
      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>{t('currentRoutes')}</h2>
            <p>{t('routePanelCopy')}</p>
          </div>
          <Activity />
        </div>
        <CodeBlock>{routerState?.routes || t('noData')}</CodeBlock>
      </div>
    </section>
  );
}

const wanQualityModes = [
  { value: 'auto', labelKey: 'wanQualityModeAuto' },
  { value: 'wan0', labelKey: 'wanQualityModeWan0' },
  { value: 'wan1', labelKey: 'wanQualityModeWan1' },
  { value: 'combined', labelKey: 'wanQualityModeCombined' },
];

const wanQualityTargets = [
  { value: 'default', labelKey: 'wanQualityTargetDefault' },
  { value: 'google', labelKey: 'wanQualityTargetGoogle' },
  { value: 'quad9', labelKey: 'wanQualityTargetQuad9' },
];

function formatMetric(value, suffix = '') {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) return 'n/a';
  return `${value}${suffix}`;
}

function WanQualityMetric({ icon: Icon, label, value, help, tone = '' }) {
  return (
    <div className={`wanq-metric ${tone}`}>
      <Icon size={17} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {help ? <p>{help}</p> : null}
      </div>
    </div>
  );
}

function numericMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function WanQualityGauge({ label, value, unit, max, active = false, tone = 'download' }) {
  const numeric = numericMetric(value);
  const ratio = numeric === null ? 0 : Math.max(0, Math.min(1, numeric / max));
  const angle = -132 + ratio * 264;
  const gaugeAngle = ratio * 264;
  return (
    <div className={`wanq-gauge ${tone} ${active ? 'is-measuring' : ''}`}>
      <div className="wanq-gauge-face" style={{ '--gauge-angle': `${gaugeAngle}deg`, '--needle-angle': `${angle}deg` }}>
        <span className="tick t0">0</span>
        <span className="tick t25">{max >= 100 ? Math.round(max / 4) : Math.round(max / 4)}</span>
        <span className="tick t50">{Math.round(max / 2)}</span>
        <span className="tick t75">{Math.round(max * 0.75)}</span>
        <span className="needle" />
        <span className="hub" />
      </div>
      <div className="wanq-gauge-value">
        <strong>{numeric === null ? 'n/a' : numeric}</strong>
        <span>{unit}</span>
      </div>
      <p>{label}</p>
    </div>
  );
}

function WanQualityLivePanel({ t }) {
  return (
    <div className="wanq-live-panel">
      <div className="traffic-wave">
        <span />
        <span />
        <span />
        <span />
      </div>
      <WanQualityGauge label={t('wanQualityDownload')} value={null} unit="Mbps" max={500} active />
      <WanQualityGauge label={t('wanQualityUpload')} value={null} unit="Mbps" max={200} active tone="upload" />
      <WanQualityGauge label={t('wanQualityIdlePing')} value={null} unit="ms" max={120} active tone="latency" />
    </div>
  );
}

function WanQualityScenario({ t, scenario }) {
  if (!scenario) return null;
  const idle = scenario.idleLatency || {};
  const loaded = scenario.loadedDownloadLatency || {};
  const http = scenario.http || {};
  const upload = scenario.upload || {};
  const downloadMbps = numericMetric(scenario.downloadMbps);
  const uploadMbps = numericMetric(scenario.uploadMbps || upload.uploadMbps);
  return (
    <div className="wanq-scenario">
      <div className="wanq-scenario-head">
        <div>
          <strong>{scenario.label}</strong>
          <p>{scenario.wanLabel || scenario.wanId || t('unknown')} / {scenario.interface || t('unknown')}</p>
        </div>
        <span className={`confidence ${scenario.confidence}`}>{scenario.confidence || t('unknown')}</span>
      </div>
      <div className="wanq-speed-dashboard">
        <WanQualityGauge label={t('wanQualityDownload')} value={downloadMbps} unit="Mbps" max={500} />
        <WanQualityGauge label={t('wanQualityUpload')} value={uploadMbps} unit="Mbps" max={200} tone="upload" />
        <WanQualityGauge label={t('wanQualityIdlePing')} value={idle.avgMs} unit="ms" max={120} tone="latency" />
        <WanQualityGauge label={t('wanQualityLoss')} value={idle.packetLossPercent} unit="%" max={10} tone="loss" />
      </div>
      <div className="wanq-route-card">
        <Route size={17} />
        <div>
          <span>{t('wanQualityMatchedRoute')}</span>
          <strong>{scenario.matchedRule || t('notDetected')}</strong>
          <p>{scenario.routeLine || t('noData')}</p>
        </div>
      </div>
      <div className="wanq-metrics-grid">
        <WanQualityMetric icon={Download} label={t('wanQualityDownload')} value={formatMetric(scenario.downloadMbps, ' Mbps')} help={t('wanQualityDownloadHelp')} />
        <WanQualityMetric icon={Upload} label={t('wanQualityUpload')} value={formatMetric(scenario.uploadMbps || upload.uploadMbps, ' Mbps')} help={t('wanQualityUploadHelp')} />
        <WanQualityMetric icon={Clock3} label={t('wanQualityIdlePing')} value={formatMetric(idle.avgMs, ' ms')} help={t('wanQualityIdlePingHelp')} tone={idle.avgMs && idle.avgMs < 50 ? 'ok' : ''} />
        <WanQualityMetric icon={Activity} label={t('wanQualityLoadedPing')} value={formatMetric(loaded.avgMs, ' ms')} help={t('wanQualityLoadedPingHelp')} />
        <WanQualityMetric icon={Activity} label={t('wanQualityJitter')} value={formatMetric(idle.jitterMs, ' ms')} help={t('wanQualityJitterHelp')} />
        <WanQualityMetric icon={ShieldCheck} label={t('wanQualityLoss')} value={formatMetric(idle.packetLossPercent, '%')} help={t('wanQualityLossHelp')} tone={idle.packetLossPercent === 0 ? 'ok' : 'warn'} />
        <WanQualityMetric icon={Globe2} label={t('wanQualityDns')} value={formatMetric(http.dnsMs, ' ms')} help={t('wanQualityDnsHelp')} />
        <WanQualityMetric icon={Network} label={t('wanQualityTtfb')} value={formatMetric(http.ttfbMs, ' ms')} help={t('wanQualityTtfbHelp')} />
      </div>
      <div className="wanq-detail-strip">
        <span>{t('sourceIp')}: <strong>{scenario.sourceIp || t('unknown')}</strong></span>
        <span>{t('gateway')}: <strong>{scenario.gateway || t('unknown')}</strong></span>
        <span>{t('table')}: <strong>{scenario.table || t('unknown')}</strong></span>
        <span>{t('wanQualityRemoteIp')}: <strong>{http.remoteIp || upload.remoteIp || t('unknown')}</strong></span>
      </div>
    </div>
  );
}

function WanQualityTester({ t, routerState }) {
  const [form, setForm] = useState({
    mode: 'auto',
    targetProfile: 'default',
    sourceHost: '',
    pingCount: '5',
    durationSeconds: '8',
    runThroughput: true,
  });
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get('/api/tools/wan-quality/history')
      .then((data) => {
        if (!cancelled) setHistory(data.history || []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
  };

  const payload = {
    ...form,
    pingCount: Number(form.pingCount),
    durationSeconds: Number(form.durationSeconds),
  };

  async function previewRoute() {
    setBusy('preview');
    setError('');
    try {
      setPreview(await api.post('/api/tools/wan-quality/preview', payload));
    } catch (testError) {
      setError(testError.message);
    } finally {
      setBusy('');
    }
  }

  async function runTest() {
    setBusy('run');
    setError('');
    try {
      const data = await api.post('/api/tools/wan-quality/run', payload);
      setResult(data);
      setPreview(data);
      const historyData = await api.get('/api/tools/wan-quality/history').catch(() => ({ history: [] }));
      setHistory(historyData.history || []);
    } catch (testError) {
      setError(testError.message);
    } finally {
      setBusy('');
    }
  }

  const scenarios = result?.scenarios || preview?.scenarios || [];
  const activeDefault = routerState?.status?.active_default_wan || analyzeRoutingLogic(routerState).activeDefaultWan || t('unknown');

  return (
    <div className="panel wanq-panel">
      <div className="panel-heading">
        <div>
          <h2>{t('wanQualityTitle')}</h2>
          <p>{t('wanQualityCopy')}</p>
        </div>
        <BarChart3 />
      </div>

      <div className="wanq-context">
        <span>{t('wanQualityCurrentPolicy')}: <strong>{activeDefault}</strong></span>
        <span>{t('wanQualityDualWan')}: <strong>{routerState?.dualWan?.enabled ? t('enabled') : t('disabled')}</strong></span>
        <span>{t('smartwanStatus')}: <strong>{routerState?.status?.enabled === '1' ? t('enabled') : t('disabled')}</strong></span>
      </div>

      <div className="wanq-controls">
        <Field label={t('wanQualityMode')}>
          <select value={form.mode} onChange={(event) => update({ mode: event.target.value })}>
            {wanQualityModes.map((mode) => <option key={mode.value} value={mode.value}>{t(mode.labelKey)}</option>)}
          </select>
        </Field>
        <Field label={t('wanQualityTarget')} hint={t('wanQualityTargetHint')}>
          <select value={form.targetProfile} onChange={(event) => update({ targetProfile: event.target.value })}>
            {wanQualityTargets.map((target) => <option key={target.value} value={target.value}>{t(target.labelKey)}</option>)}
          </select>
        </Field>
        <Field label={t('wanQualitySourceHost')} hint={t('wanQualitySourceHostHint')}>
          <TextInput value={form.sourceHost} placeholder="192.168.1.50" onChange={(event) => update({ sourceHost: event.target.value })} />
        </Field>
        <Field label={t('wanQualityPingCount')}>
          <TextInput value={form.pingCount} onChange={(event) => update({ pingCount: event.target.value })} />
        </Field>
        <Field label={t('wanQualityDuration')}>
          <TextInput value={form.durationSeconds} onChange={(event) => update({ durationSeconds: event.target.value })} />
        </Field>
      </div>

      <div className="switch-row">
        <Toggle checked={form.runThroughput} onChange={(value) => update({ runThroughput: value })} label={t('wanQualityRunThroughput')} />
      </div>

      <div className="wanq-warning">
        <ShieldCheck size={18} />
        <p>{t('wanQualitySafeAdapterWarning')}</p>
      </div>

      <div className="button-row">
        <ActionButton icon={Route} variant="secondary" busy={busy === 'preview'} onClick={previewRoute}>
          {t('wanQualityPreviewRoute')}
        </ActionButton>
        <ActionButton icon={BarChart3} busy={busy === 'run'} onClick={runTest}>
          {t('wanQualityRunTest')}
        </ActionButton>
      </div>

      {error ? <div className="notice error">{error}</div> : null}

      {busy === 'run' ? <WanQualityLivePanel t={t} /> : null}

      {scenarios.length ? (
        <div className="wanq-results">
          <h3>{result ? t('wanQualityResults') : t('wanQualityRoutePreview')}</h3>
          {scenarios.map((scenario) => <WanQualityScenario key={`${scenario.id}-${scenario.interface}`} t={t} scenario={scenario} />)}
        </div>
      ) : null}

      {result?.combined ? (
        <div className="wanq-combined">
          <div>
            <span>{t('wanQualityCombinedPotential')}</span>
            <strong>{formatMetric(result.combined.potentialDownloadMbps, ' Mbps')}</strong>
          </div>
          <div>
            <span>{t('wanQualityBestSingleFlow')}</span>
            <strong>{formatMetric(result.combined.bestSingleFlowDownloadMbps, ' Mbps')}</strong>
          </div>
          <p>{t('wanQualityCombinedWarning')}</p>
        </div>
      ) : null}

      <div className="wanq-meaning">
        <h3>{t('wanQualityMeaningTitle')}</h3>
        <div>
          <p><strong>{t('wanQualityGaming')}</strong>{t('wanQualityGamingCopy')}</p>
          <p><strong>{t('wanQualityVoip')}</strong>{t('wanQualityVoipCopy')}</p>
          <p><strong>{t('wanQualityStreaming')}</strong>{t('wanQualityStreamingCopy')}</p>
          <p><strong>{t('wanQualityDownloads')}</strong>{t('wanQualityDownloadsCopy')}</p>
        </div>
      </div>

      <div className="wanq-history">
        <h3>{t('wanQualityHistory')}</h3>
        {history.length ? (
          <div className="wanq-history-list">
            {history.slice(0, 6).map((item) => {
              const scenario = item.scenarios?.[0] || {};
              return (
                <div key={item.id} className="wanq-history-item">
                  <span>{new Date(item.startedAt).toLocaleString()}</span>
                  <strong>{item.targetLabel} / {item.mode}</strong>
                  <p>{scenario.wanLabel || scenario.wanId || t('unknown')} · {formatMetric(scenario.idleLatency?.avgMs, ' ms')} · {formatMetric(scenario.downloadMbps, ' Mbps')}</p>
                </div>
              );
            })}
          </div>
        ) : <p className="empty">{t('wanQualityNoHistory')}</p>}
      </div>
    </div>
  );
}

function ToolsPanel({ t, routerState, onNavigate }) {
  const logic = analyzeRoutingLogic(routerState);
  return (
    <section className="panel-grid single">
      <RoutingLogicMap t={t} routerState={routerState} onNavigate={onNavigate} />
      <WanQualityTester t={t} routerState={routerState} />
      <div className="panel routing-owner-panel">
        <div className="panel-heading">
          <div>
            <h2>{t('routingOwnerGuide')}</h2>
            <p>{t('routingOwnerGuideCopy')}</p>
          </div>
          <Wrench />
        </div>
        <div className="owner-guide-grid">
          <div className={`owner-guide-card ${logic.orchestrationActive ? 'active' : ''}`}>
            <Route size={22} />
            <strong>{t('smartWanOrchestration')}</strong>
            <p>{t('smartWanOrchestratorRoleCopy')}</p>
            <button type="button" onClick={() => onNavigate('smartwan')}>{t('configureSmartWanOrchestrator')}</button>
          </div>
          <div className={`owner-guide-card ${logic.owner === 'dualwan' ? 'active' : ''}`}>
            <Cable size={22} />
            <strong>{t('routingOwnerDualWan')}</strong>
            <p>{t('routingOwnerDualWanCopy')}</p>
            <button type="button" onClick={() => onNavigate('dualwan')}>{t('editDualWanRules')}</button>
          </div>
          <div className={`owner-guide-card ${logic.duplicateRisk ? 'warn' : ''}`}>
            <ShieldCheck size={22} />
            <strong>{t('routingNoDuplicateTitle')}</strong>
            <p>{t('routingNoDuplicateCopy')}</p>
            <button type="button" onClick={() => onNavigate('routes')}>{t('openRoutes')}</button>
          </div>
        </div>
        <div className="routing-tool-actions">
          <button type="button" onClick={() => onNavigate('setup')}>{t('goToSetup')}</button>
          <button type="button" onClick={() => onNavigate('scripts')}>{t('scripts')}</button>
          <button type="button" onClick={() => onNavigate('logs')}>{t('logs')}</button>
          <button type="button" onClick={() => onNavigate('routes')}>{t('routes')}</button>
        </div>
      </div>
    </section>
  );
}

export default App;
