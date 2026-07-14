/**
 * Debug version of LiveConversationWorkspace to identify rendering issues
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";

export default function LiveConversationWorkspaceDebug() {
  const [status, setStatus] = useState<"loading" | "error" | "success">("loading");
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [hookData, setHookData] = useState<any>(null);

  useEffect(() => {
    async function testComponent() {
      try {
        setStatus("loading");

        // Test 1: Check if hook file exists
        const hookModule = await import("@/hooks/useLiveConversationAPI");
        console.log("✅ Hook module loaded:", hookModule);

        // Test 2: Try to use the hook
        const { useLiveConversationAPI } = hookModule;
        console.log("✅ useLiveConversationAPI function found:", typeof useLiveConversationAPI);

        setHookData({
          hasHook: !!useLiveConversationAPI,
          hookType: typeof useLiveConversationAPI,
          hookExports: Object.keys(hookModule)
        });

        setStatus("success");
      } catch (error) {
        console.error("❌ Component test failed:", error);
        setStatus("error");
        setErrorDetails(error instanceof Error ? error.message : String(error));
      }
    }

    testComponent();
  }, []);

  if (status === "loading") {
    return (
      <Card className="m-4">
        <CardContent className="flex items-center justify-center p-8">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <span className="text-slate-600">Testing component dependencies...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="m-4 border-red-200 bg-red-50">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-red-900">Component Error Detected</h3>
              <p className="text-sm text-red-700 mt-1">{errorDetails}</p>
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-red-800">Debug Steps:</p>
                <ol className="text-xs text-red-700 list-decimal list-inside space-y-1">
                  <li>Check browser console for detailed errors</li>
                  <li>Verify backend server is running on port 8001</li>
                  <li>Check if /api/voice/live/sessions endpoint is available</li>
                  <li>Verify WebSocket connection is working</li>
                </ol>
              </div>
              <Button
                className="mt-4"
                size="sm"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="m-4">
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <h3 className="font-semibold text-green-900">Component Dependencies OK</h3>
            <div className="mt-4 space-y-2 text-sm">
              <p className="text-slate-700">✅ Hook module loaded successfully</p>
              <p className="text-slate-700">✅ useLiveConversationAPI available</p>
              {hookData && (
                <div className="mt-4 p-4 bg-slate-50 rounded border border-slate-200">
                  <p className="font-medium text-slate-900">Hook Information:</p>
                  <pre className="mt-2 text-xs text-slate-700 overflow-auto">
                    {JSON.stringify(hookData, null, 2)}
                  </pre>
                </div>
              )}
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
                <p className="font-medium text-blue-900">Next Steps:</p>
                <p className="text-sm text-blue-700 mt-1">
                  The component dependencies are working. The issue might be:
                </p>
                <ul className="mt-2 text-sm text-blue-700 list-disc list-inside space-y-1">
                  <li>Backend API not responding to /api/voice/live/sessions</li>
                  <li>WebSocket connection failing</li>
                  <li>Authentication/authorization issues</li>
                  <li>CORS problems with API requests</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}