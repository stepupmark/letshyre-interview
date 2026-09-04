import { ArrowLeft, Home, RotateCcw, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNavigate } from "react-router";

export default function NotFoundPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("errors");

  return (
    <main className="h-screen overflow-hidden bg-[#f4f7fb] p-4 lg:p-20">
      <Card className="mx-auto grid h-full max-w-4xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_10px_60px_rgba(15,23,42,0.06)] lg:grid-cols-2">
        {/* LEFT CONTENT */}
        <div className="flex items-center px-8 py-10 sm:px-12 lg:px-14">
          <div className="max-w-md">
            {/* Badge */}
            <div className="inline-flex items-center rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-600 ring-1 ring-blue-100">
              {t("notFoundPage.badge")}
            </div>

            {/* Heading */}
            <h1 className="mt-6 text-4xl font-black leading-[0.95] tracking-[-2px] text-slate-950 sm:text-5xl">
              {t("notFoundPage.headingLine1")}
              <br />
              {t("notFoundPage.headingLine2")}
            </h1>

            {/* Description */}
            <p className="mt-6 text-base leading-8 text-slate-600">
              {t("notFoundPage.description")}
            </p>

            {/* Buttons */}
            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => navigate(-1)}
                className="h-12 rounded-2xl border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50"
              >
                <ArrowLeft className="me-2 h-4 w-4" />
                {t("notFoundPage.goBack")}
              </Button>

              <Button
                onClick={() => navigate("/")}
                className="h-12 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-lg shadow-slate-200 transition-all hover:bg-slate-800"
              >
                <Home className="me-2 h-4 w-4" />
                {t("notFoundPage.returnHome")}
              </Button>
            </div>

            {/* Reload */}
            <button
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              <RotateCcw className="h-4 w-4" />
              {t("notFoundPage.reloadPage")}
            </button>
          </div>
        </div>

        {/* RIGHT VISUAL */}
        <div className="relative hidden overflow-hidden border-s border-slate-100 bg-gradient-to-br from-[#f8fbff] via-[#f5f7ff] to-[#eef3ff] lg:flex lg:items-center lg:justify-center">
          {/* Blur Shapes */}
          <div className="absolute -top-20 end-10 h-72 w-72 rounded-full bg-blue-100/40 blur-3xl" />
          <div className="absolute bottom-0 start-0 h-72 w-72 rounded-full bg-indigo-100/30 blur-3xl" />

          {/* Dot Pattern */}
          <div className="absolute end-16 top-24 grid grid-cols-6 gap-2 opacity-40">
            {Array.from({ length: 36 }).map((_, index) => (
              <div key={index} className="h-1.5 w-1.5 rounded-full bg-blue-300" />
            ))}
          </div>

          {/* Bottom Gradient */}
          <div className="absolute bottom-0 start-0 h-56 w-full bg-[radial-gradient(circle_at_bottom_left,#dbeafe_0%,transparent_60%)]" />

          <div className="relative flex flex-col items-center">
            {/* 404 */}
            <h2 className="relative z-10 text-[140px] font-black leading-none tracking-[-8px] text-blue-500 drop-shadow-[0_8px_20px_rgba(59,130,246,0.2)]">
              404
            </h2>

            {/* Floating Card */}
            <div className="-mt-2 w-[360px] rounded-[24px] border border-white/70 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
              {/* Header */}
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-950 to-slate-800 shadow-md">
                  <Shield className="h-7 w-7 text-white" />
                </div>

                <div>
                  <h3 className="text-2xl font-bold tracking-[-1px] text-slate-900">
                    Letshyre Interview
                  </h3>

                  <p className="mt-1 text-base text-slate-500">{t("notFoundPage.tagline")}</p>
                </div>
              </div>

              {/* Divider */}
              <div className="my-5 h-px bg-slate-100" />

              {/* Skeleton */}
              <div className="space-y-3">
                <div className="h-2.5 rounded-full bg-slate-100" />
                <div className="h-2.5 w-5/6 rounded-full bg-slate-100" />
                <div className="h-2.5 w-3/5 rounded-full bg-slate-100" />
              </div>
            </div>
          </div>
        </div>
      </Card>
    </main>
  );
}
