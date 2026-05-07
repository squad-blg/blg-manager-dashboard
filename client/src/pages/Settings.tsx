import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Key, AlertTriangle, CheckCircle2, Upload, FileText, Trash2, Loader2, Sparkles, RefreshCw } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import type { Manager } from "@/pages/Dashboard";
import { useToast } from "@/hooks/use-toast";

type Document = {
  id: string;
  originalName: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string | null;
  status: string;
};

type Credential = {
  id: string;
  service: string;
  key: string;
  label: string | null;
  updatedAt: string;
};

const SERVICE_INFO: Record<string, { name: string; description: string; docsUrl?: string; placeholder?: string; multiField?: boolean }> = {
  claude: {
    name: "Claude (Anthropic) — AI Assistant",
    description: "Powers the BLG Intelligence chat. DMMs can ask questions about their data.",
    docsUrl: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-...",
  },
  google_oauth: {
    name: "Google OAuth (Ads + GA4)",
    description: "One token covers both Google Ads and GA4 for all clients. Format: clientId|clientSecret|refreshToken (pipe-separated).",
    docsUrl: "https://developers.google.com/identity/protocols/oauth2",
    placeholder: "clientId|clientSecret|refreshToken",
    multiField: true,
  },
  google_mcc_id: {
    name: "Google Ads MCC Customer ID",
    description: "Your agency Manager Account (MCC) customer ID — digits only, no dashes (e.g. 1234567890).",
    placeholder: "1234567890",
  },
  meta_app: {
    name: "Meta App Credentials",
    description: "Facebook App ID and Secret for token refresh. Format: appId|appSecret (pipe-separated).",
    docsUrl: "https://developers.facebook.com/apps",
    placeholder: "appId|appSecret",
    multiField: true,
  },
  meta_token: {
    name: "Meta Long-Lived Access Token",
    description: "Long-lived token (~60 days). Use the Refresh button below to extend it before it expires.",
    docsUrl: "https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived",
    placeholder: "EAAxxxxx...",
  },
  agency_analytics: {
    name: "Agency Analytics",
    description: "Used for client list sync and campaign mapping.",
    docsUrl: "https://help.agencyanalytics.com/en/articles/8219563-using-the-api",
    placeholder: "Your AA API key",
  },
};

export default function SettingsPage() {
  const { toast } = useToast();
  const [selectedManager, setSelectedManager] = useState<string | null>(null);
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});

  const { data: managers } = useQuery<Manager[]>({ queryKey: ["/api/managers"] });
  const { data: credentials } = useQuery<Credential[]>({ queryKey: ["/api/credentials"] });

  const saveMutation = useMutation({
    mutationFn: ({ service, key }: { service: string; key: string }) =>
      apiRequest("POST", "/api/credentials", {
        id: service,
        service,
        key,
        label: SERVICE_INFO[service]?.name ?? service,
      }).then((r) => r.json()),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      setDraftKeys((prev) => {
        const next = { ...prev };
        delete next[vars.service];
        return next;
      });
      toast({ title: "API key saved" });
    },
  });

  const getExisting = (service: string) => credentials?.find((c) => c.service === service);

  const [syncing, setSyncing] = useState(false);
  const [refreshingMeta, setRefreshingMeta] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await apiRequest("POST", "/api/sync", {});
      toast({ title: "Sync started", description: "Data is being fetched from all configured platforms." });
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message });
    } finally {
      setSyncing(false);
    }
  }

  async function handleMetaRefresh() {
    setRefreshingMeta(true);
    try {
      await apiRequest("POST", "/api/refresh/meta", {});
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      toast({ title: "Meta token refreshed", description: "Token extended for another ~60 days." });
    } catch (e: any) {
      toast({ title: "Meta refresh failed", description: e.message });
    } finally {
      setRefreshingMeta(false);
    }
  }

  const SERVICES = ["claude", "google_oauth", "google_mcc_id", "meta_app", "meta_token", "agency_analytics"];

  // Document state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docDescription, setDocDescription] = useState("");
  const [uploadProgress, setUploadProgress] = useState(false);

  const { data: documents = [], refetch: refetchDocs } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  const deletDocMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/documents/${id}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Document removed" });
    },
  });

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadProgress(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (docDescription.trim()) formData.append("description", docDescription.trim());
      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      toast({ title: "Document uploaded", description: "Processing text in background..." });
      setDocDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => refetchDocs(), 2000);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message });
    } finally {
      setUploadProgress(false);
    }
  }

  return (
    <div className="dashboard-grid">
      <Sidebar
        managers={managers ?? []}
        selectedManager={selectedManager}
        onSelectManager={setSelectedManager}
      />
      <main className="main-area bg-background">
        <div className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border px-6 py-4">
          <h1 className="text-lg font-semibold text-foreground">Settings</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            API credentials and integration configuration
          </p>
        </div>

        <div className="p-6 space-y-6 max-w-2xl">

          {/* Sync Data */}
          <Card className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Sync Data</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Fetch the current month's revenue and analytics from all configured platforms.
                </p>
              </div>
              <Button size="sm" onClick={handleSync} disabled={syncing} className="gap-1.5">
                {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {syncing ? "Syncing..." : "Sync Now"}
              </Button>
            </div>
          </Card>

          {/* API Keys */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-4">API Integrations</h2>
            <div className="space-y-4">
              {SERVICES.map((service) => {
                const info = SERVICE_INFO[service];
                const existing = getExisting(service);
                const draft = draftKeys[service] ?? "";
                const hasKey = Boolean(existing);

                return (
                  <Card
                    key={service}
                    className="bg-card border border-border rounded-lg p-5"
                    data-testid={`settings-card-${service}`}
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <Key className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground">{info.name}</h3>
                          {hasKey ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" /> Connected
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-amber-400">
                              <AlertTriangle className="w-3 h-3" /> Not configured
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{info.description}</p>
                        {info.docsUrl && (
                          <a
                            href={info.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline mt-0.5 inline-block"
                          >
                            View API docs →
                          </a>
                        )}
                      </div>
                    </div>

                    {hasKey && (
                      <div className="mb-3 px-3 py-2 bg-secondary rounded-md">
                        <p className="text-xs text-muted-foreground font-mono">{existing?.key}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Updated{" "}
                          {existing?.updatedAt
                            ? new Date(existing.updatedAt).toLocaleDateString()
                            : "—"}
                        </p>
                        {/* Meta token expiry warning — tokens last ~60 days */}
                        {service === "meta_token" && existing?.updatedAt && (() => {
                          const daysSince = Math.floor(
                            (Date.now() - new Date(existing.updatedAt).getTime()) / 86_400_000
                          );
                          const daysLeft = 60 - daysSince;
                          if (daysLeft <= 0) {
                            return (
                              <p className="text-xs font-semibold text-red-500 mt-1">
                                ⚠️ Token likely expired ({daysSince} days old) — refresh now or Meta data will show $0
                              </p>
                            );
                          }
                          if (daysLeft <= 14) {
                            return (
                              <p className="text-xs font-semibold text-amber-500 mt-1">
                                ⚠️ Token expires in ~{daysLeft} days — refresh soon
                              </p>
                            );
                          }
                          return (
                            <p className="text-xs text-emerald-500 mt-1">
                              ✓ Token valid (~{daysLeft} days remaining)
                            </p>
                          );
                        })()}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Input
                        data-testid={`input-key-${service}`}
                        type="password"
                        value={draft}
                        onChange={(e) =>
                          setDraftKeys((prev) => ({ ...prev, [service]: e.target.value }))
                        }
                        placeholder={hasKey ? "Enter new value to replace..." : (info.placeholder ?? "Enter value...")}
                        className="bg-secondary border-border text-sm flex-1 font-mono"
                      />
                      <Button
                        size="sm"
                        disabled={!draft.trim() || saveMutation.isPending}
                        onClick={() => saveMutation.mutate({ service, key: draft.trim() })}
                        data-testid={`button-save-key-${service}`}
                        className="gap-1.5"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Save
                      </Button>
                      {service === "meta_token" && hasKey && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={refreshingMeta}
                          onClick={handleMetaRefresh}
                          className="gap-1.5"
                          title="Extend Meta token for another ~60 days"
                        >
                          {refreshingMeta ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          Refresh
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Trusted Documents */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4" style={{ color: "hsl(93, 48%, 55%)" }} />
              <h2 className="text-sm font-semibold text-foreground">AI Trusted Sources</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Upload documents that the AI assistant will use as a trusted knowledge base when answering questions.
              Supported: PDF, TXT, Markdown, CSV. Max 20MB per file.
            </p>

            {/* Upload area */}
            <Card className="bg-card border border-border rounded-lg p-5 mb-4">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Description (optional)</Label>
                  <Input
                    value={docDescription}
                    onChange={(e) => setDocDescription(e.target.value)}
                    placeholder="e.g. BLG Client Benchmarks Q1 2026"
                    className="bg-secondary border-border text-sm"
                    data-testid="input-doc-description"
                  />
                </div>
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-primary/50"
                  style={{ borderColor: "hsl(150, 12%, 22%)" }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadProgress ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      <p className="text-xs text-muted-foreground">Uploading...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="w-6 h-6 text-muted-foreground" />
                      <p className="text-sm text-foreground font-medium">Click to upload a document</p>
                      <p className="text-xs text-muted-foreground">PDF, TXT, Markdown, CSV up to 20MB</p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,.csv,text/*,application/pdf"
                  className="hidden"
                  onChange={handleFileUpload}
                  data-testid="input-file-upload"
                />
              </div>
            </Card>

            {/* Document list */}
            {documents.length > 0 && (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <Card
                    key={doc.id}
                    className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3"
                    data-testid={`doc-card-${doc.id}`}
                  >
                    <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{doc.originalName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {doc.description && (
                          <p className="text-xs text-muted-foreground truncate">{doc.description}</p>
                        )}
                        <span
                          className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                            doc.status === "ready"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : doc.status === "processing"
                              ? "bg-amber-500/10 text-amber-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {doc.status === "ready" ? "Ready" : doc.status === "processing" ? "Processing" : "Error"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {(doc.sizeBytes / 1024).toFixed(0)}KB
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => deletDocMutation.mutate(doc.id)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                      data-testid={`button-delete-doc-${doc.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </Card>
                ))}
              </div>
            )}

            {documents.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No documents uploaded yet. Add sources from Dustin to ground AI answers.
              </p>
            )}
          </div>

          {/* Integration notes */}
          <Card className="bg-card border border-amber-500/20 rounded-lg p-5">
            <div className="flex gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Integration Notes</h3>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  <li>
                    <strong className="text-foreground">ERS API:</strong> Per-client API keys are
                    set in the Clients page (platform = ERS). The key lives at Admin → API Info in
                    each ERS folder. Rate limit: 300 calls per 300 seconds.
                  </li>
                  <li>
                    <strong className="text-foreground">Inflatable Office:</strong> IO's API is not
                    publicly documented yet. Once IO provides an endpoint and key, add it per-client
                    in the Clients page.
                  </li>
                  <li>
                    <strong className="text-foreground">Agency Analytics:</strong> The API supports
                    campaign read/write, user management, keyword rankings, and backlink data. It
                    does not push raw analytics from connected integrations (Google Ads, GA4 etc.) —
                    those live in AA's own dashboards. Use campaign IDs to map clients.
                  </li>
                  <li>
                    <strong className="text-foreground">Lead Gen clients:</strong> Revenue data
                    integrity depends on CRM accuracy. Flag these for manual review if numbers look
                    off.
                  </li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
