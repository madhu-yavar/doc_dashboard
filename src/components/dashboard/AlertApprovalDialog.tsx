import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type DashboardAlertTarget = "medications" | "labs" | "radiology" | "treatment";

export type AlertChannelPreview = {
  enabled: boolean;
  recipient?: string | null;
  subject?: string;
  body: string;
};

export type AlertPreviewDelivery = {
  key: string;
  label: string;
  itemCount: number;
  alreadySent?: boolean;
  channels: {
    email?: AlertChannelPreview;
    whatsapp?: AlertChannelPreview;
  };
};

export type AlertPreviewResponse = {
  success: boolean;
  documentId: string;
  documentName: string;
  target: DashboardAlertTarget | string;
  deliveries: AlertPreviewDelivery[];
  timestamp: string;
};

interface AlertApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: AlertPreviewResponse | null;
  isLoading: boolean;
  isSending: boolean;
  onApprove: () => void;
}

const channelSummary = (delivery: AlertPreviewDelivery) => {
  const channels = [];
  if (delivery.channels.email) channels.push("Email");
  if (delivery.channels.whatsapp) channels.push("WhatsApp");
  return channels.join(" + ");
};

const AlertApprovalDialog = ({
  open,
  onOpenChange,
  preview,
  isLoading,
  isSending,
  onApprove,
}: AlertApprovalDialogProps) => {
  const deliveries = preview?.deliveries || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-200 px-6 py-5">
          <DialogTitle className="text-xl text-slate-900">Review Alert Message</DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Approve the generated message before it is sent to the selected team.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5">
          {isLoading ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              Building alert preview...
            </div>
          ) : deliveries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              No extracted orders are available for this card.
            </div>
          ) : (
            <div className="space-y-4">
              {deliveries.map((delivery) => {
                const defaultTab = delivery.channels.email ? "email" : "whatsapp";
                return (
                  <div key={delivery.key} className="rounded-2xl border border-slate-200 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{delivery.label}</p>
                        <p className="text-xs text-slate-500">
                          {delivery.itemCount} item{delivery.itemCount === 1 ? "" : "s"} · {channelSummary(delivery)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {delivery.alreadySent ? (
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                            Sent earlier
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="px-4 py-4">
                      <Tabs defaultValue={defaultTab}>
                        <TabsList className="mb-3 h-9 bg-slate-100">
                          {delivery.channels.email ? <TabsTrigger value="email">Email</TabsTrigger> : null}
                          {delivery.channels.whatsapp ? <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger> : null}
                        </TabsList>

                        {delivery.channels.email ? (
                          <TabsContent value="email" className="mt-0">
                            <div className="mb-3 space-y-1 text-xs text-slate-500">
                              <p>
                                <span className="font-medium text-slate-700">To:</span> {delivery.channels.email.recipient || "Not configured"}
                              </p>
                              <p>
                                <span className="font-medium text-slate-700">Subject:</span> {delivery.channels.email.subject || "No subject"}
                              </p>
                              {!delivery.channels.email.enabled ? (
                                <p className="text-amber-600">Email is not enabled in the current environment.</p>
                              ) : null}
                            </div>
                            <ScrollArea className="h-[280px] rounded-2xl border border-slate-200 bg-slate-50">
                              <pre className="whitespace-pre-wrap px-4 py-4 text-[12px] leading-5 text-slate-700">
                                {delivery.channels.email.body}
                              </pre>
                            </ScrollArea>
                          </TabsContent>
                        ) : null}

                        {delivery.channels.whatsapp ? (
                          <TabsContent value="whatsapp" className="mt-0">
                            <div className="mb-3 space-y-1 text-xs text-slate-500">
                              <p>
                                <span className="font-medium text-slate-700">To:</span> {delivery.channels.whatsapp.recipient || "Configured WhatsApp channel"}
                              </p>
                              {!delivery.channels.whatsapp.enabled ? (
                                <p className="text-amber-600">WhatsApp is not enabled in the current environment.</p>
                              ) : null}
                            </div>
                            <ScrollArea className="h-[280px] rounded-2xl border border-slate-200 bg-slate-50">
                              <pre className="whitespace-pre-wrap px-4 py-4 text-[12px] leading-5 text-slate-700">
                                {delivery.channels.whatsapp.body}
                              </pre>
                            </ScrollArea>
                          </TabsContent>
                        ) : null}
                      </Tabs>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-slate-200 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button onClick={onApprove} disabled={isLoading || isSending || deliveries.length === 0}>
            {isSending ? "Sending..." : "Approve & Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AlertApprovalDialog;
