/**
 * Error Boundary for LiveConversationWorkspace
 * Catches and displays errors from the live conversation component
 */

import { Component, ErrorInfo, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class LiveConversationErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("LiveConversationWorkspace Error:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <Card className="m-4 border-red-200 bg-red-50">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900">Live Conversation Error</h3>
                <p className="text-sm text-red-700 mt-1">
                  {this.state.error?.message || "An unexpected error occurred"}
                </p>

                {this.state.error && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-medium text-red-800">
                      Technical Details
                    </summary>
                    <div className="mt-2 p-3 bg-red-100 rounded border border-red-200">
                      <p className="text-xs text-red-800 font-mono">
                        {this.state.error.toString()}
                      </p>
                      {this.state.errorInfo && (
                        <p className="text-xs text-red-700 mt-2">
                          {this.state.errorInfo.componentStack}
                        </p>
                      )}
                    </div>
                  </details>
                )}

                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.location.reload()}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Reload
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                  >
                    Try Again
                  </Button>
                </div>

                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                  <p className="text-xs font-medium text-blue-900">Common Causes:</p>
                  <ul className="mt-1 text-xs text-blue-700 list-disc list-inside space-y-1">
                    <li>Backend server not responding (check port 8001)</li>
                    <li>WebSocket connection failed</li>
                    <li>Authentication session expired</li>
                    <li>API endpoint error</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}