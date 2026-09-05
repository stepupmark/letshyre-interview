import { AlertTriangle, ArrowLeft, ChevronRight, RefreshCcw } from "lucide-react";

import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { t } = useTranslation("errors");

  let status = 500;
  let title = t("errorPage.default.title");
  let description = t("errorPage.default.description");

  if (isRouteErrorResponse(error)) {
    status = error.status;

    switch (error.status) {
      case 401:
        title = t("errorPage.unauthorized.title");
        description = t("errorPage.unauthorized.description");
        break;

      case 403:
        title = t("errorPage.forbidden.title");
        description = t("errorPage.forbidden.description");
        break;

      case 404:
        title = t("errorPage.notFound.title");
        description = t("errorPage.notFound.description");
        break;

      case 500:
        title = t("errorPage.serverError.title");
        description = t("errorPage.serverError.description");
        break;

      default:
        title = error.statusText || title;
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-[#f6f8fc] p-4 lg:p-20">
      <Card className="mx-auto grid h-full max-w-4xl overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-[0_20px_80px_rgba(15,23,42,0.05)] lg:grid-cols-[1fr_560px]">
        {/* LEFT SIDE */}
        <section className="relative flex items-center px-8 py-10 sm:px-12 lg:px-16">
          {/* Background Blur */}
          <div className="absolute start-0 top-0 h-72 w-72 rounded-full bg-blue-100/40 blur-3xl" />

          <div className="relative z-10 max-w-xl">
            {/* Top Label */}
            <div className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              {t("errorPage.badge")}
            </div>

            {/* Main Heading */}
            <h1 className="mt-8 text-5xl font-black leading-[0.95] tracking-[-3px] text-slate-950 sm:text-6xl">
              {status}
            </h1>

            <h2 className="mt-4 text-3xl font-bold tracking-[-1px] text-slate-900 sm:text-4xl">
              {title}
            </h2>

            {/* Description */}
            <p className="mt-6 max-w-lg text-lg leading-9 text-slate-600">{description}</p>

            {/* Actions */}
            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => navigate(-1)}
                className="group h-14 rounded-2xl border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                <ArrowLeft className="me-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
                {t("errorPage.goBack")}
              </Button>

              <Button
                onClick={() => navigate("/")}
                className="group h-14 rounded-2xl bg-slate-950 px-6 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(15,23,42,0.15)] transition-all hover:bg-slate-800"
              >
                {t("errorPage.returnHome")}
                <ChevronRight className="ms-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>

            {/* Reload */}
            <button
              onClick={() => window.location.reload()}
              className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              <RefreshCcw className="h-4 w-4" />
              {t("errorPage.reloadPage")}
            </button>
          </div>
        </section>

        {/* RIGHT SIDE */}
        <section className="relative hidden overflow-hidden border-s border-slate-100 bg-gradient-to-br from-[#fbfcff] via-[#f6f8ff] to-[#eef3ff] lg:flex lg:items-center lg:justify-center">
          {/* Decorative Background */}
          <div className="absolute inset-0">
            <div className="absolute end-[-120px] top-[-120px] h-80 w-80 rounded-full bg-blue-100/60 blur-3xl" />
            <div className="absolute bottom-[-140px] start-[-100px] h-80 w-80 rounded-full bg-indigo-100/50 blur-3xl" />
          </div>

          {/* Grid Pattern */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] bg-[size:36px_36px]" />

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center">
            {/* Main Circle */}
            <div className="relative flex h-64 w-64 items-center justify-center rounded-full border border-white/80 bg-white/80 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl">
              {/* Inner Glow */}
              <div className="absolute inset-4 rounded-full bg-gradient-to-br from-red-50 to-orange-50" />

              {/* Icon */}
              <div className="relative z-10 flex h-24 w-24 items-center justify-center rounded-3xl bg-red-500 shadow-[0_20px_40px_rgba(239,68,68,0.3)]">
                <AlertTriangle className="h-12 w-12 text-white" />
              </div>
            </div>

            {/* Floating Info Card */}
            <div className="-mt-6 w-[380px] rounded-[28px] border border-white/70 bg-white/90 p-7 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">{t("errorPage.statusLabel")}</p>

                  <h3 className="mt-2 text-3xl font-bold tracking-[-1px] text-slate-950">
                    {status}
                  </h3>
                </div>

                <div className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-600">
                  {t("errorPage.active")}
                </div>
              </div>

              {/* Divider */}
              <div className="my-6 h-px bg-slate-100" />

              {/* Skeleton */}
              <div className="space-y-4">
                <div className="h-2.5 rounded-full bg-slate-100" />
                <div className="h-2.5 w-5/6 rounded-full bg-slate-100" />
                <div className="h-2.5 w-4/6 rounded-full bg-slate-100" />
              </div>
            </div>
          </div>
        </section>
      </Card>
    </main>
  );
}
