import { ShieldX } from "lucide-react";
import { useTranslation } from "react-i18next";

export function UnauthorizedAccess() {
  const { t } = useTranslation("errors");

  return (
    <div className="min-h-screen flex items-center justify-center bg-[linear-gradient(180deg,#7fb0ff_0%,#cfe1ff_38%,#eef5ff_72%,#ffffff_100%)]">
      <div className="flex flex-col items-center gap-6 text-center px-6 max-w-md">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
          <ShieldX className="h-10 w-10 text-red-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-[#2D4A77] tracking-tight">
            {t("unauthorizedAccess.heading")}
          </h1>
          <p className="mt-2 text-slate-500 font-medium">
            {t("unauthorizedAccess.description")}
          </p>
        </div>
      </div>
    </div>
  );
}
