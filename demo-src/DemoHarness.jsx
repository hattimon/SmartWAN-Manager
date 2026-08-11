import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, RefreshCw } from 'lucide-react';
import App from '../src/App.jsx';
import { demoBackend } from './mockApi.js';
import './demo.css';

function copyFor(language) {
  return language === 'pl'
    ? {
      title: 'Sterowanie demo',
      hint: 'Fikcyjny router · demo / demo',
      wan0: 'Awaria WAN0 i powrót',
      wan1: 'Awaria WAN1 i powrót',
      both: 'Awaria obu łączy i powrót',
      reset: 'Przywróć oba łącza',
      healthy: 'Oba łącza działają',
      checking: 'Aurelka sprawdza łącza',
      outage: 'Symulowana awaria',
      recovering: 'Potwierdzanie powrotu łącza',
    }
    : {
      title: 'Demo controls',
      hint: 'Fictional router · demo / demo',
      wan0: 'WAN0 outage and recovery',
      wan1: 'WAN1 outage and recovery',
      both: 'Both links outage and recovery',
      reset: 'Restore both links',
      healthy: 'Both links are online',
      checking: 'Aurelka is checking the links',
      outage: 'Simulated outage',
      recovering: 'Confirming link recovery',
    };
}

export default function DemoHarness() {
  const [snapshot, setSnapshot] = useState(() => demoBackend.getSnapshot());

  useEffect(() => demoBackend.subscribe((next) => {
    setSnapshot(next);
  }), []);

  const runScenario = (target) => {
    window.dispatchEvent(new Event('smartwan:aurelka-audio-prime'));
    demoBackend.runScenario(target);
  };

  const copy = copyFor(snapshot.language);
  const statusCopy = copy[snapshot.phase] || copy.healthy;
  const StatusIcon = snapshot.phase === 'healthy'
    ? CheckCircle2
    : snapshot.phase === 'checking' || snapshot.phase === 'recovering'
      ? RefreshCw
      : AlertTriangle;

  return (
    <div className="demo-harness">
      <App />
      <aside className={`demo-controller phase-${snapshot.phase}`} aria-label={copy.title}>
        <details>
          <summary>
            <span className="demo-controller-badge"><FlaskConical size={15} />DEMO</span>
            <span>
              <strong>{copy.title}</strong>
              <small>{copy.hint}</small>
            </span>
            <StatusIcon className={snapshot.phase === 'checking' || snapshot.phase === 'recovering' ? 'spin' : ''} size={18} />
          </summary>
          <div className="demo-controller-body">
            <p><StatusIcon size={15} />{statusCopy}</p>
            <div>
              <button type="button" onClick={() => runScenario('wan0')}>{copy.wan0}</button>
              <button type="button" onClick={() => runScenario('wan1')}>{copy.wan1}</button>
              <button type="button" onClick={() => runScenario('both')}>{copy.both}</button>
              <button type="button" className="secondary" onClick={demoBackend.resetScenario}>{copy.reset}</button>
            </div>
          </div>
        </details>
      </aside>
    </div>
  );
}
