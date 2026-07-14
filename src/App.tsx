import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, LoginRoute, ProtectedRoute, useAuth } from "@/lib/auth";
import Index from "./pages/Index.tsx";
import Login from "./pages/Login.tsx";
import NotFound from "./pages/NotFound.tsx";
import UploadCenter from "./pages/UploadCenter.tsx";
import Prescription from "./pages/Prescription.tsx";
import SOAP from "./pages/SOAP.tsx";
import { SpeakerDiarizationTest } from "./components/voice/SpeakerDiarizationTest.tsx";
import AbdmIntegrationPage from "./abdm/AbdmIntegrationPage.jsx";
import ItemServiceMasterAdmin from "./pages/ItemServiceMasterAdmin.tsx";

const queryClient = new QueryClient();

const RootRedirect = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600">
        Checking session...
      </div>
    );
  }

  return <Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route
              path="/login"
              element={(
                <LoginRoute>
                  <Login />
                </LoginRoute>
              )}
            />
            <Route element={<ProtectedRoute roles={["admin", "doctor"]} />}>
              <Route path="/dashboard" element={<Index />} />
              <Route path="/upload" element={<UploadCenter />} />
              <Route path="/prescription/:documentId" element={<Prescription />} />
              <Route path="/soap/:documentId" element={<SOAP />} />
              <Route path="/test/speaker-diarization" element={<SpeakerDiarizationTest />} />
              <Route element={<ProtectedRoute roles={["admin"]} />}>
                <Route path="/abdm" element={<AbdmIntegrationPage />} />
                <Route path="/admin/item-service-master" element={<ItemServiceMasterAdmin />} />
              </Route>
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
