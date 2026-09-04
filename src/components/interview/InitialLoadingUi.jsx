import { useTranslation } from "react-i18next";

export function InitialLoadingUi() {
  const { t } = useTranslation("common");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[linear-gradient(180deg,#7fb0ff_0%,#cfe1ff_38%,#eef5ff_72%,#ffffff_100%)] px-4 text-center">
      <div className="relative mb-8 flex h-32 w-32 items-center justify-center rounded-full bg-white shadow-[0_10px_40px_rgba(59,130,246,0.3)]">
        <div className="absolute inset-0 animate-ping rounded-full bg-blue-400 opacity-20 duration-1000"></div>
        <div className="absolute inset-2 animate-pulse rounded-full bg-blue-100/50"></div>
        <img
          src="/robo.png"
          alt="AI Interviewer"
          className="z-10 h-20 w-20 object-contain drop-shadow-md"
        />
      </div>

      <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-slate-800">
        {t("initialLoading.heading")}
      </h2>
      <p className="max-w-md text-[16px] leading-relaxed text-slate-600 font-medium">
        {t("initialLoading.description")}
      </p>

      {/* Bouncing Dots Indicator */}
      <div className="mt-10 flex gap-2.5">
        <div
          className="h-3 w-3 animate-bounce rounded-full bg-blue-600 shadow-md"
          style={{ animationDelay: "0ms" }}
        ></div>
        <div
          className="h-3 w-3 animate-bounce rounded-full bg-blue-500 shadow-md"
          style={{ animationDelay: "150ms" }}
        ></div>
        <div
          className="h-3 w-3 animate-bounce rounded-full bg-blue-400 shadow-md"
          style={{ animationDelay: "300ms" }}
        ></div>
      </div>
    </div>
  );
}
