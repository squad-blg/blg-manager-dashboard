import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import type { Manager } from "@/pages/Dashboard";
import { useToast } from "@/hooks/use-toast";

type Client = {
  id: string;
  name: string;
  managerId: string;
  platform: string;
  ersFolder: string | null;
  ersApiKey: string | null;
  ersDevKey: string | null;
  ioAccountId: string | null;
  ioApiKey: string | null;
  ioLocationId: string | null;
  aaaCampaignId: string | null;
  agencyAnalyticsUrl: string | null;
  ecommPlatform: string | null;
  googleAdsCustomerId: string | null;
  ga4PropertyId: string | null;
  metaAdAccountId: string | null;
  location: string | null;
  active: boolean | null;
  sheetsSpreadsheetId: string | null;
  sheetsCell: string | null;
};

const PLATFORMS = ["ERS", "IO", "ECOMM", "LEADGEN", "SHEETS"];

const PLATFORM_LABELS: Record<string, string> = {
  ERS: "Event Rental Systems",
  IO: "Inflatable Office",
  ECOMM: "E-Commerce",
  LEADGEN: "Lead Generation",
  SHEETS: "Google Sheets",
};

export default function ClientsPage() {
  const { toast } = useToast();
  const [selectedManager, setSelectedManager] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form, setForm] = useState({
    name: "",
    managerId: "",
    platform: "ERS",
    ersFolder: "",
    ersApiKey: "",
    ersDevKey: "",
    ioAccountId: "",
    ioApiKey: "",
    ioLocationId: "",
    aaaCampaignId: "",
    agencyAnalyticsUrl: "",
    ecommPlatform: "",
    googleAdsCustomerId: "",
    ga4PropertyId: "",
    metaAdAccountId: "",
    location: "",
    sheetsSpreadsheetId: "",
    sheetsCell: "",
  });

  const { data: managers } = useQuery<Manager[]>({ queryKey: ["/api/managers"] });
  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients", selectedManager],
    queryFn: () =>
      apiRequest("GET", `/api/clients${selectedManager ? `?managerId=${selectedManager}` : ""}`).then(
        (r) => r.json()
      ),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/clients", data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setShowDialog(false);
      toast({ title: "Client added" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest("PATCH", `/api/clients/${id}`, data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setShowDialog(false);
      toast({ title: "Client updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/clients/${id}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Client removed" });
    },
  });

  function openNew() {
    setEditingClient(null);
    setForm({
      name: "",
      managerId: managers?.[0]?.id ?? "",
      platform: "ERS",
      ersFolder: "",
      ersApiKey: "",
      ioAccountId: "",
      ioApiKey: "",
      ioLocationId: "",
      aaaCampaignId: "",
      ecommPlatform: "",
      googleAdsCustomerId: "",
      ga4PropertyId: "",
      metaAdAccountId: "",
      location: "",
      sheetsSpreadsheetId: "",
      sheetsCell: "",
    });
    setShowDialog(true);
  }

  function openEdit(client: Client) {
    setEditingClient(client);
    setForm({
      name: client.name,
      managerId: client.managerId,
      platform: client.platform,
      ersFolder: client.ersFolder ?? "",
      ersApiKey: client.ersApiKey ?? "",
      ersDevKey: (client as any).ersDevKey ?? "",
      ioAccountId: client.ioAccountId ?? "",
      ioApiKey: client.ioApiKey ?? "",
      ioLocationId: client.ioLocationId ?? "",
      aaaCampaignId: client.aaaCampaignId ?? "",
      agencyAnalyticsUrl: client.agencyAnalyticsUrl ?? "",
      ecommPlatform: client.ecommPlatform ?? "",
      googleAdsCustomerId: client.googleAdsCustomerId ?? "",
      ga4PropertyId: client.ga4PropertyId ?? "",
      metaAdAccountId: client.metaAdAccountId ?? "",
      location: client.location ?? "",
      sheetsSpreadsheetId: client.sheetsSpreadsheetId ?? "",
      sheetsCell: client.sheetsCell ?? "",
    });
    setShowDialog(true);
  }

  function handleSubmit() {
    const payload = {
      ...form,
      ersFolder: form.ersFolder || null,
      ersApiKey: form.ersApiKey || null,
      ersDevKey: form.ersDevKey || null,
      ioAccountId: form.ioAccountId || null,
      ioApiKey: form.ioApiKey || null,
      ioLocationId: form.ioLocationId || null,
      aaaCampaignId: form.aaaCampaignId || null,
      agencyAnalyticsUrl: form.agencyAnalyticsUrl || null,
      ecommPlatform: form.ecommPlatform || null,
      googleAdsCustomerId: form.googleAdsCustomerId || null,
      ga4PropertyId: form.ga4PropertyId || null,
      metaAdAccountId: form.metaAdAccountId || null,
      location: form.location || null,
      sheetsSpreadsheetId: form.sheetsSpreadsheetId || null,
      sheetsCell: form.sheetsCell || null,
      active: true,
    };
    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const MANAGER_COLORS: Record<string, string> = {
    jarvis: "hsl(93, 48%, 55%)",
    jan: "hsl(160, 55%, 42%)",
    adriana: "hsl(37, 91%, 55%)",
  };

  const getManager = (id: string) => managers?.find((m) => m.id === id);

  return (
    <div className="dashboard-grid">
      <Sidebar
        managers={managers ?? []}
        selectedManager={selectedManager}
        onSelectManager={setSelectedManager}
      />
      <main className="main-area bg-background">
        <div className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Clients</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage client assignments and platform connections
            </p>
          </div>
          <Button
            size="sm"
            onClick={openNew}
            data-testid="button-add-client"
            className="gap-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Client
          </Button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {clients?.map((client) => {
              const mgr = getManager(client.managerId);
              const mgrColor = MANAGER_COLORS[client.managerId] ?? mgr?.color ?? "#6366f1";
              return (
                <Card
                  key={client.id}
                  className="bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors"
                  data-testid={`card-client-${client.id}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-foreground text-sm">{client.name}</h3>
                      {client.location && (
                        <p className="text-xs text-muted-foreground mt-0.5">{client.location}</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(client)}
                        data-testid={`button-edit-${client.id}`}
                        className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Remove ${client.name}?`)) deleteMutation.mutate(client.id);
                        }}
                        data-testid={`button-delete-${client.id}`}
                        className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`badge-${client.platform} inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border`}
                    >
                      {PLATFORM_LABELS[client.platform] ?? client.platform}
                    </span>
                    {mgr && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: mgrColor + "20", color: mgrColor }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: mgrColor }}
                        />
                        {mgr.name}
                      </span>
                    )}
                  </div>
                  {client.platform === "ERS" && client.ersFolder && (
                    <p className="text-xs text-muted-foreground mt-2 font-mono">
                      {client.ersFolder}.ourers.com
                    </p>
                  )}
                  {client.aaaCampaignId && (
                    <p className="text-xs text-muted-foreground mt-1">
                      AA Campaign: {client.aaaCampaignId}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      </main>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-card border-border max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editingClient ? "Edit Client" : "Add Client"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Client Name</Label>
              <Input
                data-testid="input-client-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Rockin Bounce"
                className="bg-secondary border-border"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Manager</Label>
                <Select
                  value={form.managerId}
                  onValueChange={(v) => setForm({ ...form, managerId: v })}
                >
                  <SelectTrigger data-testid="select-manager" className="bg-secondary border-border">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {managers?.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Platform</Label>
                <Select
                  value={form.platform}
                  onValueChange={(v) => setForm({ ...form, platform: v })}
                >
                  <SelectTrigger data-testid="select-platform" className="bg-secondary border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PLATFORM_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Location (City, State)</Label>
              <Input
                data-testid="input-location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Lakeland, FL"
                className="bg-secondary border-border"
              />
            </div>
            {form.platform === "ERS" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">ERS Folder Name</Label>
                  <Input
                    data-testid="input-ers-folder"
                    value={form.ersFolder}
                    onChange={(e) => setForm({ ...form, ersFolder: e.target.value })}
                    placeholder="e.g. rockinbounce"
                    className="bg-secondary border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">ERS API Token</Label>
                  <Input
                    data-testid="input-ers-apikey"
                    type="password"
                    value={form.ersApiKey}
                    onChange={(e) => setForm({ ...form, ersApiKey: e.target.value })}
                    placeholder="From Admin > API Info (token)"
                    className="bg-secondary border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">ERS Developer API Key</Label>
                  <Input
                    data-testid="input-ers-devkey"
                    type="password"
                    value={form.ersDevKey}
                    onChange={(e) => setForm({ ...form, ersDevKey: e.target.value })}
                    placeholder="From Admin > API Keys"
                    className="bg-secondary border-border"
                  />
                </div>
              </>
            )}
            {form.platform === "IO" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">IO Account ID</Label>
                  <Input
                    data-testid="input-io-id"
                    value={form.ioAccountId}
                    onChange={(e) => setForm({ ...form, ioAccountId: e.target.value })}
                    className="bg-secondary border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">IO API Key</Label>
                  <Input
                    data-testid="input-io-apikey"
                    type="password"
                    value={form.ioApiKey}
                    onChange={(e) => setForm({ ...form, ioApiKey: e.target.value })}
                    className="bg-secondary border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">IO Location ID <span className="text-muted-foreground/60">(multi-location only)</span></Label>
                  <Input
                    data-testid="input-io-location-id"
                    value={form.ioLocationId}
                    onChange={(e) => setForm({ ...form, ioLocationId: e.target.value })}
                    placeholder="e.g. 42 — from Warehouse → Addresses URL"
                    className="bg-secondary border-border"
                  />
                </div>
              </>
            )}
            {form.platform === "ECOMM" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Platform</Label>
                <Input
                  data-testid="input-ecomm-platform"
                  value={form.ecommPlatform}
                  onChange={(e) => setForm({ ...form, ecommPlatform: e.target.value })}
                  placeholder="shopify / woocommerce / etc"
                  className="bg-secondary border-border"
                />
              </div>
            )}
            {form.platform === "SHEETS" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Google Sheets — Spreadsheet ID</Label>
                  <Input
                    value={form.sheetsSpreadsheetId}
                    onChange={(e) => setForm({ ...form, sheetsSpreadsheetId: e.target.value })}
                    placeholder="From the Google Sheets URL"
                    className="bg-secondary border-border font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">Found in the URL: /spreadsheets/d/<strong>ID</strong>/edit</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Cell Reference</Label>
                  <Input
                    value={form.sheetsCell}
                    onChange={(e) => setForm({ ...form, sheetsCell: e.target.value })}
                    placeholder="e.g. PODS 2.0!V1"
                    className="bg-secondary border-border font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Include the tab name, e.g. <strong>PODS 2.0!V1</strong></p>
                </div>
              </>
            )}
            {/* Google Ads + GA4 */}
            <div className="pt-1 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Google Ads + GA4</p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Google Ads Customer ID</Label>
                  <Input
                    data-testid="input-google-ads-id"
                    value={form.googleAdsCustomerId}
                    onChange={(e) => setForm({ ...form, googleAdsCustomerId: e.target.value })}
                    placeholder="10-digit ID, digits only"
                    className="bg-secondary border-border font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">GA4 Property ID</Label>
                  <Input
                    data-testid="input-ga4-id"
                    value={form.ga4PropertyId}
                    onChange={(e) => setForm({ ...form, ga4PropertyId: e.target.value })}
                    placeholder="e.g. 123456789"
                    className="bg-secondary border-border font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Meta Ads */}
            <div className="pt-1 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Meta Ads</p>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Ad Account ID</Label>
                <Input
                  data-testid="input-meta-ad-account"
                  value={form.metaAdAccountId}
                  onChange={(e) => setForm({ ...form, metaAdAccountId: e.target.value })}
                  placeholder="act_XXXXXXXXX"
                  className="bg-secondary border-border font-mono"
                />
              </div>
            </div>

            {/* Agency Analytics */}
            <div className="pt-1 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Agency Analytics</p>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">AA Campaign ID</Label>
                <Input
                  data-testid="input-aaa-id"
                  value={form.aaaCampaignId}
                  onChange={(e) => setForm({ ...form, aaaCampaignId: e.target.value })}
                  placeholder="From Agency Analytics"
                  className="bg-secondary border-border font-mono"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowDialog(false)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.name || !form.managerId || createMutation.isPending || updateMutation.isPending}
              data-testid="button-submit-client"
            >
              {editingClient ? "Save Changes" : "Add Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
