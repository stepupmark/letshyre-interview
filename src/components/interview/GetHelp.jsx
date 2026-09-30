import { useTranslation } from "react-i18next";
import { Camera, LifeBuoy, Monitor, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSupportInfo } from "@hooks/interview/useSupportInfo";

const TOPICS = [
  { key: "camera", Icon: Camera },
  { key: "network", Icon: Wifi },
  { key: "display", Icon: Monitor },
];

// Contact details are plain text: a link would take the candidate out of the interview.
export function GetHelp() {
  const { t } = useTranslation("common");
  const { contact } = useSupportInfo();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-auto rounded-xl border-slate-200 bg-white px-4 py-2.5 text-[15px] font-semibold text-slate-700 shadow-sm"
        >
          <LifeBuoy className="h-[18px] w-[18px]" />
          {t("support.help.button")}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-4 bg-white sm:max-w-lg">
        <div>
          <DialogTitle className="text-lg font-semibold text-slate-800">
            {t("support.help.title")}
          </DialogTitle>
          <DialogDescription className="mt-1 text-slate-500">
            {t("support.help.description")}
          </DialogDescription>
        </div>

        <ul className="space-y-3">
          {TOPICS.map(({ key, Icon }) => (
            <li key={key} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
              <div>
                <p className="font-semibold text-slate-800">{t(`support.help.${key}.title`)}</p>
                <p className="mt-0.5 text-slate-600">{t(`support.help.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>

        {contact && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
            <p className="font-semibold text-slate-800">{t("support.help.contactTitle")}</p>
            <dl className="mt-1 space-y-0.5 text-slate-600">
              {contact.email && (
                <div className="flex gap-2">
                  <dt>{t("support.help.email")}:</dt>
                  <dd dir="ltr" className="font-medium select-all">
                    {contact.email}
                  </dd>
                </div>
              )}
              {contact.url && (
                <div className="flex gap-2">
                  <dt>{t("support.help.website")}:</dt>
                  <dd dir="ltr" className="font-medium break-all select-all">
                    {contact.url}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="flex justify-end">
          <DialogClose asChild>
            <Button className="h-10 rounded-xl bg-slate-900 px-5 text-white hover:bg-black">
              {t("support.help.close")}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
