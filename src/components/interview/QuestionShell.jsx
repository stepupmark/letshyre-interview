import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import CountdownTimer from "./CountdownTimer";
import QuestionContent from "./QuestionContent";

export default function QuestionShell({
  badgeText,
  questionNumber,
  questionText,
  onNext,
  endTime,
  submitting = false,
  isLastQuestion = false,
  children,
}) {
  const { t } = useTranslation("questions");
  return (
    <Card className="rounded-3xl border border-white/80 bg-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.06)] relative overflow-hidden">
      {/* Loading Overlay */}
      {submitting && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
            <p className="font-semibold text-blue-800">
              {isLastQuestion
                ? t("shell.submittingFinal")
                : t("shell.generatingNext")}
            </p>
          </div>
        </div>
      )}

      <CardContent className="p-5 md:p-6">
        {/* Top Row */}
        <div className="mb-6 flex items-center justify-between gap-4">
          {/* Timer */}
          <div className="rounded-xl bg-black px-5 py-2 text-2xl font-mono text-white shadow-lg">
            <CountdownTimer endTime={endTime} />
          </div>

          {/* CTA */}
          <Button
            onClick={onNext}
            disabled={submitting}
            className="h-12 rounded-xl font-bold bg-[#a9c8ff] px-7 text-slate-900 shadow-md hover:bg-[#97bcff] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? t("shell.submitting") : isLastQuestion ? t("shell.submitInterview") : t("shell.nextQuestion")}
            <ArrowRight className=" h-4 w-4" />
          </Button>
        </div>

        {/* Question Box */}
        <div className="rounded-3xl border border-blue-100 bg-white px-6 py-5 shadow-sm">
          <Badge className="mb-4 bg-blue-200 text-blue-900 hover:bg-blue-200">{badgeText}</Badge>

          {/* Question Header */}
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-300 text-sm font-bold text-white">
              {questionNumber}
            </div>

            <QuestionContent
              source={questionText}
              selectNone
              className="min-w-0 flex-1 break-words text-[17px] leading-8 text-slate-700"
            />
          </div>

          {/* Inner Question Content */}
          <div className="mt-5">{children}</div>
        </div>
      </CardContent>
    </Card>
  );
}
