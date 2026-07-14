import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_BASE, apiFetch, expectApiJson } from '@/lib/apiClient';

function ReadinessItem({ label, ready, detail }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 py-3 last:border-0">
      <div>
        <span className="text-sm text-slate-700">{label}</span>
        {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
      </div>
      <span className={ready ? 'text-sm font-medium text-emerald-700' : 'text-sm font-medium text-amber-700'}>
        {ready ? 'Ready' : 'Blocked'}
      </span>
    </div>
  );
}

export default function AbdmIntegrationPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`${API_BASE}/abdm/status`);
      setStatus(await expectApiJson(response, 'Unable to load ABDM status'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load ABDM status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const verifySession = async () => {
    setVerifying(true);
    setError('');
    try {
      const response = await apiFetch(`${API_BASE}/abdm/session/verify`, {
        method: 'POST',
      });
      const payload = await expectApiJson(response, 'ABDM verification failed');
      setStatus(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'ABDM verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const connected = Boolean(status?.gatewaySession?.cached || status?.gatewaySession?.connected);
  const phase0 = status?.phase0;
  const blockers = Array.isArray(phase0?.blockers) ? phase0.blockers : [];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">ABDM readiness</h1>
            <p className="mt-1 text-sm text-slate-600">Sandbox configuration and gateway connectivity</p>
          </div>
          <Button variant="outline" size="icon" onClick={() => void loadStatus()} disabled={loading} title="Refresh status">
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>

        <section className="rounded-md border border-slate-200 bg-white p-5">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {status && (
            <>
              <div className="mb-5 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                {phase0?.sandboxReady ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {phase0?.sandboxReady ? 'Phase 0 sandbox proof is ready' : 'Phase 0 sandbox proof is blocked'}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Backend foundation is loaded. Sandbox proof requires credentials, callback configuration, and a verified gateway session.
                  </p>
                </div>
              </div>

              <ReadinessItem
                label="ABDM credentials"
                ready={Boolean(phase0?.requirements?.credentials)}
                detail={status.missingCredentials?.length ? status.missingCredentials.join(', ') : 'Client credentials are configured server-side.'}
              />
              <ReadinessItem
                label="Public callback URL"
                ready={Boolean(phase0?.requirements?.callbackUrl)}
                detail={status.callbackConfigured ? 'Callback base URL is configured.' : 'Set ABDM_CALLBACK_BASE_URL to the public HTTPS callback base.'}
              />
              <ReadinessItem
                label="Gateway configuration"
                ready={Boolean(phase0?.requirements?.gatewayConfiguration)}
                detail={status.gatewayBaseUrl}
              />
              <ReadinessItem
                label="Gateway session"
                ready={connected}
                detail={connected ? `Cached until ${status.gatewaySession?.expiresAt || 'current process'}` : 'Use Verify gateway after credentials are configured.'}
              />
              <ReadinessItem label="HIP identity" ready={Boolean(status.hipConfigured)} detail="Required before publishing dashboard records as ABDM care contexts." />
              <ReadinessItem label="HIU identity" ready={Boolean(status.hiuConfigured)} detail="Required before consent-based external record retrieval." />

              {blockers.length > 0 && (
                <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-950">Current blockers</p>
                  <ul className="mt-2 space-y-1 text-sm text-amber-900">
                    {blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5 flex items-center justify-between gap-4">
                <span className="text-sm text-slate-600">Environment: {status.environment || 'sandbox'}</span>
                <Button onClick={() => void verifySession()} disabled={verifying || !phase0?.gatewayVerificationAvailable}>
                  {verifying && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                  Verify gateway
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
