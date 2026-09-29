import { useTranslation } from "react-i18next";
import { AlertTriangle, Ban, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";

const STRIKES = ["window", "people", "devices", "apps"];
const WARNINGS = ["faceFrame", "lighting", "cameraPause"];

function RuleList({ title, items, prefix, Icon, tone }) {
  const { t } = useTranslation("interview");
  return (
    <section>
      <h3 className={`flex items-center gap-2 text-sm font-bold ${tone}`}>
        <Icon className="h-4 w-4" />
        {title}
      </h3>
      <ul className="mt-2 list-disc space-y-1 ps-6 text-sm text-slate-600">
        {items.map((item) => (
          <li key={item}>{t(`${prefix}.${item}`)}</li>
        ))}
      </ul>
    </section>
  );
}

export function PreStartRules({ limits, onAcknowledge }) {
  const { t } = useTranslation("interview");

  const limitLines = [
    t("preStart.rules.limits.strikes", { max: limits.strikes }),
    t("preStart.rules.limits.held", { seconds: limits.heldSeconds }),
    t("preStart.rules.limits.face", { inARow: limits.faceInARow, total: limits.faceTotal }),
    t("preStart.rules.limits.network", { max: limits.disconnects }),
  ];

  return (
    <div className="w-full max-w-2xl rounded-3xl bg-white p-8 text-start shadow-xl">
      <h2 id="pre-start-title" className="text-2xl font-extrabold text-slate-800">
        {t("preStart.rules.title")}
      </h2>
      <p className="mt-2 text-slate-600">{t("preStart.rules.intro")}</p>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <RuleList
          title={t("preStart.rules.strikesTitle")}
          items={STRIKES}
          prefix="preStart.rules.strikes"
          Icon={Ban}
          tone="text-rose-600"
        />
        <RuleList
          title={t("preStart.rules.warningsTitle")}
          items={WARNINGS}
          prefix="preStart.rules.warnings"
          Icon={AlertTriangle}
          tone="text-amber-600"
        />
      </div>

      <section className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Gauge className="h-4 w-4" />
          {t("preStart.rules.limitsTitle")}
        </h3>
        <ul className="mt-2 list-disc space-y-1 ps-6 text-sm text-slate-600">
          {limitLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <div className="mt-8 flex justify-end">
        <Button
          onClick={onAcknowledge}
          className="h-12 rounded-xl bg-slate-900 px-8 text-sm font-semibold text-white hover:bg-black"
        >
          {t("preStart.rules.acknowledge")}
        </Button>
      </div>
    </div>
  );
}
