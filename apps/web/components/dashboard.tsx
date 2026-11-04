"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SquaresFour,
  ArrowsLeftRight,
  Stack,
  Key,
  BookOpen,
  GearSix,
  ArrowUpRight,
  ArrowRight,
  Plus,
  MagnifyingGlass,
  ArrowDown,
  X,
  Copy,
  Check,
  SignOut,
  ArrowClockwise,
  ShieldCheck,
  Circle,
  Code,
  DotsThree,
} from "@phosphor-icons/react";
import PaymentQr from "./payment-qr";
import { AppTools, PaymentTimeline, SetupChecklist } from "./gateway-tools";
import { integrationPrompt } from "../lib/integration-prompt";
import type { App, Payment } from "./models";
const nav = [
  { label: "Overview", icon: SquaresFour },
  { label: "Transactions", icon: ArrowsLeftRight },
  { label: "Needs attention", icon: ShieldCheck },
  { label: "Applications", icon: Stack },
  { label: "API keys", icon: Key },
  { label: "Integration", icon: BookOpen },
  { label: "Settings", icon: GearSix },
];
const money = (value: number) => new Intl.NumberFormat("en-US").format(value);
const when = (date: string) =>
  new Date(date).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Yangon",
  });
async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (res.status === 401) window.location.replace("/login");
  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
}
export default function Dashboard({ now }: { now: number }) {
  const [page, setPage] = useState("Overview");
  const [apps, setApps] = useState<App[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [configured, setConfigured] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All statuses");
  const [range, setRange] = useState("7");
  const [appFilter, setAppFilter] = useState("all");
  const [modal, setModal] = useState<"app" | null>(null);
  const [detail, setDetail] = useState<Payment | null>(null);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [gatewayOrigin, setGatewayOrigin] = useState("");
  useEffect(() => setGatewayOrigin(window.location.origin), []);
  const [busy, setBusy] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [report, setReport] = useState<{
    summary: {
      total: string;
      successful: string;
      volume: string;
      pending: string;
    };
    total: number;
    activity: number[];
    mode: string;
  } | null>(null);
  const loadId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const reportQuery = useCallback(
    () =>
      new URLSearchParams({
        days: range,
        app: appFilter,
        search,
        status: status === "All statuses" ? "" : status,
        attention: String(page === "Needs attention"),
        page: String(pageIndex),
        limit: page === "Overview" ? "5" : "25",
      }).toString(),
    [range, appFilter, search, status, page, pageIndex],
  );
  const load = useCallback(async () => {
    const id = ++loadId.current;
    const data = await api("admin/overview?" + reportQuery());
    if (id !== loadId.current) return;
    setApps(data.apps);
    setPayments(data.payments);
    setReport(data);
    setConfigured(data.configured);
  }, [reportQuery]);
  useEffect(() => {
    setPageIndex(1);
  }, [range, appFilter, search, status, page]);
  useEffect(() => {
    const timer = setTimeout(
      () => load().catch((e) => setError(e.message)),
      200,
    );
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        root.current
          ?.querySelector<HTMLInputElement>(
            '[aria-label="Search transactions"]',
          )
          ?.focus();
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        load().catch((e) => setError(e.message));
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("visible");
        }),
      { threshold: 0.05 },
    );
    root.current
      ?.querySelectorAll(".reveal")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [page, Boolean(report)]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!modal && !newKey && !detail) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = root.current?.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, a[href], select",
        ) || [],
      );
    (dialog?.querySelector<HTMLElement>("input") || focusable()[0])?.focus();
    function keydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setModal(null);
        setDetail(null);
        setNewKey("");
      }
      if (e.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [modal, newKey, Boolean(detail)]);
  const volume = Number(report?.summary.volume || 0);
  const totalPayments = Number(report?.summary.total || 0);
  const completedPayments = Number(report?.summary.successful || 0);
  const pendingPayments = Number(report?.summary.pending || 0);
  const filtered = payments;
  const tableTotal = report?.total || 0;
  const visiblePayments = page === "Overview" ? payments.slice(0, 5) : payments;
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied to clipboard");
    } catch {
      setError("Clipboard unavailable. Select and copy the text manually.");
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const app = await api("admin/apps", "POST", { name });
      setNewKey(app.key);
      setModal(null);
      setName("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api("session", "DELETE");
      window.location.replace("/login");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function revoke(app: App) {
    if (
      !window.confirm(
        `Revoke the key for ${app.name}? This app will lose API access.`,
      )
    )
      return;
    try {
      await api(`admin/apps/${app.id}/key`, "DELETE");
      await load();
      setToast("API key revoked");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function exportCsv() {
    try {
      const response = await fetch(
        "/api/admin/payments/export?" + reportQuery(),
      );
      if (!response.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "byle-transactions.csv";
      link.click();
      URL.revokeObjectURL(url);
      setToast("All matching transactions exported");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const code = `const response = await fetch(\n  process.env.GATEWAY_URL + '/v1/payments',\n  {\n    method: 'POST',\n    headers: {\n      Authorization: 'Bearer ' + process.env.GATEWAY_KEY,\n      'Content-Type': 'application/json'\n    },\n    body: JSON.stringify({\n      orderId: 'order-1049',\n      amount: 25000,\n      currency: 'MMK'\n    })\n  }\n);\nif (!response.ok) throw new Error('Payment request failed');\nconst payment = await response.json();`;
  if (!report)
    return (
      <main className="checkout-shell">
        <section className="panel checkout-card">
          <div className="eyebrow">BYLE GATEWAY</div>
          <h1>
            {error
              ? "Your workspace could not load."
              : "Loading your workspace."}
          </h1>
          <p role={error ? "alert" : undefined}>
            {error || "Reading your applications and payments from PostgreSQL."}
          </p>
          {error && (
            <button
              className="primary"
              onClick={() => load().catch((e) => setError(e.message))}
            >
              Retry
            </button>
          )}
          <button className="secondary" onClick={logout} disabled={busy}>
            Sign out
          </button>
        </section>
      </main>
    );
  return (
    <div className="workspace" ref={root}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Byle Gateway home">
          <span className="brand-mark">
            b<span>.</span>
          </span>
          <span>
            Byle<span className="brand-sub">GATEWAY</span>
          </span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav>
          {nav.map(({ label, icon: Icon }, i) => (
            <button
              key={label}
              className={`${page === label ? "selected" : ""} ${i === 4 ? "nav-separated" : ""}`}
              onClick={() => {
                setPage(label);
                setSearch("");
              }}
            >
              <Icon size={19} weight={page === label ? "fill" : "regular"} />
              {label}
              {label === "Integration" && <span className="nav-arrow">↗</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="provider-note">
            <span className="provider-symbol">m</span>
            <div>
              MyanMyanPay
              <small>
                {configured ? "Provider configured" : "Setup required"}
              </small>
            </div>
            <span className={`tiny-dot ${!configured ? "yellow" : ""}`} />
          </div>
          <button className="owner" onClick={logout} disabled={busy}>
            <span className="avatar">B</span>
            <span>
              Personal account
              <small>Workspace owner</small>
            </span>
            <SignOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <span className="env-dot" />
            <span>
              {`${report?.mode === "sandbox" ? "Sandbox" : report?.mode === "live" ? "Live" : "Setup required"} workspace`}
            </span>
            <button
              className="icon-button"
              onClick={() => setPage("Integration")}
              aria-label="Open integration documentation"
            >
              <BookOpen size={19} />
            </button>
            <span className="avatar small">B</span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading reveal">
            <div>
              <div className="eyebrow">YOUR PAYMENT WORKSPACE</div>
              <h1>
                {page === "Overview"
                  ? "A clear view of your payments."
                  : page === "Integration"
                    ? "Build once. Accept payments anywhere."
                    : page === "Applications"
                      ? "One gateway. All your apps."
                      : page === "API keys"
                        ? "The keys to your applications."
                        : page === "Settings"
                          ? "A little setup. Then you’re ready."
                          : page === "Needs attention"
                            ? "Payments that need a closer look."
                            : "Every payment, accounted for."}
              </h1>
              <p>
                {page === "Overview"
                  ? "All your apps, transactions, and payment activity in one quiet place."
                  : page === "Needs attention"
                    ? "Review delayed confirmations, reconciliation errors, and failed webhook deliveries."
                    : page === "Transactions"
                      ? "Search, review, and export payment activity across your applications."
                      : page === "Integration"
                        ? "A small, consistent API for every app you build."
                        : page === "Settings"
                          ? "Your private workspace and payment provider configuration."
                          : "Manage access to your personal payment infrastructure."}
              </p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setModal("app");
                setError("");
              }}
            >
              <Plus size={16} weight="bold" /> Add application
            </button>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X />
              </button>
            </div>
          )}
          {(page === "Overview" ||
            page === "Transactions" ||
            page === "Needs attention") && (
            <>
              <div className="section-toolbar reveal">
                <div className="section-label">
                  {page === "Overview" ? "Payment overview" : "Payment history"}{" "}
                  <span className="muted">/ MMK</span>
                </div>
                <div className="filters">
                  <select
                    aria-label="Filter application"
                    value={appFilter}
                    onChange={(e) => setAppFilter(e.target.value)}
                  >
                    <option value="all">All applications</option>
                    {apps.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Date range"
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                  >
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="365">Last year</option>
                  </select>
                </div>
              </div>
              <section className="stats reveal">
                <div>
                  <span className="stat-label">
                    Collected volume <ArrowUpRight size={16} />
                  </span>
                  <div className="stat-number">
                    {money(volume)} <small>MMK</small>
                  </div>
                  <span className="stat-foot">
                    <span className="pastel green">
                      {completedPayments} completed
                    </span>{" "}
                    in selected period
                  </span>
                </div>
                <div>
                  <span className="stat-label">
                    Total transactions <ArrowsLeftRight size={16} />
                  </span>
                  <div className="stat-number">
                    {totalPayments}
                    <small>payments</small>
                  </div>
                  <span className="stat-foot">
                    Across {appFilter === "all" ? apps.length : 1} application
                    {appFilter === "all" ? "s" : ""}
                  </span>
                </div>
                <div>
                  <span className="stat-label">
                    Success rate <Circle size={16} />
                  </span>
                  <div className="stat-number">
                    {totalPayments
                      ? ((completedPayments / totalPayments) * 100).toFixed(1)
                      : "0"}
                    <small>%</small>
                  </div>
                  <span className="stat-foot">
                    <span className="tiny-dot" /> Based on selected transactions
                  </span>
                </div>
                <div>
                  <span className="stat-label">
                    Pending payments <ArrowClockwise size={16} />
                  </span>
                  <div className="stat-number">
                    {pendingPayments}
                    <small>payments</small>
                  </div>
                  <span className="stat-foot">
                    Awaiting payment confirmation
                  </span>
                </div>
              </section>
              {page === "Overview" && (
                <section className="middle-grid reveal">
                  <div className="chart-card panel">
                    <div className="card-heading">
                      <div>
                        <h2>Payment activity</h2>
                        <p>Collected volume over the last {range} days</p>
                      </div>
                      <span className="legend">
                        <span /> Successful payments
                      </span>
                    </div>
                    <ActivityChart
                      days={Number(range)}
                      now={now}
                      values={report?.activity || [0, 0, 0, 0, 0, 0, 0]}
                    />
                  </div>
                  <div className="applications-card panel">
                    <div className="card-heading">
                      <h2>
                        Your applications{" "}
                        <span className="count">{apps.length}</span>
                      </h2>
                      <button
                        className="icon-button"
                        onClick={() => setPage("Applications")}
                        aria-label="View applications"
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </div>
                    <div className="app-list">
                      {apps.slice(0, 3).map((a, i) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            setAppFilter(a.id);
                            setPage("Transactions");
                          }}
                        >
                          <span className={`app-icon tone-${i % 3}`}>
                            <Stack size={19} weight="fill" />
                          </span>
                          <span className="app-list-name">
                            {a.name}
                            <small>
                              {Number(a.payment_count || 0)} transactions
                            </small>
                          </span>
                          <span
                            className={`status-dot ${a.active ? "" : "inactive"}`}
                          />
                        </button>
                      ))}
                      {apps.length === 0 && (
                        <p className="empty">
                          Add your first application to get an API key.
                        </p>
                      )}
                    </div>
                    <button
                      className="text-link"
                      onClick={() => setPage("Applications")}
                    >
                      Manage applications <ArrowRight size={14} />
                    </button>
                  </div>
                </section>
              )}
              <section className="transactions panel reveal">
                <div className="card-heading">
                  <div>
                    <h2>
                      {page === "Overview"
                        ? "Recent transactions"
                        : "Transactions"}{" "}
                      <span className="count">{tableTotal}</span>
                    </h2>
                    <p>A running record of your payment activity.</p>
                  </div>
                  <button className="secondary" onClick={exportCsv}>
                    <ArrowDown size={15} />
                    Export CSV
                  </button>
                </div>
                <div className="table-tools">
                  <label className="search">
                    <MagnifyingGlass size={17} />
                    <input
                      aria-label="Search transactions"
                      placeholder="Search transactions…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <kbd>/</kbd>
                  </label>
                  <select
                    aria-label="Filter status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {[
                      "All statuses",
                      "SUCCESS",
                      "PENDING",
                      "FAILED",
                      "CREATING",
                      "CANCELLED",
                      "EXPIRED",
                      "REFUNDED",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Transaction</th>
                        <th>Application</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>
                          Date & time <ArrowDown size={11} />
                        </th>
                        <th>
                          <span className="sr-only">Details</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePayments.map((p) => (
                        <tr key={p.id} onClick={() => setDetail(p)}>
                          <td>
                            <span className="transaction-icon">
                              <ArrowsLeftRight size={15} />
                            </span>
                            <span className="mono">{p.order_id}</span>
                          </td>
                          <td>{p.app_name}</td>
                          <td className="amount">
                            {money(Number(p.amount))}
                            <span className="currency">MMK</span>
                          </td>
                          <td>
                            <Status status={p.status} />
                          </td>
                          <td className="date">{when(p.created_at)}</td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`View ${p.order_id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetail(p);
                              }}
                            >
                              <DotsThree size={21} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && (
                    <div className="empty">
                      <MagnifyingGlass size={25} />
                      <h3>No transactions found</h3>
                      <p>
                        Try another filter, or create a payment through your
                        app.
                      </p>
                    </div>
                  )}
                </div>
                <div className="table-footer">
                  <span>
                    Showing {visiblePayments.length} of {tableTotal} matching
                    transactions
                  </span>
                  {page !== "Overview" && tableTotal > 25 && (
                    <div className="pagination">
                      <button
                        disabled={pageIndex === 1}
                        onClick={() => setPageIndex(pageIndex - 1)}
                      >
                        Previous
                      </button>
                      <span>
                        Page {pageIndex} /{" "}
                        {Math.max(1, Math.ceil(tableTotal / 25))}
                      </span>
                      <button
                        disabled={pageIndex * 25 >= tableTotal}
                        onClick={() => setPageIndex(pageIndex + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                  {page === "Overview" && (
                    <button onClick={() => setPage("Transactions")}>
                      View all transactions <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </section>
            </>
          )}
          {(page === "Applications" || page === "API keys") && (
            <section className="panel app-management reveal">
              <div className="card-heading">
                <div>
                  <h2>{page}</h2>
                  <p>
                    Each app has an isolated API key. Secret keys are shown only
                    once.
                  </p>
                </div>
                <ShieldCheck size={25} />
              </div>
              {apps.length === 0 && (
                <div className="empty">
                  No applications yet. Add one to start accepting payments.
                </div>
              )}
              {apps.map((a, i) => (
                <div className="app-management-row" key={a.id}>
                  <span className={`app-icon tone-${i % 3}`}>
                    <Stack size={23} weight="fill" />
                  </span>
                  <div className="grow">
                    <h3>{a.name}</h3>
                    <code>{a.key_prefix}••••••••</code>
                    <small>Created {when(a.created_at)}</small>
                  </div>
                  <Status status={a.active ? "ACTIVE" : "REVOKED"} />
                  <AppTools
                    app={a}
                    onChange={load}
                    onSecret={setNewKey}
                    onError={setError}
                  />
                  <button
                    className="secondary danger"
                    disabled={!a.active}
                    onClick={() => revoke(a)}
                  >
                    Revoke key
                  </button>
                </div>
              ))}
            </section>
          )}
          {page === "Integration" && (
            <section className="integration-grid reveal">
              <div className="panel guide agent-prompt">
                <div className="card-heading">
                  <div>
                    <span className="step">INTEGRATE WITH AN AI AGENT</span>
                    <h2>Give your agent the payment contract.</h2>
                  </div>
                  <button
                    className="secondary"
                    disabled={!gatewayOrigin}
                    onClick={() => copy(integrationPrompt(gatewayOrigin))}
                  >
                    <Copy size={14} /> Copy integration prompt
                  </button>
                </div>
                <p>
                  Paste this into the AI agent working on your app. It includes
                  this gateway’s URL, payment API, webhook verification, and
                  testing requirements. Supply your app’s keys separately through
                  its backend secrets.
                </p>
                <details>
                  <summary>Preview prompt</summary>
                  <textarea
                    aria-label="AI agent integration prompt"
                    readOnly
                    rows={16}
                    value={gatewayOrigin ? integrationPrompt(gatewayOrigin) : ""}
                  />
                </details>
              </div>
              <div className="panel guide">
                <span className="step">01 / CONNECT</span>
                <h2>From your server, with a key.</h2>
                <p>
                  Add an application, copy its secret key, and keep it in your
                  app’s server environment. Never put it in browser code.
                </p>
                <span className="step">02 / CREATE</span>
                <h2>One order. One payment.</h2>
                <p>
                  Send an integer MMK amount and your unique order ID. The
                  response includes a hosted checkout URL and an EMVCo QR
                  string. Send your customer to checkout_url or render the QR in
                  your own app.
                </p>
                <span className="step">03 / CONFIRM</span>
                <h2>Trust the payment record.</h2>
                <p>
                  Read <code>GET /v1/payments/:id</code> from your server.
                  Fulfill only when status is <code>SUCCESS</code> and the
                  amount matches your order. Use{" "}
                  <code>POST /v1/payments/:id/refresh</code> to reconcile
                  delayed callbacks.
                </p>
                <a
                  className="text-link"
                  href="https://docs.myanmyanpay.com/sdk-node/"
                  target="_blank"
                  rel="noreferrer"
                >
                  MyanMyanPay documentation <ArrowUpRight size={16} />
                </a>
              </div>
              <div className="panel code-panel">
                <div className="card-heading">
                  <span>
                    <Code size={17} /> Server-side JavaScript
                  </span>
                  <button className="secondary" onClick={() => copy(code)}>
                    <Copy size={14} />
                    Copy
                  </button>
                </div>
                <pre>
                  <code>{code}</code>
                </pre>
                <div className="code-note">
                  Full setup, API reference, failure recovery, and examples are
                  included in <code>docs/INTEGRATION.md</code>.
                </div>
              </div>
            </section>
          )}
          {(page === "Settings" || page === "Overview") && <SetupChecklist />}
          {page === "Settings" && (
            <section className="panel settings reveal">
              <div className="card-heading">
                <div>
                  <h2>Gateway configuration</h2>
                  <p>
                    Credentials stay on the server, in your environment file.
                  </p>
                </div>
                <GearSix size={24} />
              </div>
              {[
                ["Workspace", "Personal · single owner"],
                ["Frontend", "Next.js"],
                ["Payment API", "NestJS"],
                ["Database", "PostgreSQL"],
                ["Provider", "MyanMyanPay · MMQR"],
                [
                  "Provider connection",
                  configured
                    ? "Credentials configured"
                    : "Credentials required",
                ],
                ["Currency", "MMK · whole kyat"],
                ["Timezone", "Asia/Yangon"],
              ].map(([label, value]) => (
                <div className="setting-row" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
              <div className="setup-note">
                <ShieldCheck size={22} />
                <p>
                  Set MyanMyanPay credentials and your provider API URL in{" "}
                  <code>.env</code>, then restart. Configure the callback URL as{" "}
                  <code>PUBLIC_API_URL/webhooks/mmpay</code>. See the README for
                  deployment instructions.
                </p>
              </div>
            </section>
          )}
          {page === "Overview" && (
            <div className="integration-strip reveal">
              <div className="integration-icon">
                <Code size={23} />
              </div>
              <div>
                <h3>Your next app is a few lines away.</h3>
                <p>
                  One API. A consistent payment flow for everything you build.
                </p>
              </div>
              <button onClick={() => setPage("Integration")}>
                Read the integration guide <ArrowUpRight size={16} />
              </button>
            </div>
          )}
          <footer>
            <span>
              <span className="footer-mark">b.</span> Your infrastructure. Your
              workspace.
            </span>
            <span>
              Powered by MyanMyanPay <span className="footer-divider">/</span>{" "}
              MMK payments
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {(modal || newKey || detail) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setModal(null);
            setDetail(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              newKey
                ? "New API key"
                : detail
                  ? "Transaction details"
                  : "Add application"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon-button"
              aria-label="Close dialog"
              onClick={() => {
                setModal(null);
                setDetail(null);
                setNewKey("");
              }}
            >
              <X size={20} />
            </button>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {newKey ? (
              <>
                <span className="eyebrow">SAVE THIS SECRET</span>
                <h2>Your app is connected.</h2>
                <p>
                  Copy this secret now. It cannot be retrieved again. API key
                  rotations invalidate the previous key immediately.
                </p>
                <div className="secret">
                  <code>{newKey}</code>
                </div>
                <button className="primary" onClick={() => copy(newKey)}>
                  <Copy />
                  Copy secret
                </button>
              </>
            ) : detail ? (
              <>
                <span className="eyebrow">TRANSACTION DETAILS</span>
                <h2>{detail.order_id}</h2>
                <div className="detail-amount">
                  {money(Number(detail.amount))} <small>MMK</small>
                </div>
                <Status status={detail.status} />
                {[
                  ["Application", detail.app_name],
                  ["Payment ID", detail.id],
                  ["Created", when(detail.created_at)],
                  ["Description", detail.description || "—"],
                ].map(([k, v]) => (
                  <div className="setting-row" key={k}>
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
                {detail.qr && ["PENDING", "CREATING"].includes(detail.status) && (
                  <PaymentQr
                    value={detail.qr}
                    expiresAt={detail.checkout_expires_at || new Date(Date.parse(detail.created_at) + 15 * 60 * 1000).toISOString()}
                    orderId={detail.order_id}
                  />
                )}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const p = await api(
                        `admin/payments/${detail.id}/refresh`,
                        "POST",
                      );
                      setDetail({ ...p, app_name: detail.app_name });
                      await load();
                      setToast("Payment reconciled with provider");
                    } catch (e) {
                      setError((e as Error).message);
                      setDetail(null);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <ArrowClockwise size={16} />{" "}
                  {busy ? "Checking provider…" : "Refresh from provider"}
                </button>
                <PaymentTimeline payment={detail} onError={setError} />
              </>
            ) : (
              <form onSubmit={submit}>
                <span className="eyebrow">A NEW CONNECTION</span>
                <h2>Add an application.</h2>
                <p>
                  Give your app a name. A dedicated secret key will be generated
                  and shown once.
                </p>
                <label className="form-label">
                  Application name
                  <input
                    autoFocus
                    required
                    maxLength={60}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Application name"
                  />
                </label>
                {error && (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                )}
                <button className="primary" disabled={busy || !name.trim()}>
                  {busy ? "Creating…" : "Create application"}
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Status({ status }: { status: string }) {
  return (
    <span
      className={`badge ${["SUCCESS", "ACTIVE"].includes(status) ? "green" : ["PENDING", "CREATING"].includes(status) ? "yellow" : ["FAILED", "REVOKED"].includes(status) ? "red" : "neutral"}`}
    >
      <span />
      {status === "SUCCESS"
        ? "Successful"
        : status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
function ActivityChart({
  days,
  now,
  values,
}: {
  days: number;
  now: number;
  values: number[];
}) {
  const buckets = values;
  if (values.every((value) => value === 0))
    return <div className="empty">No collected payments in this period.</div>;
  const max = Math.max(...buckets, 100000);
  const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0];
  return (
    <div className="chart">
      <div className="y-labels">
        {ticks.map((v, i) => (
          <span key={i}>{v >= 1000 ? `${Math.round(v / 1000)}k` : v}</span>
        ))}
      </div>
      <div className="chart-plot">
        <div className="grid-lines">
          {ticks.map((_, i) => (
            <span key={i} />
          ))}
        </div>
        <div className="bars">
          {buckets.map((value, i) => (
            <div className="bar-group" key={i}>
              <div
                className="bar"
                style={{
                  height: `${Math.max((value / max) * 100, value ? 2 : 0)}%`,
                }}
                title={`${money(value)} MMK`}
              >
                <span>{money(value)} MMK</span>
              </div>
              <span className="x-label">
                {new Date(
                  now - (((6 - i) * days) / 7) * 86400000,
                ).toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  timeZone: "Asia/Yangon",
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
