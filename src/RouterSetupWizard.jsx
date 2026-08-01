import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  WandSparkles,
} from 'lucide-react';
import { api } from './api.js';

const HIDDEN_KEY = 'smartwan-setup-wizard-hidden';

function initialAnswers(current = {}) {
  const dualWan = current.dualWan || {};
  const smartwan = current.smartwan || {};
  return {
    name: '',
    dualWanEnabled: dualWan.enabled !== false,
    primaryPort: dualWan.primary || 'wan',
    secondaryPort: dualWan.secondary || 'lan',
    mode: dualWan.mode || 'lb',
    ratioPrimary: dualWan.ratioPrimary || '9',
    ratioSecondary: dualWan.ratioSecondary || '1',
    routingEnabled: dualWan.routingEnabled !== false,
    wan0Label: smartwan.wan0Label || 'WAN0',
    wan1Label: smartwan.wan1Label || 'WAN1',
    watchdogTargets: smartwan.watchdogTargets || '1.1.1.1\n8.8.8.8',
    watchdogInterval: smartwan.watchdogInterval || '1',
    watchdogFailCount: smartwan.watchdogFailCount || '2',
    watchdogRecoverCount: smartwan.watchdogRecoverCount || '3',
    vpnManagementEnabled: smartwan.vpnManagementEnabled !== false,
    vpnSubnet: smartwan.vpnSubnet || '10.8.0.0/24',
    lanSubnet: smartwan.vpnLanSubnet || '192.168.1.0/24',
  };
}

function StepPill({ active, done, number, label, onClick }) {
  return (
    <button
      type="button"
      className={`setup-step-pill ${active ? 'active' : ''} ${done ? 'done' : ''}`}
      onClick={onClick}
    >
      <span>{done ? <CheckCircle2 size={15} /> : number}</span>
      {label}
    </button>
  );
}

export default function RouterSetupWizard({ t, routerState, onRefresh }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDDEN_KEY) === '1');
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [state, setState] = useState(null);
  const [answers, setAnswers] = useState(() => initialAnswers());
  const [preview, setPreview] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setBusy('load');
    try {
      const result = await api.get('/api/router/setup-wizard');
      setState(result);
      setAnswers(initialAnswers(result.current));
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (!hidden) void load();
  }, [hidden]);

  const update = (patch) => {
    setAnswers((current) => ({ ...current, ...patch }));
    setPreview(null);
    setMessage('');
  };

  const detectedIdentity = state?.current?.identity || routerState?.identity || {};
  const runtime = state?.current?.runtime || {};
  const configured = (
    runtime.files?.smartwanctl === '1'
    && runtime.files?.backend === '1'
    && runtime.status?.hooks_installed === '1'
  );

  const primaryPortLabel = useMemo(() => ({
    wan: `WAN (${answers.primaryPort === 'wan' ? answers.wan0Label : answers.wan1Label})`,
    lan: `Ethernet LAN (${answers.primaryPort === 'lan' ? answers.wan0Label : answers.wan1Label})`,
    usb: `USB (${answers.primaryPort === 'usb' ? answers.wan0Label : answers.wan1Label})`,
  }), [answers.primaryPort, answers.wan0Label, answers.wan1Label]);

  const previewChanges = async () => {
    setBusy('preview');
    try {
      const result = await api.post('/api/router/setup-wizard/preview', answers);
      setPreview(result);
      setStep(4);
      setError('');
    } catch (previewError) {
      setError(previewError.message);
    } finally {
      setBusy('');
    }
  };

  const captureProfile = async () => {
    setBusy('capture');
    try {
      const result = await api.post('/api/router/setup-wizard/capture', {
        name: answers.name || t('setupWizardReferenceName'),
      });
      setState(result);
      setMessage(t('setupWizardCaptureSuccess'));
      setError('');
    } catch (captureError) {
      setError(captureError.message);
    } finally {
      setBusy('');
    }
  };

  const applyWizard = async () => {
    setBusy('apply');
    try {
      const result = await api.post('/api/router/setup-wizard/apply', {
        answers,
        confirm: confirmation,
        saveAsProfile: true,
      });
      setMessage(t('setupWizardApplySuccess').replace('{backup}', result.backupFile || ''));
      setConfirmation('');
      setError('');
      await load();
      await onRefresh?.();
    } catch (applyError) {
      setError(applyError.message);
    } finally {
      setBusy('');
    }
  };

  const applyProfile = async () => {
    setBusy('profile');
    try {
      const result = await api.post('/api/router/setup-wizard/apply-profile', {
        confirm: confirmation,
      });
      setMessage(t('setupWizardApplySuccess').replace('{backup}', result.backupFile || ''));
      setConfirmation('');
      setError('');
      await load();
      await onRefresh?.();
    } catch (applyError) {
      setError(applyError.message);
    } finally {
      setBusy('');
    }
  };

  const hideWizard = () => {
    localStorage.setItem(HIDDEN_KEY, '1');
    setHidden(true);
  };

  if (hidden) {
    return (
      <div className="panel setup-wizard-hidden">
        <WandSparkles size={19} />
        <div>
          <strong>{t('setupWizardTitle')}</strong>
          <span>{t('setupWizardHiddenCopy')}</span>
        </div>
        <button type="button" onClick={() => {
          localStorage.removeItem(HIDDEN_KEY);
          setHidden(false);
        }}>
          {t('setupWizardShow')}
        </button>
      </div>
    );
  }

  const stepLabels = [
    t('setupWizardStepDetect'),
    t('setupWizardStepWan'),
    t('setupWizardStepHealth'),
    t('setupWizardStepVpn'),
    t('setupWizardStepReview'),
  ];

  return (
    <details className="panel setup-wizard-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <div className="setup-wizard-summary-icon"><WandSparkles /></div>
        <div>
          <span className="eyebrow">{t('setupWizardEyebrow')}</span>
          <h2>{t('setupWizardTitle')}</h2>
          <p>{t('setupWizardCopy')}</p>
        </div>
        <div className={`setup-ready-badge ${configured ? 'ok' : 'warn'}`}>
          {configured ? t('setupWizardConfigured') : t('setupWizardNeedsSetup')}
        </div>
        <ChevronDown className="setup-summary-chevron" />
      </summary>

      <div className="setup-wizard-body">
        <div className="setup-wizard-toolbar">
          <div className="setup-step-list">
            {stepLabels.map((label, index) => (
              <StepPill
                key={label}
                active={step === index}
                done={step > index}
                number={index + 1}
                label={label}
                onClick={() => setStep(index)}
              />
            ))}
          </div>
          <button type="button" className="setup-hide-button" onClick={hideWizard}>
            <EyeOff size={15} /> {t('setupWizardHide')}
          </button>
        </div>

        {error ? <div className="notice error">{error}</div> : null}
        {message ? <div className="notice success">{message}</div> : null}

        {step === 0 ? (
          <div className="setup-step-content">
            <div className="setup-detection-grid">
              <div><span>{t('model')}</span><strong>{detectedIdentity.model || t('unknown')}</strong></div>
              <div><span>{t('firmware')}</span><strong>{detectedIdentity.firmware || t('unknown')}</strong></div>
              <div><span>SSH</span><strong className={routerState ? 'ok' : 'warn'}>{routerState ? t('connected') : t('unknown')}</strong></div>
              <div><span>JFFS / hooks</span><strong className={configured ? 'ok' : 'warn'}>{configured ? t('ready') : t('setupWizardWillInstall')}</strong></div>
            </div>
            <div className="setup-explanation">
              <ShieldCheck size={21} />
              <div>
                <strong>{t('setupWizardSafetyTitle')}</strong>
                <p>{t('setupWizardSafetyCopy')}</p>
              </div>
            </div>
            <label className="setup-name-field">
              <span>{t('setupWizardProfileName')}</span>
              <input value={answers.name} onChange={(event) => update({ name: event.target.value })} placeholder={t('setupWizardReferenceName')} />
            </label>
            <div className="button-row">
              <button type="button" disabled={busy === 'capture'} onClick={captureProfile}>
                <Archive size={16} /> {t('setupWizardCaptureCurrent')}
              </button>
              <button type="button" disabled={busy === 'load'} onClick={load}>
                <RefreshCw size={16} /> {t('refresh')}
              </button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="setup-step-content">
            <div className="setup-question-grid">
              <label>{t('dualWanPrimary')}
                <select value={answers.primaryPort} onChange={(event) => update({ primaryPort: event.target.value })}>
                  <option value="wan">{primaryPortLabel.wan}</option>
                  <option value="lan">{primaryPortLabel.lan}</option>
                  <option value="usb">{primaryPortLabel.usb}</option>
                </select>
              </label>
              <label>{t('dualWanSecondary')}
                <select value={answers.secondaryPort} onChange={(event) => update({ secondaryPort: event.target.value })}>
                  <option value="lan">{primaryPortLabel.lan}</option>
                  <option value="wan">{primaryPortLabel.wan}</option>
                  <option value="usb">{primaryPortLabel.usb}</option>
                </select>
              </label>
              <label>{t('wan0Label')}<input value={answers.wan0Label} onChange={(event) => update({ wan0Label: event.target.value })} /></label>
              <label>{t('wan1Label')}<input value={answers.wan1Label} onChange={(event) => update({ wan1Label: event.target.value })} /></label>
              <label>{t('dualWanMode')}
                <select value={answers.mode} onChange={(event) => update({ mode: event.target.value })}>
                  <option value="lb">{t('dualWanLoadBalance')}</option>
                  <option value="fo">{t('dualWanFailover')}</option>
                </select>
              </label>
              <label>{t('dualWanPrimaryWeight')}<input type="number" min="1" max="100" value={answers.ratioPrimary} onChange={(event) => update({ ratioPrimary: event.target.value })} /></label>
              <label>{t('dualWanSecondaryWeight')}<input type="number" min="1" max="100" value={answers.ratioSecondary} onChange={(event) => update({ ratioSecondary: event.target.value })} /></label>
              <label className="setup-check"><input type="checkbox" checked={answers.routingEnabled} onChange={(event) => update({ routingEnabled: event.target.checked })} />{t('dualWanRoutingRules')}</label>
            </div>
            <p className="setup-step-note">{t('setupWizardRulesPreserved')}</p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="setup-step-content">
            <div className="setup-question-grid">
              <label className="setup-wide">{t('watchdogTargets')}<textarea rows={4} value={answers.watchdogTargets} onChange={(event) => update({ watchdogTargets: event.target.value })} /></label>
              <label>{t('watchdogInterval')}<input type="number" min="1" max="30" value={answers.watchdogInterval} onChange={(event) => update({ watchdogInterval: event.target.value })} /></label>
              <label>{t('watchdogFailCount')}<input type="number" min="1" max="5" value={answers.watchdogFailCount} onChange={(event) => update({ watchdogFailCount: event.target.value })} /></label>
              <label>{t('watchdogRecoverCount')}<input type="number" min="1" max="10" value={answers.watchdogRecoverCount} onChange={(event) => update({ watchdogRecoverCount: event.target.value })} /></label>
            </div>
            <p className="setup-step-note">{t('setupWizardHealthCopy')}</p>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="setup-step-content">
            <div className="setup-question-grid">
              <label className="setup-check"><input type="checkbox" checked={answers.vpnManagementEnabled} onChange={(event) => update({ vpnManagementEnabled: event.target.checked })} />{t('vpnManagement')}</label>
              <label>{t('vpnSubnet')}<input value={answers.vpnSubnet} onChange={(event) => update({ vpnSubnet: event.target.value })} /></label>
              <label>{t('vpnLanSubnet')}<input value={answers.lanSubnet} onChange={(event) => update({ lanSubnet: event.target.value })} /></label>
            </div>
            <p className="setup-step-note">{t('setupWizardVpnCopy')}</p>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="setup-step-content">
            <div className="setup-review-header">
              <div>
                <strong>{t('setupWizardReviewTitle')}</strong>
                <span>{t('setupWizardReviewCopy')}</span>
              </div>
              <button type="button" disabled={busy === 'preview'} onClick={previewChanges}>
                <RefreshCw size={15} /> {t('setupWizardRefreshPreview')}
              </button>
            </div>
            <div className="setup-change-list">
              {preview?.changes?.length ? preview.changes.map((change) => (
                <div key={change.key}>
                  <strong>{change.key}</strong>
                  <span>{change.current || '—'}</span>
                  <ChevronRight size={14} />
                  <span>{change.desired || '—'}</span>
                </div>
              )) : <p className="empty">{preview ? t('setupWizardNoChanges') : t('setupWizardPreviewFirst')}</p>}
            </div>

            <div className="setup-apply-box">
              <label>{t('setupWizardConfirmation')}
                <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="APPLY WIZARD" />
              </label>
              <button type="button" className="primary" disabled={busy === 'apply' || confirmation !== 'APPLY WIZARD'} onClick={applyWizard}>
                <Rocket size={16} /> {t('setupWizardInstallAndApply')}
              </button>
            </div>

            {state?.profile ? (
              <details className="setup-saved-profile">
                <summary><Save size={16} /> {t('setupWizardSavedProfile')}: {state.profile.name}</summary>
                <div>
                  <span>{state.profile.identity?.model} · {state.profile.identity?.firmware}</span>
                  <span>{t('setupWizardSavedAt')}: {new Date(state.profile.createdAt).toLocaleString()}</span>
                  <label>{t('setupWizardConfirmation')}
                    <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="APPLY PROFILE" />
                  </label>
                  <button type="button" disabled={!state.compatible || busy === 'profile' || confirmation !== 'APPLY PROFILE'} onClick={applyProfile}>
                    <ShieldCheck size={16} /> {t('setupWizardApplySaved')}
                  </button>
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        <details className="setup-wizard-docs">
          <summary>{t('setupWizardDocsTitle')}</summary>
          <div>
            <article>
              <strong>{t('setupWizardDocsDetectTitle')}</strong>
              <p>{t('setupWizardDocsDetectCopy')}</p>
            </article>
            <article>
              <strong>{t('setupWizardDocsDualWanTitle')}</strong>
              <p>{t('setupWizardDocsDualWanCopy')}</p>
            </article>
            <article>
              <strong>{t('setupWizardDocsFailoverTitle')}</strong>
              <p>{t('setupWizardDocsFailoverCopy')}</p>
            </article>
            <article>
              <strong>{t('setupWizardDocsVpnTitle')}</strong>
              <p>{t('setupWizardDocsVpnCopy')}</p>
            </article>
            <article>
              <strong>{t('setupWizardDocsPersistenceTitle')}</strong>
              <p>{t('setupWizardDocsPersistenceCopy')}</p>
            </article>
          </div>
        </details>

        <div className="setup-wizard-nav">
          <button type="button" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>
            <ChevronLeft size={16} /> {t('previous')}
          </button>
          {step < 4 ? (
            <button type="button" className="primary" onClick={() => setStep((current) => Math.min(4, current + 1))}>
              {t('next')} <ChevronRight size={16} />
            </button>
          ) : null}
        </div>
      </div>
    </details>
  );
}
