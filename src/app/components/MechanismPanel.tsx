import type { TelemetrySample } from '../../core/telemetry/sampler.js';

interface Props { readonly sample: TelemetrySample | null; }

export function MechanismPanel({ sample }: Props) {
  const mechanism = sample?.robots[0]?.mechanisms;
  const intake = mechanism?.intake === 'intake' ? 'ON' : mechanism?.intake === 'outtake' ? 'OUT' : 'OFF';
  return (
    <section className="mechanism-panel" aria-label="Robot mechanisms">
      <div className="mechanism-heading"><span>Robot systems</span><span className="mechanism-live">LIVE</span></div>
      <div className="mechanism-grid">
        <div><span>INTAKE</span><strong className={mechanism?.intake === 'intake' ? 'is-active' : ''}>{intake}</strong></div>
        <div><span>STORAGE</span><strong>{mechanism === undefined ? '—' : `${mechanism.held.length} / ${mechanism.capacity}`}</strong></div>
        <div><span>GATE</span><strong className={mechanism?.gateOpen ? 'is-active' : ''}>{mechanism?.gateOpen ? 'OPEN' : 'CLOSED'}</strong></div>
        <div><span>SHOOTER</span><strong className={mechanism?.shooterReady ? 'is-active' : ''}>{mechanism?.shooterReady ? 'READY' : 'OFF'}</strong></div>
      </div>
      <p>F Intake · R Outtake · G Gate · Space Shooter · X Fire</p>
    </section>
  );
}
