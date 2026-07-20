import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BookOpenCheck,
  CirclePause,
  ExternalLink,
  FileSearch,
  Loader2,
  Newspaper,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  deleteApprovedBlogSource,
  getApprovedBlogSources,
  getBlogAutomationDashboard,
  getBlogOperations,
  runBlogOperation,
  runBlogTrendAction,
  saveApprovedBlogSource,
  testApprovedBlogSource,
} from "../../lib/blog/client";
import type {
  BlogApprovedSource,
  BlogOperationsSnapshot,
} from "../../lib/blog/types";
import { Notice, Panel } from "../ui/page-system";
import { StatusBadge } from "../ui/visual-system";

type Tab = "sources" | "trends" | "operations";
const EMPTY_SOURCE: Partial<BlogApprovedSource> = {
  name: "",
  publisher: "",
  sourceUrl: "",
  feedType: "rss",
  topicClusters: [],
  trustLevel: "unverified",
  classification: "secondary",
  enabled: true,
  fetchFrequencyMinutes: 360,
  notes: "",
};

function date(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not yet";
}

export default function BlogProviderFreeWorkspace() {
  const [tab, setTab] = useState<Tab>("sources");
  const [sources, setSources] = useState<BlogApprovedSource[]>([]);
  const [discoveries, setDiscoveries] = useState<Array<Record<string, any>>>(
    [],
  );
  const [operations, setOperations] = useState<BlogOperationsSnapshot | null>(
    null,
  );
  const [jobs, setJobs] = useState<Array<Record<string, any>>>([]);
  const [fixtureAvailable, setFixtureAvailable] = useState(false);
  const [liveProviderAvailable, setLiveProviderAvailable] = useState(false);
  const [draft, setDraft] = useState<Partial<BlogApprovedSource>>(EMPTY_SOURCE);
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setBusy("load");
    try {
      const [sourceData, dashboard, operationData] = await Promise.all([
        getApprovedBlogSources(),
        getBlogAutomationDashboard(),
        getBlogOperations(),
      ]);
      setSources(sourceData.sources);
      setDiscoveries(dashboard.discoveries);
      setOperations(operationData.snapshot);
      setJobs(operationData.jobs);
      setFixtureAvailable(Boolean(dashboard.provider.fixtureAvailable));
      setLiveProviderAvailable(Boolean(dashboard.provider.enabled && dashboard.provider.configured));
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Editorial operations could not be loaded.",
      );
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const run = async (
    key: string,
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The operation could not be completed.",
      );
    } finally {
      setBusy("");
    }
  };
  const runProtectedOperation = (
    key: string,
    action: string,
    success: string,
    targetId = "",
    confirmation = "",
  ) => {
    if (confirmation && !window.confirm(confirmation)) return;
    const reason = window.prompt("Reason for this administrator action?");
    if (!reason?.trim()) return;
    void run(
      key,
      () => runBlogOperation(action, reason.trim(), targetId),
      success,
    );
  };
  const operationMetrics = useMemo(
    () =>
      operations
        ? [
            ["Execution", operations.execution],
            ["Provider", operations.provider],
            ["Structured model", operations.structuredModel],
            ["Writer model", operations.writerModel],
            ["Provider status", operations.providerStatus.replaceAll("_", " ")],
            ["Last dispatch", date(operations.lastDispatchAt)],
            ["Last completed stage", date(operations.lastSuccessfulStageAt)],
            ["Recovered jobs", operations.recoveredJobs],
            ["Provider pause", date(operations.providerPauseUntil)],
            ["Active jobs", operations.activeJobs],
            ["Failed jobs", operations.failedJobs],
            ["Stale leases", operations.staleLeases],
            ["Source failures", operations.sourceFailures],
            ["Stale sources", operations.staleSources],
            ["Image failures", operations.imageFailures],
            ["HTML failures", operations.prerenderFailures],
            ["Migration", operations.migrationVersion],
          ]
        : [],
    [operations],
  );
  const saveSource = () =>
    run(
      "save-source",
      async () => {
        await saveApprovedBlogSource(draft, editingId || undefined);
        setDraft(EMPTY_SOURCE);
        setEditingId("");
      },
      editingId ? "Approved source updated." : "Approved source added.",
    );

  return (
    <Panel className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-foreground">
            Editorial operations
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Manage approved evidence, review timely opportunities, and inspect
            publishing health without a generation-provider key.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy === "load"}
          className="quiet-button"
        >
          {busy === "load" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}{" "}
          Refresh
        </button>
      </div>
      {error && (
        <div className="mt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {message && (
        <div className="mt-4">
          <Notice tone="success">{message}</Notice>
        </div>
      )}
      <div
        className="mt-5 inline-flex rounded-lg bg-muted p-1"
        role="tablist"
        aria-label="Editorial operations"
      >
        {(
          [
            ["sources", BookOpenCheck, "Sources"],
            ["trends", Newspaper, "News and trends"],
            ["operations", Activity, "Operations"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${tab === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "sources" && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveSource();
            }}
            className="rounded-lg border border-border p-4"
          >
            <h4 className="font-semibold text-foreground">
              {editingId ? "Edit approved source" : "Add approved source"}
            </h4>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Source name</span>
                <input
                  value={draft.name || ""}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      name: event.target.value,
                    }))
                  }
                  className="suite-input"
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Publisher</span>
                <input
                  value={draft.publisher || ""}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      publisher: event.target.value,
                    }))
                  }
                  className="suite-input"
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">
                  Public HTTPS source
                </span>
                <input
                  type="url"
                  value={draft.sourceUrl || ""}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      sourceUrl: event.target.value,
                    }))
                  }
                  className="suite-input"
                  required
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Type</span>
                  <select
                    value={draft.feedType}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        feedType: event.target
                          .value as BlogApprovedSource["feedType"],
                      }))
                    }
                    className="suite-input"
                  >
                    <option value="rss">RSS</option>
                    <option value="atom">Atom</option>
                    <option value="official_blog">Official blog</option>
                    <option value="changelog">Changelog</option>
                    <option value="release_notes">Release notes</option>
                    <option value="manual_url">Manual URL</option>
                    <option value="imported">Imported record</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Trust</span>
                  <select
                    value={draft.trustLevel}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        trustLevel: event.target
                          .value as BlogApprovedSource["trustLevel"],
                      }))
                    }
                    className="suite-input"
                  >
                    <option value="unverified">Unverified</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Topic clusters</span>
                <input
                  value={(draft.topicClusters || []).join(", ")}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      topicClusters: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    }))
                  }
                  className="suite-input"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.classification === "primary"}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      classification: event.target.checked
                        ? "primary"
                        : "secondary",
                    }))
                  }
                />{" "}
                Primary source
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.enabled !== false}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      enabled: event.target.checked,
                    }))
                  }
                />{" "}
                Enabled
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={Boolean(busy)}
                className="trust-button"
              >
                <Save className="h-4 w-4" /> Save source
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId("");
                    setDraft(EMPTY_SOURCE);
                  }}
                  className="quiet-button"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          <div className="min-w-0 space-y-3">
            {sources.map((source) => (
              <article
                key={source.id}
                className="rounded-lg border border-border p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-foreground">
                        {source.name}
                      </h4>
                      <StatusBadge
                        tone={source.enabled ? "success" : "neutral"}
                      >
                        {source.enabled ? "Active" : "Paused"}
                      </StatusBadge>
                      <StatusBadge
                        tone={
                          source.classification === "primary"
                            ? "accent"
                            : "neutral"
                        }
                      >
                        {source.classification}
                      </StatusBadge>
                    </div>
                    <a
                      href={source.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 flex items-center gap-1 break-all text-sm text-accent"
                    >
                      {source.publisher}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Last success: {date(source.lastSuccessfulFetch)} · Latest
                      item: {date(source.latestItemDate)} · Duplicates:{" "}
                      {source.duplicateItemCount}
                    </p>
                    {source.safeFailureCode && (
                      <p className="mt-1 text-xs text-red-600">
                        Safe failure: {source.safeFailureCode}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void run(
                          `test-${source.id}`,
                          () => testApprovedBlogSource(source.id),
                          "Source validation completed.",
                        )
                      }
                      className="quiet-button"
                    >
                      <ShieldCheck className="h-4 w-4" /> Test source
                    </button>
                    <button
                      type="button"
                      disabled={!source.enabled || Boolean(busy)}
                      title={
                        source.enabled
                          ? ""
                          : "Resume this source before fetching it."
                      }
                      onClick={() =>
                        void run(
                          `fetch-${source.id}`,
                          () => testApprovedBlogSource(source.id),
                          "Source fetched and freshness details updated.",
                        )
                      }
                      className="quiet-button"
                    >
                      <Play className="h-4 w-4" /> Fetch now
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(source.id);
                        setDraft(source);
                      }}
                      className="quiet-button"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `${source.enabled ? "Pause" : "Resume"} ${source.name}?`,
                          )
                        )
                          void run(
                            `toggle-${source.id}`,
                            () =>
                              saveApprovedBlogSource(
                                { ...source, enabled: !source.enabled },
                                source.id,
                              ),
                            source.enabled
                              ? "Source paused."
                              : "Source resumed.",
                          );
                      }}
                      className="quiet-button"
                    >
                      <CirclePause className="h-4 w-4" />{" "}
                      {source.enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${source.name}`}
                      onClick={() => {
                        const reason = window.prompt(
                          "Reason for deleting this approved source?",
                        );
                        if (reason)
                          void run(
                            `delete-${source.id}`,
                            () => deleteApprovedBlogSource(source.id, reason),
                            "Source deleted.",
                          );
                      }}
                      className="quiet-button text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {!sources.length && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No approved sources yet. Add an official RSS or Atom feed to
                begin.
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "trends" && (
        <div className="mt-5 space-y-3">
          {discoveries.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-border p-4"
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      tone={
                        item.freshness_status === "high"
                          ? "success"
                          : item.freshness_status === "medium"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {item.freshness_status || "unverified"}
                    </StatusBadge>
                    <StatusBadge
                      tone={item.primary_source ? "accent" : "neutral"}
                    >
                      {item.primary_source
                        ? "Primary source"
                        : "Authoritative reference"}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(Number(item.age_hours || 0))} hours old
                    </span>
                  </div>
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block font-semibold text-foreground hover:text-accent"
                  >
                    {item.source_title}
                  </a>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.publisher} ·{" "}
                    {date(item.source_updated_at || item.published_at)} ·{" "}
                    {item.topic_cluster || "Unassigned cluster"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-foreground">
                    {item.proposed_angle ||
                      item.priority_reason ||
                      "Awaiting an editorial angle."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Traffic data unavailable ·{" "}
                    {item.existing_coverage
                      ? "Existing coverage found"
                      : "No duplicate coverage recorded"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 lg:max-w-72 lg:justify-end">
                  {[
                    ["create_draft", "Create sourced draft"],
                    ["add_to_calendar", "Add to calendar"],
                    ["add_to_research", "Add to research"],
                    ["link_existing", "Link to article"],
                    ["convert_update", "Article update"],
                    ["monitor", "Monitor"],
                    ["mark_covered", "Already covered"],
                    ["dismiss", "Dismiss"],
                  ].map(([action, label]) => (
                    <button
                      key={action}
                      type="button"
                      disabled={action === "create_draft" && !liveProviderAvailable}
                      title={
                        action === "create_draft" && !liveProviderAvailable
                          ? "Connect and enable Groq to create a sourced draft."
                          : ""
                      }
                      onClick={() =>
                        void run(
                          `${action}-${item.id}`,
                          () => runBlogTrendAction(item.id, action),
                          `${label} saved.`,
                        )
                      }
                      className={
                        action === "create_draft"
                          ? "trust-button"
                          : "quiet-button"
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          ))}
          {!discoveries.length && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No discoveries yet. Test an approved feed, then run freshness
              discovery.
            </div>
          )}
        </div>
      )}

      {tab === "operations" && (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {operationMetrics.map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-border p-4"
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold capitalize text-foreground">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                runProtectedOperation(
                  "validate-sitemap",
                  "validate_sitemap",
                  "Sitemap output regenerated and validated.",
                )
              }
              className="quiet-button"
            >
              <ShieldCheck className="h-4 w-4" /> Regenerate sitemap
            </button>
            <button
              type="button"
              onClick={() =>
                runProtectedOperation(
                  "validate-rss",
                  "validate_rss",
                  "RSS output regenerated and validated.",
                )
              }
              className="quiet-button"
            >
              <FileSearch className="h-4 w-4" /> Regenerate RSS
            </button>
            <button
              type="button"
              onClick={() =>
                runProtectedOperation(
                  "pause-auto",
                  "pause_automation",
                  "Automation paused.",
                  "",
                  "Pause all automatic blog discovery?",
                )
              }
              className="quiet-button"
            >
              <CirclePause className="h-4 w-4" /> Pause automation
            </button>
            <button
              type="button"
              onClick={() =>
                runProtectedOperation(
                  "pause-publish",
                  "pause_publication",
                  "Publication paused.",
                  "",
                  "Pause all scheduled blog publication?",
                )
              }
              className="quiet-button"
            >
              <CirclePause className="h-4 w-4" /> Pause publication
            </button>
            {fixtureAvailable && (
              <button
                type="button"
                onClick={() =>
                  runProtectedOperation(
                    "reset-fixtures",
                    "reset_fixture_data",
                    "Fixture test records removed.",
                    "",
                    "Delete all fixture-generated drafts and jobs?",
                  )
                }
                className="quiet-button text-red-600"
              >
                <Trash2 className="h-4 w-4" /> Reset fixture data
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">Job</th>
                  <th className="p-3">Provider</th>
                  <th className="p-3">Stage</th>
                  <th className="p-3">Updated</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t border-border">
                    <td className="max-w-80 p-3">
                      <span className="line-clamp-2">
                        {job.customHeadline || job.topic || job.id}
                      </span>
                    </td>
                    <td className="p-3">
                      {job.provider === "fixture_test"
                        ? "Fixture test content"
                        : job.provider}
                    </td>
                    <td className="p-3">
                      <StatusBadge
                        tone={
                          job.state === "failed"
                            ? "danger"
                            : job.state === "ready_for_review"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {String(job.workflowStage || job.state).replaceAll("_", " ")}
                      </StatusBadge>
                      <span className="mt-1 block text-xs text-muted-foreground">{job.stageProgress || 0}% · attempt {job.stageAttemptCount || 0}</span>
                    </td>
                    <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">
                      {date(job.updatedAt)}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        {job.state === "failed" && (
                          <button
                            type="button"
                            onClick={() =>
                              runProtectedOperation(
                                `retry-${job.id}`,
                                "retry_job",
                                "Job queued for retry.",
                                job.id,
                              )
                            }
                            className="quiet-button"
                          >
                            Retry
                          </button>
                        )}
                        {job.leaseExpiresAt &&
                          new Date(job.leaseExpiresAt).getTime() < Date.now() &&
                          !["published", "cancelled", "failed"].includes(
                            job.state,
                          ) && (
                            <button
                              type="button"
                              onClick={() =>
                                runProtectedOperation(
                                  `recover-${job.id}`,
                                  "recover_stale_job",
                                  "Stale job recovered.",
                                  job.id,
                                )
                              }
                              className="quiet-button"
                            >
                              Recover
                            </button>
                          )}
                        {!["published", "cancelled"].includes(job.state) && (
                          <button
                            type="button"
                            onClick={() => {
                              runProtectedOperation(
                                `cancel-${job.id}`,
                                "cancel_job",
                                "Job cancelled.",
                                job.id,
                                "Cancel this blog job?",
                              );
                            }}
                            className="quiet-button"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}
